'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createSiteOrderRouter } = require('../server/site-order-route');

const HOTEL = Object.freeze({
  hotelName: 'Atlantis The Palm',
  hotelAddress: 'Atlantis The Palm, Crescent Rd, Palm Jumeirah, Dubai, United Arab Emirates',
  hotelLatitude: 25.1304,
  hotelLongitude: 55.1171,
  hotelProviderId: 'W123456789',
});

function fakeRepository() {
  const saved = [];
  return {
    saved,
    async loadState() {
      return { data: { orders: [] }, revision: 1, hash: 'h' };
    },
    async saveState({ localState }) {
      saved.push(localState);
      return { ok: true };
    },
  };
}

// Wednesday, 19 Aug 2026, noon in Dubai — an ordinary working day. Intake now
// refuses orders on Shabbat and yom tov, so every test that expects an order to
// go through has to stand on a fixed weekday rather than on whenever CI runs.
const WEEKDAY = new Date(Date.UTC(2026, 7, 19, 8, 0));

async function withServer(repository, run, clock = () => WEEKDAY) {
  const app = express();
  app.use('/api/site/orders', createSiteOrderRouter({ repository, logger: { error() {} }, clock }));
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

function submission(customer) {
  return {
    customer: {
      name: 'לינה',
      phone: '+971500000000',
      fulfillment: 'delivery',
      date: '2026-08-20',
      time: '18:30',
      ...customer,
    },
    lines: [{ id: 'mtbucha', name: 'מטבוחה', unitPrice: 12, qty: 2 }],
    total: 39,
  };
}

function postOrder(origin, body) {
  return fetch(`${origin}/api/site/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a delivery order carries the picked hotel through to the saved order', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ address: 'חדר 402', ...HOTEL }));
    assert.equal(response.status, 201);

    const [order] = repository.saved.at(-1).orders;
    assert.equal(order.hotelName, 'Atlantis The Palm');
    assert.equal(order.hotelAddress, HOTEL.hotelAddress);
    assert.equal(order.hotelProviderId, 'W123456789');
    assert.equal(order.hotelLatitude, 25.1304);
    assert.equal(order.hotelLongitude, 55.1171);
    assert.equal(order.place, 'Atlantis The Palm');
    assert.equal(
      order.navigationUrl,
      'https://www.google.com/maps/search/?api=1&query=25.1304%2C55.1171',
    );
    // Screens that only read `address` still show where the driver is going.
    assert.equal(order.address, 'Atlantis The Palm — חדר 402');
  });
});

test('a hotel order without room details still names the hotel in the address', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission(HOTEL));
    assert.equal(response.status, 201);

    const [order] = repository.saved.at(-1).orders;
    assert.equal(order.address, 'Atlantis The Palm');
  });
});

test('a free-address delivery order is unchanged and carries no hotel fields', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ address: 'מרינה, בניין 7, דירה 12' }));
    assert.equal(response.status, 201);

    const [order] = repository.saved.at(-1).orders;
    assert.equal(order.address, 'מרינה, בניין 7, דירה 12');
    assert.equal(order.hotelName, undefined);
    assert.equal(order.hotelLatitude, undefined);
    assert.equal(order.hotelProviderId, undefined);
    assert.equal(order.navigationUrl, undefined);
    assert.equal(order.place, undefined);
  });
});

test('a pickup order is unchanged and needs no address', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ fulfillment: 'pickup' }));
    assert.equal(response.status, 201);

    const [order] = repository.saved.at(-1).orders;
    assert.equal(order.address, 'איסוף עצמי');
    assert.equal(order.hotelName, undefined);
  });
});

test('a delivery order with neither an address nor a hotel is rejected', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ address: '' }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid order' });
    assert.equal(repository.saved.length, 0);
  });
});

test('coordinates outside the UAE are rejected, never saved with the hotel stripped', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const north = await postOrder(origin, submission({ ...HOTEL, hotelLatitude: 48.8584 }));
    assert.equal(north.status, 400);

    const west = await postOrder(origin, submission({ ...HOTEL, hotelLongitude: 2.2945 }));
    assert.equal(west.status, 400);

    const infinite = await postOrder(origin, submission({ ...HOTEL, hotelLatitude: 'x' }));
    assert.equal(infinite.status, 400);

    assert.equal(repository.saved.length, 0);
  });
});

test('a malformed provider ID is rejected', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ ...HOTEL, hotelProviderId: 'X99' }));
    assert.equal(response.status, 400);
    assert.equal(repository.saved.length, 0);
  });
});

test('a half-filled hotel selection is rejected rather than saved without coordinates', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const nameOnly = await postOrder(origin, submission({ hotelName: 'Atlantis The Palm' }));
    assert.equal(nameOnly.status, 400);

    const { hotelProviderId: _dropped, ...withoutProviderId } = HOTEL;
    const noProviderId = await postOrder(origin, submission(withoutProviderId));
    assert.equal(noProviderId.status, 400);

    assert.equal(repository.saved.length, 0);
  });
});

test('a hotel cannot be attached to a pickup order', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (origin) => {
    const response = await postOrder(origin, submission({ fulfillment: 'pickup', ...HOTEL }));
    assert.equal(response.status, 400);
    assert.equal(repository.saved.length, 0);
  });
});

// A page opened before candle lighting can still POST after it, so the server
// is the gate that actually holds — not the closure screen.
test('intake refuses an order posted during Shabbat', async () => {
  const repository = fakeRepository();
  const fridayNight = () => new Date(Date.UTC(2026, 7, 14, 15, 30)); // Fri 14 Aug 2026, 19:30 Dubai
  await withServer(
    repository,
    async (origin) => {
      const response = await postOrder(origin, submission({ address: 'מרינה, בניין 7' }));
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.reason, 'shabbat');
      assert.match(body.error, /שבת שלום/u);
      assert.match(body.error, /במוצאי שבת/u);
      assert.equal(repository.saved.length, 0);
    },
    fridayNight,
  );
});

test('intake refuses an order posted on a chag, and says which one', async () => {
  const repository = fakeRepository();
  const pesach = () => new Date(Date.UTC(2027, 3, 22, 8, 0)); // Thu 22 Apr 2027, noon Dubai
  await withServer(
    repository,
    async (origin) => {
      const response = await postOrder(origin, submission({ address: 'מרינה, בניין 7' }));
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.reason, 'shabbat');
      assert.match(body.error, /חג שמח — פסח/u);
      assert.match(body.error, /בצאת החג/u);
      assert.equal(repository.saved.length, 0);
    },
    pesach,
  );
});

test('intake accepts the same order once Shabbat is out', async () => {
  const repository = fakeRepository();
  const saturdayNight = () => new Date(Date.UTC(2026, 7, 15, 17, 0)); // Sat 15 Aug 2026, 21:00 Dubai
  await withServer(
    repository,
    async (origin) => {
      const response = await postOrder(origin, submission({ address: 'מרינה, בניין 7' }));
      assert.equal(response.status, 201);
      assert.equal(repository.saved.length, 1);
    },
    saturdayNight,
  );
});

// Chanukah and chol hamoed are working days; only yom tov closes the kitchen.
test('intake accepts orders on Chanukah and on chol hamoed Sukkot', async () => {
  for (const [name, at] of [
    ['Chanukah', Date.UTC(2026, 11, 7, 8, 0)],
    ['chol hamoed Sukkot', Date.UTC(2026, 8, 28, 8, 0)],
  ]) {
    const repository = fakeRepository();
    await withServer(
      repository,
      async (origin) => {
        const response = await postOrder(origin, submission({ address: 'מרינה, בניין 7' }));
        assert.equal(response.status, 201, `${name} should be a working day`);
      },
      () => new Date(at),
    );
  }
});
