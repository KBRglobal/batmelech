'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { createReactAppRouter } = require('../server/react-app-route');

function request(server, requestPath) {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP server is not ready');

  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: address.port, path: requestPath },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
  });
}

async function fixture(t, withBuild = true) {
  const reactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-react-route-'));
  t.after(() => fs.rmSync(reactRoot, { recursive: true, force: true }));

  if (withBuild) {
    fs.mkdirSync(path.join(reactRoot, 'assets'));
    fs.writeFileSync(path.join(reactRoot, 'index.html'), '<!doctype html><main>React shell</main>');
    fs.writeFileSync(path.join(reactRoot, 'assets', 'app.js'), 'window.BAT_MELECH = true;');
  }

  const app = express();
  app.get('/api/state', (req, res) => res.json({ api: true }));
  app.use('/app', createReactAppRouter({ reactRoot }));
  app.use((req, res) => res.status(404).send('outside'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return server;
}

test('serves the built shell and assets below the isolated app prefix', async (t) => {
  const server = await fixture(t);

  const shell = await request(server, '/app/');
  assert.equal(shell.status, 200);
  assert.match(shell.contentType, /^text\/html/);
  assert.match(shell.body, /React shell/);

  const asset = await request(server, '/app/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.contentType, /javascript/);
  assert.match(asset.body, /BAT_MELECH/);
});

test('returns the React shell for history routes but not missing asset paths', async (t) => {
  const server = await fixture(t);

  const route = await request(server, '/app/orders/order-1/edit');
  assert.equal(route.status, 200);
  assert.match(route.body, /React shell/);

  const missingAsset = await request(server, '/app/assets/missing.js');
  assert.equal(missingAsset.status, 404);
  assert.equal(missingAsset.body, 'outside');
});

test('returns a sanitized unavailable response when the React build is absent', async (t) => {
  const server = await fixture(t, false);
  const response = await request(server, '/app/');

  assert.equal(response.status, 503);
  assert.equal(response.body, 'React application is unavailable.');
  assert.doesNotMatch(response.body, /batmelech-react-route-|Users|private\/tmp/);
});

test('does not intercept root API or unrelated legacy paths', async (t) => {
  const server = await fixture(t);

  const api = await request(server, '/api/state');
  assert.equal(api.status, 200);
  assert.equal(api.body, '{"api":true}');

  const legacy = await request(server, '/order-form.html');
  assert.equal(legacy.status, 404);
  assert.equal(legacy.body, 'outside');
});
