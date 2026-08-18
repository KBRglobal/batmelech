'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  KITCHEN_COOKIE,
  createKitchenApiRouter,
  createKitchenAppRouter,
  createKitchenAssetBridge,
  createKitchenLoginRouter,
  hasValidKitchenSession,
} = require('../server/auth/kitchen-route');
const { SESSION_COOKIE, hasValidSession } = require('../server/auth/decoy-auth');

const SECRET = 'test-session-secret';

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() {
      return { data: structuredClone(state), revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = structuredClone(localState);
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
  };
}

function kitchenState() {
  return {
    orders: [
      {
        id: 'a1',
        date: '2099-08-14',
        status: 'אושרה',
        name: 'קטי סודי',
        phone: '+971500000000',
        email: 'secret@example.com',
        address: 'מלון סודי, חדר 12',
        notes: 'הערה פרטית',
        total: 999,
        paid: 'לא',
        payMethod: 'מזומן',
        salads: { 'מטבוחה': { o: 2 } },
        mains: { 'עוף': 3 },
      },
    ],
    prepDone: {},
    settings: { preparationCatalog: { items: [], lunchItems: [] } },
    menu: {},
  };
}

async function serve(build) {
  const app = express();
  build(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => server.close(),
  };
}

async function loginCookie(baseUrl) {
  const response = await fetch(`${baseUrl}/api/kitchen/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'lin', pass: 'lin123' }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(KITCHEN_COOKIE));
  return setCookie.split(';')[0];
}

test('kitchen login issues a scoped cookie; wrong credentials are refused', async () => {
  const site = await serve((app) => {
    app.use('/api/kitchen/login', createKitchenLoginRouter({
      kitchenUser: 'lin',
      kitchenPass: 'lin123',
      sessionSecret: SECRET,
    }));
  });
  try {
    const cookie = await loginCookie(site.url(''));

    const request = { headers: { cookie } };
    assert.equal(hasValidKitchenSession(request, SECRET), true);
    // The kitchen token must never be accepted as a staff session, even if
    // replayed under the staff cookie name.
    const kitchenToken = cookie.split('=').slice(1).join('=');
    assert.equal(hasValidSession({ headers: { cookie: `${SESSION_COOKIE}=${kitchenToken}` } }, SECRET), false);

    const bad = await fetch(site.url('/api/kitchen/login/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'lin', pass: 'wrong' }),
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('set-cookie'), null);
  } finally {
    site.close();
  }
});

test('kitchen state is a strict whitelist — no phones, payments, or notes leave the server', async () => {
  const repository = fakeRepository(kitchenState());
  const site = await serve((app) => {
    app.use('/api/kitchen/login', createKitchenLoginRouter({ kitchenUser: 'lin', kitchenPass: 'lin123', sessionSecret: SECRET }));
    app.use('/api/kitchen', createKitchenApiRouter({ repository, sessionSecret: SECRET, logger: { error() {} } }));
  });
  try {
    const noAuth = await fetch(site.url('/api/kitchen/state'));
    assert.equal(noAuth.status, 401);

    const cookie = await loginCookie(site.url(''));
    const response = await fetch(site.url('/api/kitchen/state'), { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    const order = body.data.orders[0];
    assert.equal(order.id, 'a1');
    assert.deepEqual(order.mains, { 'עוף': 3 });
    assert.equal(order.name, 'קטי סודי'); // the cook needs to see whose order it is
    for (const forbidden of ['phone', 'email', 'address', 'notes', 'total', 'paid', 'payMethod']) {
      assert.equal(order[forbidden], undefined, `${forbidden} must not be exposed to the kitchen surface`);
    }
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /971500000000|secret@example|חדר 12|הערה פרטית/u);
  } finally {
    site.close();
  }
});

test('prep toggle writes only the prepDone map and validates its input', async () => {
  const repository = fakeRepository(kitchenState());
  const site = await serve((app) => {
    app.use('/api/kitchen/login', createKitchenLoginRouter({ kitchenUser: 'lin', kitchenPass: 'lin123', sessionSecret: SECRET }));
    app.use('/api/kitchen', createKitchenApiRouter({ repository, sessionSecret: SECRET, logger: { error() {} } }));
  });
  try {
    const cookie = await loginCookie(site.url(''));
    const before = JSON.stringify(repository._current().orders);

    const ok = await fetch(site.url('/api/kitchen/prep-toggle'), {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceDate: '2099-08-14', category: 'mains', itemName: 'עוף', completed: true }),
    });
    assert.equal(ok.status, 200);
    assert.equal(repository._current().prepDone['2099-08-14']['mains|עוף'], true);
    assert.equal(JSON.stringify(repository._current().orders), before, 'orders must be untouched');

    const off = await fetch(site.url('/api/kitchen/prep-toggle'), {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceDate: '2099-08-14', category: 'mains', itemName: 'עוף', completed: false }),
    });
    assert.equal(off.status, 200);
    assert.equal(repository._current().prepDone['2099-08-14']['mains|עוף'], undefined);

    for (const bad of [
      { serviceDate: 'not-a-date', category: 'mains', itemName: 'עוף', completed: true },
      { serviceDate: '2099-08-14', category: 'orders', itemName: 'עוף', completed: true },
      { serviceDate: '2099-08-14', category: 'mains', itemName: '', completed: true },
      { serviceDate: '2099-08-14', category: 'mains', itemName: 'עוף', completed: 'yes' },
    ]) {
      const rejected = await fetch(site.url('/api/kitchen/prep-toggle'), {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(bad),
      });
      assert.equal(rejected.status, 400);
    }
  } finally {
    site.close();
  }
});

test('kitchen app serves the login page without a session and the bundle with one; asset bridge is scoped', async () => {
  const reactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-react-'));
  fs.writeFileSync(path.join(reactRoot, 'index.html'), '<!doctype html><title>bundle</title>');
  fs.mkdirSync(path.join(reactRoot, 'assets'));
  fs.writeFileSync(path.join(reactRoot, 'assets', 'main.js'), 'console.log(1)');

  const site = await serve((app) => {
    app.use('/api/kitchen/login', createKitchenLoginRouter({ kitchenUser: 'lin', kitchenPass: 'lin123', sessionSecret: SECRET }));
    app.use('/kitchen', createKitchenAppRouter({ reactRoot, sessionSecret: SECRET }));
    app.use('/app', createKitchenAssetBridge({ reactRoot, sessionSecret: SECRET }));
    app.use((_request, response) => response.status(404).send('decoy'));
  });
  try {
    const anonymous = await fetch(site.url('/kitchen'));
    assert.equal(anonymous.status, 200);
    assert.match(await anonymous.text(), /מצב מטבח/u);

    const anonymousAsset = await fetch(site.url('/app/assets/main.js'));
    assert.equal(anonymousAsset.status, 404);

    const cookie = await loginCookie(site.url(''));
    const board = await fetch(site.url('/kitchen'), { headers: { cookie } });
    assert.match(await board.text(), /bundle/u);

    const asset = await fetch(site.url('/app/assets/main.js'), { headers: { cookie } });
    assert.equal(asset.status, 200);

    // Extension-less /app paths (the admin SPA itself) stay behind the decoy
    // gate even for a kitchen session.
    const adminSpa = await fetch(site.url('/app/today'), { headers: { cookie } });
    assert.equal(adminSpa.status, 404);
  } finally {
    site.close();
    fs.rmSync(reactRoot, { recursive: true, force: true });
  }
});

test('kitchen one-tap order status is bounded to the known statuses', async () => {
  const repository = fakeRepository(kitchenState());
  const site = await serve((app) => {
    app.use('/api/kitchen/login', createKitchenLoginRouter({ kitchenUser: 'lin', kitchenPass: 'lin123', sessionSecret: SECRET }));
    app.use('/api/kitchen', createKitchenApiRouter({ repository, sessionSecret: SECRET, logger: { error() {} } }));
  });
  try {
    const cookie = await loginCookie(site.url(''));

    const ok = await fetch(site.url('/api/kitchen/order-status'), {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'a1', status: 'מוכנה' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(repository._current().orders[0].status, 'מוכנה');

    const badStatus = await fetch(site.url('/api/kitchen/order-status'), {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'a1', status: 'בוטלה' }),
    });
    assert.equal(badStatus.status, 400);

    const missingOrder = await fetch(site.url('/api/kitchen/order-status'), {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'nope', status: 'מוכנה' }),
    });
    assert.equal(missingOrder.status, 409);

    const anonymous = await fetch(site.url('/api/kitchen/order-status'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'a1', status: 'מוכנה' }),
    });
    assert.equal(anonymous.status, 401);
  } finally {
    site.close();
  }
});
