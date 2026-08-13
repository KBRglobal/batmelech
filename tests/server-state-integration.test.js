'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');

test('server mounts one injected versioned state router behind authentication', () => {
  const customerFormIndex = source.indexOf("app.use('/order-form.html', createCustomerOrderRouter");
  const authIndex = source.indexOf("app.use((req, res, next) => {");
  const stateIndex = source.indexOf("app.use('/api/state', createStateRouter");
  const legacyIndex = source.indexOf("app.use('/legacy', createLegacyManagerRouter");
  const reactIndex = source.indexOf("app.use('/app', createReactAppRouter");

  assert.ok(customerFormIndex >= 0);
  assert.ok(authIndex > customerFormIndex);
  assert.ok(stateIndex > authIndex);
  assert.ok(legacyIndex > stateIndex);
  assert.ok(reactIndex > legacyIndex);
  assert.equal(source.match(/createStateRouter\(/g)?.length, 1);
  assert.match(source, /createStateSafetyService\(\{ repository: stateRepository \}\)/);
});

test('server waits for repository initialization before listening', () => {
  const startupIndex = source.indexOf('startAfterStateInitialization({');
  const repositoryOptionIndex = source.indexOf('repository: stateRepository', startupIndex);
  const listenOptionIndex = source.indexOf('listen: () => app.listen(', startupIndex);

  assert.ok(startupIndex >= 0);
  assert.ok(repositoryOptionIndex > startupIndex);
  assert.ok(listenOptionIndex > repositoryOptionIndex);
  assert.doesNotMatch(source, /^app\.listen\(/m);
});

test('server owns no direct state SQL or legacy last-write-wins handler', () => {
  assert.doesNotMatch(source, /SELECT data, updated_at FROM bm_state/i);
  assert.doesNotMatch(source, /INSERT INTO bm_state/i);
  assert.doesNotMatch(source, /ON CONFLICT \(id\) DO UPDATE SET data/i);
  assert.doesNotMatch(source, /app\.post\(['"]\/api\/state/);
  assert.doesNotMatch(source, /app\.get\(['"]\/api\/state/);
});

test('direct React customer HTML aliases leave the app before extension-safe routing', () => {
  const aliasesIndex = source.indexOf("app.get(['/app/order-form.html', '/app/order.html']");
  const reactIndex = source.indexOf("app.use('/app', createReactAppRouter");

  assert.ok(aliasesIndex >= 0);
  assert.ok(reactIndex > aliasesIndex);
  assert.match(
    source.slice(aliasesIndex, reactIndex),
    /Cache-Control', 'no-store'[\s\S]*?response\.redirect\(302, '\/order-form\.html'\)/u,
  );
  assert.doesNotMatch(source.slice(aliasesIndex, reactIndex), /createLegacyManagerRouter|bm-sync/u);
});
