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
