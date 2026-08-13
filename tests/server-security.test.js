'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');

function startWithoutCredential(missingName) {
  const env = {
    ...process.env,
    BM_USER: 'configured-test-user',
    BM_PASS: 'configured-test-password',
    DATABASE_URL: '',
  };
  delete env[missingName];

  return spawnSync(process.execPath, [serverPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
    timeout: 5_000,
  });
}

test('server fails closed when either Basic Auth credential is absent', async (t) => {
  for (const missingName of ['BM_USER', 'BM_PASS']) {
    await t.test(missingName, () => {
      const result = startWithoutCredential(missingName);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`${missingName} must be configured\\.`));
      assert.doesNotMatch(result.stderr, /configured-test-password/);
    });
  }
});

test('server source contains no fallback credential or state deletion route', () => {
  const source = fs.readFileSync(serverPath, 'utf8');

  assert.doesNotMatch(source, /process\.env\.BM_USER\s*\|\|/);
  assert.doesNotMatch(source, /process\.env\.BM_PASS\s*\|\|/);
  assert.doesNotMatch(source, /app\.delete\s*\(\s*['"]\/api\/state/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+bm_state/i);
  assert.doesNotMatch(source, /ON CONFLICT \(id\) DO UPDATE SET data/i);
  assert.doesNotMatch(source, /INSERT INTO bm_state/i);
  assert.match(source, /requireServerCredential\('BM_STATE_COMMAND_SECRET'\)/);
});

test('production serves only its immutable deployed source tree', () => {
  const source = fs.readFileSync(serverPath, 'utf8');

  assert.match(source, /const contentRoot = ROOT;/);
  assert.doesNotMatch(source, /api\.github\.com|codeload\.github\.com/);
  assert.doesNotMatch(source, /execFile|child_process/);
  assert.doesNotMatch(source, /tar\.gz|\['xzf'/);
  assert.doesNotMatch(source, /refreshContent|BM_REFRESH_MS|BM_BRANCH|BM_REPO/);
});

test('React production route remains behind auth and cannot shadow APIs or legacy HTML', () => {
  const source = fs.readFileSync(serverPath, 'utf8');
  const healthIndex = source.indexOf("app.get('/healthz'");
  const siteStaticIndex = source.indexOf("app.use('/site', createReactAppRouter(");
  const rootIndex = source.indexOf("app.get(/^\\/$/, (request, response) => {");
  const customerFormIndex = source.indexOf("app.use('/order-form.html', createCustomerOrderRouter");
  const authIndex = source.indexOf("app.use((req, res, next) => {");
  const operationsReviewIndex = source.indexOf("app.use('/api/ai/operations-review', createOperationsReviewRouter");
  const hotelSearchIndex = source.indexOf("app.use('/api/hotels/search', createHotelSearchRouter");
  const stateApiIndex = source.indexOf("app.use('/api/state'");
  const legacyManagerIndex = source.indexOf("app.use('/legacy', createLegacyManagerRouter");
  const reactIndex = source.indexOf("app.use('/app', createReactAppRouter");
  const legacyHtmlIndex = source.indexOf("app.use('/index.html', createLegacyManagerRouter");

  assert.ok(healthIndex >= 0, 'health route must exist');
  assert.ok(siteStaticIndex > healthIndex, 'public site static mount must exist');
  assert.ok(rootIndex > siteStaticIndex, 'root route must mount after the public site static files');
  assert.ok(customerFormIndex > rootIndex, 'root must mount before the customer form');
  assert.ok(authIndex > customerFormIndex, 'only public routes (site, root, customer form) may mount before auth');
  assert.ok(operationsReviewIndex > authIndex, 'operations AI review must remain behind Basic Auth');
  assert.ok(hotelSearchIndex > operationsReviewIndex, 'operations AI review must not shadow hotel search');
  assert.ok(hotelSearchIndex > authIndex, 'hotel search must remain behind Basic Auth');
  assert.ok(stateApiIndex > hotelSearchIndex, 'hotel search must not shadow the state API');
  assert.ok(stateApiIndex > authIndex, 'state API must remain behind Basic Auth');
  assert.ok(legacyManagerIndex > stateApiIndex, 'legacy manager backup must use the versioned state API');
  assert.ok(reactIndex > legacyManagerIndex, 'React must not shadow the legacy manager backup');
  assert.ok(legacyHtmlIndex > reactIndex, 'legacy HTML serving must remain explicit after the React app mount');
  assert.match(source, /app\.get\('\/healthz'/);
  assert.match(source, /createCustomerOrderRouter\(\{ getContentRoot: \(\) => contentRoot \}\)/);
  assert.equal(source.match(/app\.use\('\/api\/hotels\/search'/g)?.length, 1);
  assert.equal(source.match(/app\.use\('\/api\/ai\/operations-review'/g)?.length, 1);
  assert.match(source, /createOperationsReviewRouter\(\)/);
  assert.match(source, /app\.get\(\/\^\\\/legacy\$\//);
  assert.match(source, /app\.get\(\/\^\\\/app\$\//);
  assert.match(source, /app\.get\(\/\^\\\/\$\//);
  assert.match(source, /response\.set\('Cache-Control', 'no-store'\)/);
  // Root only enters the authenticated React manager when the request already
  // carries valid Basic Auth (checked explicitly, not by relying on route
  // order) — everyone else gets the public site, never admin data.
  assert.match(source, /hasValidBasicAuth\(request\) \? '\/app\/today' : '\/site\/'/);
  assert.match(source, /getContentRoot: \(\) => contentRoot/);
  assert.doesNotMatch(source, /app\.use\('\/'\s*,\s*createReactAppRouter/);
});

test('public customer form cannot receive the manager sync bootstrap or state API', () => {
  const source = fs.readFileSync(serverPath, 'utf8');
  const publicRouteIndex = source.indexOf("app.use('/order-form.html', createCustomerOrderRouter");
  const authIndex = source.indexOf("app.use((req, res, next) => {");
  const jsonIndex = source.indexOf('app.use(express.json');
  const stateApiIndex = source.indexOf("app.use('/api/state'");
  const htmlInjectionIndex = source.indexOf("app.use('/index.html', createLegacyManagerRouter");

  assert.ok(publicRouteIndex >= 0);
  assert.ok(authIndex > publicRouteIndex);
  assert.ok(jsonIndex > authIndex);
  assert.ok(stateApiIndex > jsonIndex);
  assert.ok(htmlInjectionIndex > stateApiIndex);
  assert.equal(source.match(/app\.use\('\/order-form\.html'/g)?.length, 1);
});

test('stale HTML bookmarks redirect before the explicit legacy entry', () => {
  const source = fs.readFileSync(serverPath, 'utf8');
  const staleManagerIndex = source.indexOf("app.get('/app.html'");
  const staleCustomerIndex = source.indexOf("app.get('/order.html'");
  const genericHtmlIndex = source.indexOf("app.use('/index.html', createLegacyManagerRouter");

  assert.ok(staleManagerIndex >= 0);
  assert.ok(staleCustomerIndex > staleManagerIndex);
  assert.ok(genericHtmlIndex > staleCustomerIndex);
  assert.match(source, /app\.get\('\/app\.html'[\s\S]*?response\.redirect\(302, '\/app\/today'\)/u);
  assert.match(source, /app\.get\('\/order\.html'[\s\S]*?response\.redirect\(302, '\/order-form\.html'\)/u);
  assert.match(source.slice(staleManagerIndex, staleCustomerIndex), /Cache-Control', 'no-store'/u);
  assert.match(source.slice(staleCustomerIndex, genericHtmlIndex), /Cache-Control', 'no-store'/u);
});

test('only explicit legacy manager entry points can receive the sync bootstrap', () => {
  const source = fs.readFileSync(serverPath, 'utf8');

  assert.equal(source.match(/createLegacyManagerRouter\(\{ getContentRoot: \(\) => contentRoot \}\)/g)?.length, 2);
  assert.match(source, /app\.use\('\/legacy', createLegacyManagerRouter/);
  assert.match(source, /app\.use\('\/index\.html', createLegacyManagerRouter/);
  assert.doesNotMatch(source, /endsWith\('\.html'\)|readFile\(file|replace\('<head>'/);
  assert.ok(source.indexOf("app.use('/index.html'") < source.indexOf("app.use((req, res, next) => express.static"));
});

test('server fails closed before a database connection when the state capability is absent', () => {
  const env = {
    ...process.env,
    BM_USER: 'configured-test-user',
    BM_PASS: 'configured-test-password',
    DATABASE_URL: 'postgres://127.0.0.1:1/never_contact_this_database',
  };
  delete env.BM_STATE_COMMAND_SECRET;

  const result = spawnSync(process.execPath, [serverPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
    timeout: 5_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BM_STATE_COMMAND_SECRET must be configured\./);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|connect ECONN/);
});
