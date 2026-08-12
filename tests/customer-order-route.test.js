'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const {
  MAX_CUSTOMER_FORM_BYTES,
  createCustomerOrderRouter,
} = require('../server/customer-order-route');

function request(server, requestPath, method = 'GET') {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP server is not ready');
  return new Promise((resolve, reject) => {
    const requestHandle = http.request(
      { hostname: '127.0.0.1', port: address.port, path: requestPath, method },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    requestHandle.on('error', reject);
    requestHandle.end();
  });
}

async function fixture(t) {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-customer-first-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-customer-second-'));
  t.after(() => fs.rmSync(firstRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(secondRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(firstRoot, 'order-form.html'), '<!doctype html><html><body>first customer form</body></html>');
  fs.writeFileSync(path.join(secondRoot, 'order-form.html'), '<!doctype html><html><body>second customer form</body></html>');
  let contentRoot = firstRoot;

  const app = express();
  app.use('/order-form.html', createCustomerOrderRouter({ getContentRoot: () => contentRoot }));
  app.use((_request, response) => response.status(401).send('protected'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return { firstRoot, secondRoot, server, useSecondRoot: () => { contentRoot = secondRoot; } };
}

test('serves only the customer form without authentication or administrative bootstrap', async (t) => {
  const { server } = await fixture(t);
  for (const method of ['GET', 'HEAD']) {
    const response = await request(server, '/order-form.html', method);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/html/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
    assert.doesNotMatch(response.body, /bm-sync\.js|\/api\/state/);
  }
});

test('reads the latest safe content root on each customer request', async (t) => {
  const instance = await fixture(t);
  assert.match((await request(instance.server, '/order-form.html')).body, /first customer form/);
  instance.useSecondRoot();
  const refreshed = await request(instance.server, '/order-form.html');
  assert.match(refreshed.body, /second customer form/);
  assert.doesNotMatch(refreshed.body, /first customer form/);
});

test('leaves every other path and non-read method protected', async (t) => {
  const { server } = await fixture(t);
  for (const [requestPath, method] of [
    ['/api/state', 'GET'], ['/app/', 'GET'], ['/legacy/', 'GET'],
    ['/index.html', 'GET'], ['/order.html', 'GET'], ['/order-form.html/extra', 'GET'],
    ['/order-form.html', 'POST'],
  ]) {
    const response = await request(server, requestPath, method);
    assert.equal(response.status, 401, `${method} ${requestPath}`);
    assert.equal(response.body, 'protected');
  }
});

test('fails closed for missing, oversized, symlinked, and admin-state forms', async (t) => {
  const instance = await fixture(t);
  const formPath = path.join(instance.firstRoot, 'order-form.html');

  fs.rmSync(formPath);
  let response = await request(instance.server, '/order-form.html');
  assert.equal(response.status, 503);
  assert.equal(response.body, 'Customer order form is unavailable.');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
  assert.doesNotMatch(response.body, /batmelech-customer-|private|tmp/);

  fs.writeFileSync(formPath, Buffer.alloc(MAX_CUSTOMER_FORM_BYTES + 1));
  response = await request(instance.server, '/order-form.html');
  assert.equal(response.status, 503);

  fs.rmSync(formPath);
  const outside = path.join(os.tmpdir(), `batmelech-customer-outside-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(outside, 'outside secret');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, formPath);
  response = await request(instance.server, '/order-form.html');
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body, /outside secret/);

  fs.rmSync(formPath);
  fs.writeFileSync(formPath, '<script src="/bm-sync.js"></script>');
  response = await request(instance.server, '/order-form.html');
  assert.equal(response.status, 503);
  fs.writeFileSync(formPath, '<script>fetch("/api/state")</script>');
  response = await request(instance.server, '/order-form.html');
  assert.equal(response.status, 503);
});
