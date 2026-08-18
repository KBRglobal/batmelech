'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PUBLIC_SITE_SECURITY_HEADERS } = require('../server/react-app-route');

const projectRoot = path.join(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');

function startDecoyServer(port, env = {}) {
  return spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BM_USER: 'decoy-test-user',
      BM_PASS: 'decoy-test-password',
      BM_SESSION_SECRET: 'decoy-test-session-secret',
      DATABASE_URL: '',
      PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(port, deadline = Date.now() + 5_000) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (response.ok) return;
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) throw new Error('server did not become healthy in time');
  await new Promise((resolve) => setTimeout(resolve, 100));
  return waitForHealth(port, deadline);
}

function cookieFrom(response, name) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    if (entry.startsWith(`${name}=`)) return entry.split(';')[0];
  }
  return null;
}

async function staffSessionCookie(port) {
  const step = async (message, cookie) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ message }),
    });
    await response.json();
    return response;
  };

  const username = await step('decoy-test-user');
  const challengeCookie = cookieFrom(username, 'bm_rq');
  assert.ok(challengeCookie, 'the username step must issue a challenge cookie');
  const password = await step('decoy-test-password', challengeCookie);
  const sessionCookie = cookieFrom(password, 'bm_ref');
  assert.ok(sessionCookie, 'the password step must issue a session cookie');
  return sessionCookie;
}

function startWithoutCredential(missingName) {
  const env = {
    ...process.env,
    BM_USER: 'configured-test-user',
    BM_PASS: 'configured-test-password',
    BM_SESSION_SECRET: 'configured-test-session-secret',
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

test('server fails closed when a staff-gate credential is absent', async (t) => {
  for (const missingName of ['BM_USER', 'BM_PASS', 'BM_SESSION_SECRET']) {
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
  const authIndex = source.indexOf("app.use(createDecoyGate(SESSION_SECRET));");
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
  // Hotel search is deliberately public: the customer checkout picks its
  // delivery hotel from it. It reads no customer or order state and rate limits
  // per IP, so it is the only /api route allowed in front of the gate.
  assert.ok(hotelSearchIndex > customerFormIndex, 'customer form must mount before hotel search');
  assert.ok(authIndex > hotelSearchIndex, 'only public routes (site, root, customer form, hotel search) may mount before the staff gate');
  assert.ok(operationsReviewIndex > authIndex, 'operations AI review must remain behind the staff gate');
  assert.ok(stateApiIndex > operationsReviewIndex, 'operations AI review must not shadow the state API');
  assert.ok(stateApiIndex > authIndex, 'state API must remain behind the staff gate');
  assert.ok(legacyManagerIndex > stateApiIndex, 'legacy manager backup must use the versioned state API');
  assert.ok(reactIndex > legacyManagerIndex, 'React must not shadow the legacy manager backup');
  assert.ok(legacyHtmlIndex > reactIndex, 'legacy HTML serving must remain explicit after the React app mount');
  assert.match(source, /app\.get\('\/healthz'/);
  assert.match(source, /createCustomerOrderRouter\(\{ getContentRoot: \(\) => contentRoot \}\)/);
  assert.equal(source.match(/app\.use\('\/api\/hotels\/search'/g)?.length, 1);
  // Public now, so it must stay wired to nothing: no repository, no pool, no secret.
  assert.match(source, /createHotelSearchRouter\(\)/);
  assert.equal(source.match(/app\.use\('\/api\/ai\/operations-review'/g)?.length, 1);
  assert.match(source, /createOperationsReviewRouter\(\)/);
  assert.match(source, /app\.get\(\/\^\\\/legacy\$\//);
  assert.match(source, /app\.get\(\/\^\\\/app\$\//);
  assert.match(source, /app\.get\(\/\^\\\/\$\//);
  assert.match(source, /response\.set\('Cache-Control', 'no-store'\)/);
  // Root only enters the authenticated React manager when the request already
  // carries a valid session (checked explicitly, not by relying on route
  // order) — everyone else gets the public site, never admin data.
  assert.match(source, /hasValidSession\(request, SESSION_SECRET\) \? '\/admin\/today' : '\/site\/'/);
  assert.match(source, /getContentRoot: \(\) => contentRoot/);
  assert.doesNotMatch(source, /app\.use\('\/'\s*,\s*createReactAppRouter/);
});

test('public customer form cannot receive the manager sync bootstrap or state API', () => {
  const source = fs.readFileSync(serverPath, 'utf8');
  const publicRouteIndex = source.indexOf("app.use('/order-form.html', createCustomerOrderRouter");
  const authIndex = source.indexOf("app.use(createDecoyGate(SESSION_SECRET));");
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
  assert.ok(source.indexOf("app.use('/index.html'") < source.indexOf('express.static(contentRoot)(req, res, next);'));
});

test('server fails closed before a database connection when the state capability is absent', () => {
  const env = {
    ...process.env,
    BM_USER: 'configured-test-user',
    BM_PASS: 'configured-test-password',
    BM_SESSION_SECRET: 'configured-test-session-secret',
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

test('the decoy gate: unauthenticated staff routes look like a 404, the hidden two-step form logs in', async () => {
  const port = 34871;
  const server = startDecoyServer(port);
  try {
    await waitForHealth(port);

    const before = await fetch(`http://127.0.0.1:${port}/admin/today`);
    assert.equal(before.status, 404);
    const decoyBody = await before.text();
    assert.match(decoyBody, /שלחו לנו הודעה/);
    assert.doesNotMatch(decoyBody, /מסך היום המחובר|window\.__BM_STATE__/);
    assert.match(decoyBody, /api\/site\/access/, 'the /admin decoy must post to the real login endpoint');

    const wrongUser = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'not-the-username' }),
    });
    const wrongUserBody = await wrongUser.json();
    assert.equal(wrongUser.status, 200);
    assert.equal(wrongUserBody.ref, undefined);
    assert.equal(cookieFrom(wrongUser, 'bm_rq'), null);

    const rightUser = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'decoy-test-user' }),
    });
    const rightUserBody = await rightUser.json();
    assert.equal(rightUser.status, 200);
    assert.ok(rightUserBody.ref, 'a correct username should look like an ordinary ticket reply');
    const challengeCookie = cookieFrom(rightUser, 'bm_rq');
    assert.ok(challengeCookie, 'a challenge cookie should be set after the username step');

    const wrongPass = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: challengeCookie },
      body: JSON.stringify({ message: 'not-the-password' }),
    });
    const wrongPassBody = await wrongPass.json();
    assert.equal(wrongPassBody.ref, undefined, 'a wrong password must look identical to a wrong username');

    const restartUser = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'decoy-test-user' }),
    });
    const restartChallenge = cookieFrom(restartUser, 'bm_rq');
    assert.ok(restartChallenge, 'the flow must restart from the username step after any wrong step');

    const rightPass = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: restartChallenge },
      body: JSON.stringify({ message: 'decoy-test-password' }),
    });
    const rightPassBody = await rightPass.json();
    assert.ok(rightPassBody.ref, 'a correct password should look like an ordinary ticket reply');
    const sessionCookie = cookieFrom(rightPass, 'bm_ref');
    assert.ok(sessionCookie, 'a session cookie should be set after both steps succeed');

    const after = await fetch(`http://127.0.0.1:${port}/admin/today`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(after.status, 200);
    const realBody = await after.text();
    assert.match(realBody, /<div id="root"/);
  } finally {
    server.kill();
  }
});

test('the decoy login locks an IP out after repeated wrong attempts, even once it finally guesses right', async () => {
  const port = 34872;
  const server = startDecoyServer(port);
  try {
    await waitForHealth(port);

    for (let i = 0; i < 3; i += 1) {
      const attempt = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `wrong-${i}` }),
      });
      const body = await attempt.json();
      assert.equal(body.ref, undefined);
    }

    const nowCorrect = await fetch(`http://127.0.0.1:${port}/api/site/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'decoy-test-user' }),
    });
    const nowCorrectBody = await nowCorrect.json();
    assert.equal(nowCorrectBody.ref, undefined, 'a blocked IP must not get in even with the right username');
  } finally {
    server.kill();
  }
});

test('every other 404 site-wide shows the same decoy page, whose form has no login capability', async () => {
  const port = 34873;
  const server = startDecoyServer(port);
  try {
    await waitForHealth(port);

    const randomPath = await fetch(`http://127.0.0.1:${port}/wp-admin/setup-config.php`);
    assert.equal(randomPath.status, 404);
    const randomBody = await randomPath.text();
    assert.match(randomBody, /שלחו לנו הודעה/, 'a random unmatched path must still get the decoy, not a bare 404');
    assert.match(randomBody, /api\/site\/contact/, 'the generic decoy must post to the message-only endpoint');
    assert.doesNotMatch(randomBody, /api\/site\/access/, 'the generic decoy must never reference the login endpoint');

    const correctUsernameAsMessage = await fetch(`http://127.0.0.1:${port}/api/site/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'decoy-test-user' }),
    });
    const body = await correctUsernameAsMessage.json();
    assert.equal(correctUsernameAsMessage.status, 200);
    assert.equal(body.ref, undefined, 'the generic endpoint must never advance a login, even with the real username');
    assert.equal(cookieFrom(correctUsernameAsMessage, 'bm_rq'), null, 'the generic endpoint must never set a challenge cookie');
    assert.equal(cookieFrom(correctUsernameAsMessage, 'bm_ref'), null, 'the generic endpoint must never set a session cookie');
  } finally {
    server.kill();
  }
});

test('the public site is served under a strict CSP that the admin build never inherits', async () => {
  const port = 34875;
  const server = startDecoyServer(port);
  try {
    await waitForHealth(port);

    const site = await fetch(`http://127.0.0.1:${port}/site/`);
    assert.equal(site.status, 200);
    assert.equal(site.headers.get('content-security-policy'), PUBLIC_SITE_SECURITY_HEADERS['Content-Security-Policy']);
    assert.equal(site.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(site.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

    // Deep links and hashed assets go through the same mount, so they must
    // carry the policy too — a CSP only on the shell protects nothing.
    const deepLink = await fetch(`http://127.0.0.1:${port}/site/weekdays`);
    assert.equal(deepLink.headers.get('content-security-policy'), site.headers.get('content-security-policy'));

    // The authenticated admin build shares the router factory but not the
    // policy: its needs differ and tightening it here would break Lin's app.
    const sessionCookie = await staffSessionCookie(port);
    const admin = await fetch(`http://127.0.0.1:${port}/admin/today`, { headers: { Cookie: sessionCookie } });
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get('content-security-policy'), null);
    assert.equal(admin.headers.get('referrer-policy'), null);
  } finally {
    server.kill();
  }
});

test('an unauthenticated request never gets repo source files as static content', async () => {
  // contentRoot is the whole repo checkout (see server.js), not a curated
  // public/ folder. Regression test for a real bug introduced while scoping
  // the decoy gate to protected prefixes: unmatched paths started falling
  // through past the gate straight into express.static(contentRoot),
  // serving server.js, package.json, STATE.md, etc. to anyone.
  const port = 34874;
  const server = startDecoyServer(port);
  try {
    await waitForHealth(port);

    for (const filePath of ['/server.js', '/package.json', '/STATE.md']) {
      const response = await fetch(`http://127.0.0.1:${port}${filePath}`);
      assert.equal(response.status, 404, `${filePath} must not be served unauthenticated`);
      const body = await response.text();
      assert.match(body, /שלחו לנו הודעה/, `${filePath} must get the decoy page, not its real file content`);
    }
  } finally {
    server.kill();
  }
});

test('staff-only API prefixes are behind the decoy gate', () => {
  const { PROTECTED_PREFIXES } = require('../server/auth/decoy-auth');
  for (const prefix of ['/api/mey', '/api/invoices', '/api/ai', '/api/state', '/api/settings', '/api/holidays', '/api/tracking-link']) {
    assert.ok(PROTECTED_PREFIXES.includes(prefix), `${prefix} must be decoy-gated`);
  }
});

test('site-only host gate blocks every staff surface including the hidden login', async () => {
  const { createSiteOnlyHostGate } = require('../server/auth/decoy-auth');
  const express = require('express');
  const http = require('node:http');
  const app = express();
  app.use(createSiteOnlyHostGate('batmelech.ae, www.batmelech.ae'));
  app.use((request, response) => response.status(200).send('through'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const get = async (path, host) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'X-Forwarded-Host': host } });
    return { status: response.status, body: await response.text() };
  };
  try {
    for (const path of ['/admin/', '/app/today', '/api/state', '/api/site/access', '/api/mey/audit/', '/legacy/']) {
      const blocked = await get(path, 'batmelech.ae');
      assert.equal(blocked.status, 404, `${path} must be blocked on the public host`);
      assert.doesNotMatch(blocked.body, /through/);
    }
    // Public + kitchen + tracking surfaces stay reachable on the public host.
    for (const path of ['/site/', '/api/site/catalog', '/kitchen', '/api/kitchen/state', '/t/x/y']) {
      assert.equal((await get(path, 'www.batmelech.ae')).status, 200, `${path} must pass on the public host`);
    }
    // Other hosts are untouched.
    assert.equal((await get('/admin/', 'app-production.example')).status, 200);
    // Unset env -> complete no-op.
    const noop = express();
    noop.use(createSiteOnlyHostGate(undefined));
    noop.use((request, response) => response.status(200).send('open'));
    const noopServer = http.createServer(noop);
    await new Promise((resolve) => noopServer.listen(0, resolve));
    const noopPort = noopServer.address().port;
    const open = await fetch(`http://127.0.0.1:${noopPort}/admin/`, { headers: { 'X-Forwarded-Host': 'batmelech.ae' } });
    assert.equal(open.status, 200);
    noopServer.close();
  } finally {
    server.close();
  }
});
