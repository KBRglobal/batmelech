'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createInvoiceFilesRouter } = require('../server/invoice-files-route');
const { createR2Storage } = require('../server/telegram/r2-storage');

const silentLogger = { error() {} };

const FULL_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'batmelech',
  R2_PUBLIC_URL: 'https://pub-test.r2.dev',
};

const PDF_BYTES = Buffer.from('%PDF-1.4 fake invoice body');
const PDF_DATA_URL = `data:application/pdf;base64,${PDF_BYTES.toString('base64')}`;

function fakeClient({ onSend } = {}) {
  const sent = [];
  return {
    sent,
    factory() {
      return {
        async send(command) {
          sent.push(command);
          if (onSend) return onSend(command);
          return {};
        },
      };
    },
  };
}

async function serve(t, router) {
  const app = express();
  app.use('/api/settings/invoice-files', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function jsonRequest(base, path, { method = 'GET', body } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('uploads a PDF under invoices/<month>/ and returns the key', async (t) => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const base = await serve(t, createInvoiceFilesRouter({ storage, logger: silentLogger }));

  const response = await jsonRequest(base, '/api/settings/invoice-files', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'T00000P0187000312738.pdf' },
  });
  assert.equal(response.status, 201);
  const { key } = await response.json();
  assert.match(key, /^invoices\/\d{4}-\d{2}\/\d+-[a-f0-9]{16}-T00000P0187000312738\.pdf$/u);
  assert.equal(client.sent.length, 1);
});

test('rejects a file whose bytes do not match the declared type', async (t) => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const base = await serve(t, createInvoiceFilesRouter({ storage, logger: silentLogger }));

  const fake = Buffer.from('<html>not a pdf</html>');
  const response = await jsonRequest(base, '/api/settings/invoice-files', {
    method: 'POST',
    body: { fileBase64: `data:application/pdf;base64,${fake.toString('base64')}`, fileName: 'evil.pdf' },
  });
  assert.equal(response.status, 400);
  assert.equal(client.sent.length, 0);
});

test('refuses the upload with 413 when the storage plan is full', async (t) => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const quota = { isOverQuota: async () => true, invalidateCache() {} };
  const base = await serve(t, createInvoiceFilesRouter({ storage, quota, logger: silentLogger }));

  const response = await jsonRequest(base, '/api/settings/invoice-files', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'STORAGE_LIMIT');
  assert.equal(client.sent.length, 0);
});

test('lists archive files and streams a file back through the server', async (t) => {
  const client = fakeClient({
    onSend(command) {
      const name = command.constructor.name;
      if (name === 'ListObjectsV2Command') {
        return {
          Contents: [{ Key: 'invoices/2026-08/1-aa-invoice.pdf', Size: 111, LastModified: new Date('2026-08-19') }],
          IsTruncated: false,
        };
      }
      if (name === 'GetObjectCommand') {
        return {
          ContentType: 'application/pdf',
          Body: (async function* stream() {
            yield PDF_BYTES;
          })(),
        };
      }
      return {};
    },
  });
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const base = await serve(t, createInvoiceFilesRouter({ storage, logger: silentLogger }));

  const listResponse = await jsonRequest(base, '/api/settings/invoice-files');
  assert.equal(listResponse.status, 200);
  const { files } = await listResponse.json();
  assert.equal(files.length, 1);
  assert.equal(files[0].key, 'invoices/2026-08/1-aa-invoice.pdf');

  const fileResponse = await jsonRequest(
    base,
    '/api/settings/invoice-files/file?key=' + encodeURIComponent('invoices/2026-08/1-aa-invoice.pdf')
  );
  assert.equal(fileResponse.status, 200);
  assert.match(fileResponse.headers.get('content-type') || '', /application\/pdf/u);
  assert.equal(Buffer.from(await fileResponse.arrayBuffer()).toString(), PDF_BYTES.toString());
});

test('read and delete refuse keys outside the invoices/ prefix', async (t) => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const base = await serve(t, createInvoiceFilesRouter({ storage, logger: silentLogger }));

  for (const key of ['backups/2026-08-19.json.enc', 'proof/2026-08-19/x.jpg', 'invoices/../backups/x', 'menu/x.jpg']) {
    const read = await jsonRequest(base, '/api/settings/invoice-files/file?key=' + encodeURIComponent(key));
    assert.equal(read.status, 404, `read must refuse ${key}`);
    const del = await jsonRequest(base, '/api/settings/invoice-files', { method: 'DELETE', body: { key } });
    assert.equal(del.status, 404, `delete must refuse ${key}`);
  }
  assert.equal(client.sent.length, 0);
});
