'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { PUBLIC_SITE_SECURITY_HEADERS, createReactAppRouter } = require('../server/react-app-route');

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
            headers: res.headers,
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
  app.use('/site', createReactAppRouter({ reactRoot, securityHeaders: PUBLIC_SITE_SECURITY_HEADERS }));
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

test('sends the public site security headers on shell, deep links and assets', async (t) => {
  const server = await fixture(t);
  const expectedCsp = PUBLIC_SITE_SECURITY_HEADERS['Content-Security-Policy'];

  for (const requestPath of ['/site/', '/site/checkout', '/site/assets/app.js']) {
    const response = await request(server, requestPath);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-security-policy'], expectedCsp);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  }
});

test('the public site policy allows every host the built bundle loads', async (t) => {
  const server = await fixture(t);
  const csp = (await request(server, '/site/')).headers['content-security-policy'];
  const directives = new Map(
    csp.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [name, ...values] = entry.split(/\s+/u);
      return [name, values];
    }),
  );

  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.ok(directives.get('style-src').includes('https://fonts.googleapis.com'));
  assert.ok(directives.get('font-src').includes('https://fonts.gstatic.com'));
  assert.ok(directives.get('img-src').includes('https://ggrhecslgdflloszjkwl.supabase.co'));
  assert.ok(directives.get('img-src').includes('https://randomuser.me'));
  for (const iconifyHost of ['https://api.iconify.design', 'https://api.simplesvg.com', 'https://api.unisvg.com']) {
    assert.ok(directives.get('connect-src').includes(iconifyHost));
  }
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-(inline|eval)/u);
});

test('leaves routers mounted without security headers untouched', async (t) => {
  const server = await fixture(t);

  for (const requestPath of ['/app/', '/app/orders/order-1/edit', '/api/state']) {
    const response = await request(server, requestPath);
    assert.equal(response.headers['content-security-policy'], undefined);
    assert.equal(response.headers['referrer-policy'], undefined);
  }
});

test('rejects a non-object securityHeaders option', () => {
  const reactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batmelech-react-route-'));
  assert.throws(() => createReactAppRouter({ reactRoot, securityHeaders: 'nosniff' }), TypeError);
  fs.rmSync(reactRoot, { recursive: true, force: true });
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
