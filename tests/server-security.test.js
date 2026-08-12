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
      assert.doesNotMatch(result.stderr, /lin123/);
    });
  }
});

test('server source contains no fallback credential or state deletion route', () => {
  const source = fs.readFileSync(serverPath, 'utf8');

  assert.doesNotMatch(source, /process\.env\.BM_USER\s*\|\|/);
  assert.doesNotMatch(source, /process\.env\.BM_PASS\s*\|\|/);
  assert.doesNotMatch(source, /app\.delete\s*\(\s*['"]\/api\/state/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+bm_state/i);
});

test('React production route remains behind auth and cannot shadow APIs or legacy HTML', () => {
  const source = fs.readFileSync(serverPath, 'utf8');
  const authIndex = source.indexOf("app.use((req, res, next) => {");
  const stateApiIndex = source.indexOf("app.get('/api/state'");
  const reactIndex = source.indexOf("app.use('/app', createReactAppRouter");
  const legacyHtmlIndex = source.indexOf('// --- HTML: inject the sync script');

  assert.ok(authIndex >= 0, 'Basic Auth middleware must exist');
  assert.ok(stateApiIndex > authIndex, 'state API must remain behind Basic Auth');
  assert.ok(reactIndex > stateApiIndex, 'React mount must not shadow the state API');
  assert.ok(legacyHtmlIndex > reactIndex, 'legacy HTML serving must remain separate after /app');
  assert.match(source, /app\.get\('\/healthz'/);
  assert.match(source, /app\.get\(\/\^\\\/app\$\//);
  assert.doesNotMatch(source, /app\.use\('\/'\s*,\s*createReactAppRouter/);
});
