'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createPublicHolidaysRouter, createHolidaysAdminRouter } = require('../server/holidays/holidays-route');
const { dubaiDayString, addDays } = require('../server/holidays/hebrew-calendar');

function fakeRepository(data, { failSaves = 0 } = {}) {
  let remainingFailures = failSaves;
  const repo = {
    data,
    revision: 1,
    saves: [],
    async loadState() {
      return { data: repo.data, revision: repo.revision, hash: 'h' };
    },
    async saveState({ localState }) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return { ok: false };
      }
      repo.data = localState;
      repo.revision += 1;
      repo.saves.push(localState);
      return { ok: true, revision: repo.revision };
    },
  };
  return repo;
}

async function withServer(configure, run) {
  const app = express();
  configure(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const silentLogger = { error() {} };
const today = dubaiDayString();

function menuFixture(overrides = {}) {
  return {
    id: 'm-rosh-1',
    holidayKey: 'rosh-hashanah',
    title: { he: 'תפריט ראש השנה', en: 'Rosh Hashanah Menu', fr: 'Menu de Roch Hachana' },
    dishes: [
      {
        name: 'ראש דג עם סילאן',
        displayName: { en: 'Fish head with silan', fr: 'Tête de poisson au silan' },
        priceUsd: 25,
      },
    ],
    publishFrom: addDays(today, -3),
    publishUntil: addDays(today, 10),
    orderCutoff: addDays(today, 5),
    ...overrides,
  };
}

test('public route returns the upcoming calendar plus only the active menus', async () => {
  const activeMenu = menuFixture({ adminSecret: 'never leaks' });
  const futureMenu = menuFixture({
    id: 'm-pesach-1',
    holidayKey: 'pesach',
    publishFrom: addDays(today, 30),
    publishUntil: addDays(today, 60),
    orderCutoff: addDays(today, 40),
  });
  const expiredMenu = menuFixture({
    id: 'm-old',
    publishFrom: addDays(today, -40),
    publishUntil: addDays(today, -20),
    orderCutoff: addDays(today, -25),
  });
  const repo = fakeRepository({
    orders: [],
    settings: { holidayMenus: [activeMenu, futureMenu, expiredMenu] },
  });

  await withServer(
    (app) => app.use('/api/site/holidays', createPublicHolidaysRouter({ repository: repo, logger: silentLogger })),
    async (base) => {
      const response = await fetch(`${base}/api/site/holidays`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') ?? '', /public, max-age=300/);
      const body = await response.json();

      // The 13-month calendar always carries the nine known holidays.
      assert.equal(Array.isArray(body.holidays), true);
      assert.equal(body.holidays.length >= 9, true);
      const first = body.holidays[0];
      assert.match(first.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(first.eveDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof first.names.he, 'string');
      assert.equal(typeof first.names.en, 'string');
      assert.equal(typeof first.names.fr, 'string');

      // Only the menu whose window covers today, with whitelisted fields only.
      assert.equal(body.menus.length, 1);
      const menu = body.menus[0];
      assert.equal(menu.id, 'm-rosh-1');
      assert.equal(menu.holidayKey, 'rosh-hashanah');
      assert.equal(menu.title.fr, 'Menu de Roch Hachana');
      assert.deepEqual(menu.dishes[0], {
        name: 'ראש דג עם סילאן',
        displayName: { en: 'Fish head with silan', fr: 'Tête de poisson au silan' },
        priceUsd: 25,
      });
      assert.equal(menu.orderCutoff, addDays(today, 5));
      assert.equal(Object.hasOwn(menu, 'adminSecret'), false);
    }
  );
});

test('public route is well-formed with no settings and fails closed on repo errors', async () => {
  await withServer(
    (app) => app.use('/api/site/holidays', createPublicHolidaysRouter({ repository: fakeRepository({ orders: [] }), logger: silentLogger })),
    async (base) => {
      const body = await (await fetch(`${base}/api/site/holidays`)).json();
      assert.deepEqual(body.menus, []);
      assert.equal(body.holidays.length >= 9, true);
    }
  );

  const broken = { async loadState() { throw new Error('db down'); } , async saveState() { throw new Error('db down'); } };
  await withServer(
    (app) => app.use('/api/site/holidays', createPublicHolidaysRouter({ repository: broken, logger: silentLogger })),
    async (base) => {
      const response = await fetch(`${base}/api/site/holidays`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  );
});

test('admin GET lists all stored menus (active or not) plus the calendar', async () => {
  const repo = fakeRepository({
    orders: [],
    settings: {
      holidayMenus: [
        menuFixture(),
        menuFixture({ id: 'm-future', publishFrom: addDays(today, 30), publishUntil: addDays(today, 40), orderCutoff: addDays(today, 33) }),
        { junk: true }, // malformed rows are dropped, not fatal
      ],
    },
  });
  await withServer(
    (app) => app.use('/api/holidays', createHolidaysAdminRouter({ repository: repo, logger: silentLogger })),
    async (base) => {
      const response = await fetch(`${base}/api/holidays/menus`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(body.menus.map((menu) => menu.id), ['m-rosh-1', 'm-future']);
      assert.equal(body.holidays.length >= 9, true);
      assert.equal(body.today, today);
    }
  );
});

test('admin PUT replaces the full array through the settings retry path', async () => {
  const repo = fakeRepository(
    { orders: [], settings: { holidayMenus: [menuFixture({ id: 'm-old-list' })], otherSetting: 'kept' } },
    { failSaves: 2 } // two conflicts, then success — the retry loop must absorb them
  );
  await withServer(
    (app) => app.use('/api/holidays', createHolidaysAdminRouter({ repository: repo, logger: silentLogger })),
    async (base) => {
      const menus = [menuFixture(), menuFixture({ id: 'm-pesach-1', holidayKey: 'pesach' })];
      const response = await fetch(`${base}/api/holidays/menus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menus }),
      });
      assert.equal(response.status, 200);
      const stored = repo.data.settings.holidayMenus;
      assert.deepEqual(stored.map((menu) => menu.id), ['m-rosh-1', 'm-pesach-1']);
      assert.equal(repo.data.settings.otherSetting, 'kept'); // other settings untouched
      assert.equal(repo.data.orders.length, 0);
    }
  );
});

test('admin PUT rejects invalid payloads with 400 and writes nothing', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  await withServer(
    (app) => app.use('/api/holidays', createHolidaysAdminRouter({ repository: repo, logger: silentLogger })),
    async (base) => {
      const put = async (menus) =>
        fetch(`${base}/api/holidays/menus`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ menus }),
        });

      // Each of these MUST fail:
      assert.equal((await put('not-an-array')).status, 400);
      assert.equal((await put([menuFixture({ id: '' })])).status, 400);
      assert.equal((await put([menuFixture(), menuFixture()])).status, 400); // duplicate id
      assert.equal((await put([menuFixture({ holidayKey: 'christmas' })])).status, 400);
      assert.equal((await put([menuFixture({ title: { he: '', en: 'x', fr: 'x' } })])).status, 400);
      assert.equal((await put([menuFixture({ publishFrom: '2026-02-30' })])).status, 400); // not a real date
      assert.equal((await put([menuFixture({ publishFrom: 'soon' })])).status, 400);
      assert.equal(
        (await put([menuFixture({ publishFrom: '2026-10-01', publishUntil: '2026-09-01' })])).status,
        400
      ); // window reversed
      assert.equal(
        (await put([menuFixture({ dishes: [{ name: 'דג', displayName: { en: '', fr: '' }, priceUsd: -5 }] })])).status,
        400
      );
      assert.equal(
        (await put([menuFixture({ dishes: [{ name: 'דג', displayName: { en: '', fr: '' }, priceUsd: 100_001 }] })])).status,
        400
      );
      assert.equal(
        (await put([menuFixture({ dishes: [{ name: '', displayName: { en: 'x', fr: 'x' }, priceUsd: 5 }] })])).status,
        400
      );
      assert.equal((await put(Array.from({ length: 21 }, (_, i) => menuFixture({ id: `m-${i}` })))).status, 400);
      assert.equal(
        (await put([
          menuFixture({
            dishes: Array.from({ length: 61 }, (_, i) => ({ name: `מנה ${i}`, displayName: { en: '', fr: '' }, priceUsd: 1 })),
          }),
        ])).status,
        400
      );

      assert.equal(repo.saves.length, 0); // nothing was ever written

      // And the boundary values that MUST succeed:
      const okResponse = await put([
        menuFixture({ dishes: [{ name: 'דג', displayName: { en: '', fr: '' }, priceUsd: 100_000 }] }),
      ]);
      assert.equal(okResponse.status, 200);
      assert.equal(repo.saves.length, 1);
    }
  );
});

test('admin PUT returns 503 when every save attempt conflicts', async () => {
  const repo = fakeRepository({ orders: [], settings: {} }, { failSaves: 99 });
  await withServer(
    (app) => app.use('/api/holidays', createHolidaysAdminRouter({ repository: repo, logger: silentLogger })),
    async (base) => {
      const response = await fetch(`${base}/api/holidays/menus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menus: [menuFixture()] }),
      });
      assert.equal(response.status, 503);
    }
  );
});
