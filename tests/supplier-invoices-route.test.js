'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createSupplierInvoicesRouter } = require('../server/expenses/supplier-invoices-route');
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

const SCAN_RESULT = Object.freeze({
  merchant: 'Fresh Market LLC',
  purchasedAt: '2026-08-01',
  currency: 'AED',
  totalMinor: 12550,
  items: [
    { name: 'עגבניות', quantity: 5, unitPriceMinor: 500, totalMinor: 2500, category: 'vegetables' },
    { name: 'תפוחים', quantity: 2, unitPriceMinor: 700, totalMinor: 1400, category: 'fruits' },
  ],
});

// A pg-pool double that answers the queries the repository issues, in memory.
function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO public.supplier_invoices')) {
        const row = {
          id: params[0], r2_key: params[1], file_name: params[2], status: 'pending',
          merchant: null, purchased_at: null, currency: null, total_minor: null,
          items: null, scan_error: null, created_at: new Date(), updated_at: new Date(),
        };
        rows.set(row.id, row);
        return { rows: [row] };
      }
      if (sql.includes("SET status = 'scanned'")) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [] };
        Object.assign(row, {
          status: 'scanned', merchant: params[1],
          purchased_at: params[2] ? new Date(params[2]) : null,
          currency: params[3], total_minor: params[4], items: JSON.parse(params[5]),
        });
        return { rows: [row] };
      }
      if (sql.includes('SET purchased_at')) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [] };
        row.purchased_at = new Date(params[1]);
        return { rows: [row] };
      }
      if (sql.includes("SET status = 'failed'")) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [] };
        Object.assign(row, { status: 'failed', scan_error: params[1] });
        return { rows: [row] };
      }
      if (sql.includes('DELETE FROM public.supplier_invoices')) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [] };
        rows.delete(params[0]);
        return { rows: [{ r2_key: row.r2_key }] };
      }
      if (sql.includes('WHERE id = $1')) {
        const row = rows.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('SELECT * FROM public.supplier_invoices')) {
        return { rows: [...rows.values()] };
      }
      return { rows: [] };
    },
  };
}

function fakeStorageClient() {
  const sent = [];
  return {
    sent,
    factory() {
      return {
        async send(command) {
          sent.push(command);
          if (command.constructor.name === 'GetObjectCommand') {
            return {
              ContentType: 'application/pdf',
              Body: (async function* stream() { yield PDF_BYTES; })(),
            };
          }
          return {};
        },
      };
    },
  };
}

async function serve(t, router) {
  const app = express();
  app.use('/api/settings/supplier-invoices', router);
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

function makeRouter({ pool = fakePool(), scanner = async () => SCAN_RESULT, quota = null } = {}) {
  const client = fakeStorageClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  const router = createSupplierInvoicesRouter({ pool, storage, scanner, quota, logger: silentLogger });
  return { router, pool, client };
}

test('upload stores the file, scans it, and returns categorized items', async (t) => {
  const { router } = makeRouter();
  const base = await serve(t, router);

  const response = await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'T00000P0187000312738.pdf' },
  });
  assert.equal(response.status, 201);
  const { invoice } = await response.json();
  assert.equal(invoice.status, 'scanned');
  assert.equal(invoice.merchant, 'Fresh Market LLC');
  assert.equal(invoice.purchasedAt, '2026-08-01');
  assert.equal(invoice.totalMinor, 12550);
  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.items[0].category, 'vegetables');
  assert.match(invoice.r2Key, /^invoices\/\d{4}-\d{2}\//u);
});

test('a failed scan keeps the file and marks the record failed', async (t) => {
  const { router } = makeRouter({ scanner: async () => { throw new Error('provider down'); } });
  const base = await serve(t, router);

  const response = await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  });
  assert.equal(response.status, 201);
  const { invoice } = await response.json();
  assert.equal(invoice.status, 'failed');
  assert.match(invoice.scanError, /provider down/u);
});

test('rescan turns a failed record into a scanned one', async (t) => {
  let calls = 0;
  const scanner = async () => {
    calls += 1;
    if (calls === 1) throw new Error('flaky');
    return SCAN_RESULT;
  };
  const { router } = makeRouter({ scanner });
  const base = await serve(t, router);

  const first = await (await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  })).json();
  assert.equal(first.invoice.status, 'failed');

  const rescanned = await jsonRequest(base, `/api/settings/supplier-invoices/${first.invoice.id}/rescan`, {
    method: 'POST',
  });
  assert.equal(rescanned.status, 200);
  assert.equal((await rescanned.json()).invoice.status, 'scanned');
});

test('refuses uploads with 413 when the storage plan is full', async (t) => {
  const quota = { isOverQuota: async () => true, invalidateCache() {} };
  const { router } = makeRouter({ quota });
  const base = await serve(t, router);

  const response = await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'STORAGE_LIMIT');
});

test('rejects files whose bytes do not match the declared type', async (t) => {
  const { router } = makeRouter();
  const base = await serve(t, router);

  const fake = Buffer.from('<html>not a pdf</html>');
  const response = await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: `data:application/pdf;base64,${fake.toString('base64')}`, fileName: 'evil.pdf' },
  });
  assert.equal(response.status, 400);
});

test('delete removes the record and the stored file', async (t) => {
  const { router, client } = makeRouter();
  const base = await serve(t, router);

  const { invoice } = await (await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  })).json();

  const deleted = await jsonRequest(base, `/api/settings/supplier-invoices/${invoice.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.ok(client.sent.some((command) => command.constructor.name === 'DeleteObjectCommand'));

  const list = await (await jsonRequest(base, '/api/settings/supplier-invoices')).json();
  assert.equal(list.invoices.length, 0);
});

test('file reads refuse keys outside the invoices/ prefix', async (t) => {
  const { router, client } = makeRouter();
  const base = await serve(t, router);

  for (const key of ['backups/x.enc', 'proof/x.jpg', 'invoices/../backups/x']) {
    const read = await jsonRequest(base, '/api/settings/supplier-invoices/file?key=' + encodeURIComponent(key));
    assert.equal(read.status, 404, `must refuse ${key}`);
  }
  assert.equal(client.sent.filter((command) => command.constructor.name === 'GetObjectCommand').length, 0);
});

test('a manual date correction overrides the scan and refuses future dates', async (t) => {
  const { router } = makeRouter();
  const base = await serve(t, router);

  const { invoice } = await (await jsonRequest(base, '/api/settings/supplier-invoices', {
    method: 'POST',
    body: { fileBase64: PDF_DATA_URL, fileName: 'invoice.pdf' },
  })).json();

  const fixed = await jsonRequest(base, `/api/settings/supplier-invoices/${invoice.id}/date`, {
    method: 'PATCH',
    body: { purchasedAt: '2026-07-02' },
  });
  assert.equal(fixed.status, 200);
  assert.equal((await fixed.json()).invoice.purchasedAt, '2026-07-02');

  const future = await jsonRequest(base, `/api/settings/supplier-invoices/${invoice.id}/date`, {
    method: 'PATCH',
    body: { purchasedAt: '2099-01-01' },
  });
  assert.equal(future.status, 400);
});
