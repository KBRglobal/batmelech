'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const {
  MAX_LEGACY_HTML_BYTES,
  createLegacyManagerRouter,
  injectSyncBootstrap,
} = require('../server/legacy-manager-route');

function request(server, requestPath) {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP server is not ready');

  return new Promise((resolve, reject) => {
    const requestHandle = http.get(
      { hostname: '127.0.0.1', port: address.port, path: requestPath },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            cacheControl: response.headers['cache-control'],
            contentType: response.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    requestHandle.on('error', reject);
  });
}

async function createFixture(t) {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-legacy-first-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-legacy-second-'));
  t.after(() => fs.rmSync(firstRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(secondRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(firstRoot, 'index.html'), '<!doctype html><html><head></head><body>first legacy</body></html>');
  fs.writeFileSync(path.join(secondRoot, 'index.html'), '<!doctype html><html><head></head><body>second legacy</body></html>');

  let contentRoot = firstRoot;
  const app = express();
  app.use('/legacy', createLegacyManagerRouter({ getContentRoot: () => contentRoot }));
  app.use((_request, response) => response.status(404).send('outside'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  return { firstRoot, secondRoot, server, useSecondRoot: () => { contentRoot = secondRoot; } };
}

test('injects the versioned sync bootstrap exactly once before legacy scripts', () => {
  const script = '<script src="/bm-sync.js"></script>';
  const original = '<!doctype html><html><head><script>window.LEGACY = true</script></head></html>';

  const injected = injectSyncBootstrap(original, '/bm-sync.js');
  assert.equal(injected.match(/<script src="\/bm-sync\.js"><\/script>/g)?.length, 1);
  assert.ok(injected.indexOf(script) < injected.indexOf('window.LEGACY'));
  assert.equal(injectSyncBootstrap(injected, '/bm-sync.js'), injected);
});

test('serves the complete legacy manager at both stable backup paths', async (t) => {
  const { server } = await createFixture(t);

  for (const requestPath of ['/legacy/', '/legacy/index.html']) {
    const response = await request(server, requestPath);
    assert.equal(response.status, 200);
    assert.match(response.contentType, /^text\/html/);
    assert.equal(response.cacheControl, 'no-store');
    assert.match(response.body, /first legacy/);
    assert.equal(response.body.match(/\/bm-sync\.js/g)?.length, 1);
  }
});

test('reads the current content root on every request after a safe refresh', async (t) => {
  const fixture = await createFixture(t);
  assert.match((await request(fixture.server, '/legacy/')).body, /first legacy/);

  fixture.useSecondRoot();

  const refreshed = await request(fixture.server, '/legacy/');
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.body, /second legacy/);
  assert.doesNotMatch(refreshed.body, /first legacy/);
});

test('fails closed with sanitized text for missing, oversized, and symbolic-link indexes', async (t) => {
  const fixture = await createFixture(t);
  const indexPath = path.join(fixture.firstRoot, 'index.html');

  fs.rmSync(indexPath);
  let response = await request(fixture.server, '/legacy/');
  assert.equal(response.status, 503);
  assert.equal(response.body, 'Legacy manager is unavailable.');
  assert.equal(response.cacheControl, 'no-store');
  assert.doesNotMatch(response.body, /batmelech-legacy-|private|tmp/);

  fs.writeFileSync(indexPath, Buffer.alloc(MAX_LEGACY_HTML_BYTES + 1));
  response = await request(fixture.server, '/legacy/');
  assert.equal(response.status, 503);

  fs.rmSync(indexPath);
  const outside = path.join(os.tmpdir(), `batmelech-outside-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(outside, 'outside secret');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, indexPath);
  response = await request(fixture.server, '/legacy/');
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body, /outside secret/);
});

test('does not treat nested or unrelated paths as the manager backup', async (t) => {
  const { server } = await createFixture(t);

  for (const requestPath of ['/legacy/api/state', '/legacy/assets/app.js', '/order-form.html']) {
    const response = await request(server, requestPath);
    assert.equal(response.status, 404);
    assert.equal(response.body, 'outside');
  }
});
