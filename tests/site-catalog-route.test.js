'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createSiteCatalogRouter } = require('../server/site-catalog-route');

function fakeRepository(data) {
  return { async loadState() { return { data, revision: 1, hash: 'h' }; } };
}

async function withServer(repository, run) {
  const app = express();
  app.use('/api/site/catalog', createSiteCatalogRouter({ repository, logger: { error() {} } }));
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

test('catalog projects names, prices, and item photos, never the raw menu object', async () => {
  const repo = fakeRepository({
    orders: [],
    menu: {
      couplePrice: 230,
      challahPrice: 10,
      salads: ['טחינה', 'מטבוחה פיקנטית'],
      mains: ['קציצות בשר'],
      firsts: [],
      sides: [],
      desserts: [],
      itemIds: { salads: { 'טחינה': 'shabbat-salads-08' } },
      itemMeta: {
        'shabbat-salads-08': {
          description: 'טחינה גולמית משובחת',
          imageUrl: 'https://pub.example/menu/tahini.jpg',
        },
      },
      extras: [
        { id: 'x1', name: 'מארז הבדלה', price: 20, description: 'לכבוד מוצ"ש', imageUrl: 'https://pub.example/m.jpg', secretNote: 'admin only' },
        { id: 'x2', name: 'צלחת חריפים', price: 15 },
      ],
      lunch: [
        { key: 'baguette', price: 22 },
        { key: 'schnitzel-plate', variants: [{ k: 'single', price: 35, sidePrice: 15 }, { k: 'family', price: 145, sidePrice: 25 }] },
        { key: 'couscous', price: 35, addon: { price: 20 } },
      ],
      lunchSides: ['אורז לבן', 'פסטה אדומה'],
    },
  });

  await withServer(repo, async (base) => {
    const response = await fetch(`${base}/api/site/catalog`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=60/);

    assert.equal(body.couplePriceUsd, 230);
    assert.equal(body.challahPriceUsd, 10);
    assert.deepEqual(body.categories.salads[0], {
      name: 'טחינה',
      description: 'טחינה גולמית משובחת',
      imageUrl: 'https://pub.example/menu/tahini.jpg',
    });
    assert.deepEqual(body.categories.salads[1], { name: 'מטבוחה פיקנטית', description: '', imageUrl: null });
    assert.deepEqual(body.categories.firsts, []);

    assert.deepEqual(body.extras[0], {
      name: 'מארז הבדלה',
      priceUsd: 20,
      description: 'לכבוד מוצ"ש',
      imageUrl: 'https://pub.example/m.jpg',
    });
    assert.equal(Object.hasOwn(body.extras[0], 'secretNote'), false);
    assert.equal(Object.hasOwn(body.extras[0], 'id'), false);

    const plate = body.lunch.find((item) => item.key === 'schnitzel-plate');
    assert.deepEqual(plate.variants, [
      { key: 'single', priceUsd: 35, sidePriceUsd: 15 },
      { key: 'family', priceUsd: 145, sidePriceUsd: 25 },
    ]);
    const couscous = body.lunch.find((item) => item.key === 'couscous');
    assert.equal(couscous.addonPriceUsd, 20);
    assert.deepEqual(body.lunchSides, ['אורז לבן', 'פסטה אדומה']);

    assert.equal(Object.hasOwn(body, 'itemIds'), false);
    assert.equal(Object.hasOwn(body, 'itemMeta'), false);
  });
});

test('catalog stays well-formed and null-priced on a missing or malformed menu', async () => {
  await withServer(fakeRepository({ orders: [] }), async (base) => {
    const body = await (await fetch(`${base}/api/site/catalog`)).json();
    assert.equal(body.couplePriceUsd, null);
    assert.deepEqual(body.categories.salads, []);
    assert.deepEqual(body.extras, []);
    assert.deepEqual(body.lunch, []);
  });

  const malformed = fakeRepository({
    orders: [],
    menu: {
      couplePrice: 'not-a-number',
      salads: ['', 42, 'אמיתי'],
      extras: [{ name: '', price: 5 }, { name: 'תקין', price: -3 }, 'junk'],
      lunch: [{ key: '' }, 'junk'],
      itemMeta: { x: { imageUrl: 'http://insecure.example/pic.jpg' } },
    },
  });
  await withServer(malformed, async (base) => {
    const body = await (await fetch(`${base}/api/site/catalog`)).json();
    assert.equal(body.couplePriceUsd, null);
    assert.deepEqual(body.categories.salads, [{ name: 'אמיתי', description: '', imageUrl: null }]);
    assert.deepEqual(body.extras, [{ name: 'תקין', priceUsd: null, description: '', imageUrl: null }]);
    assert.deepEqual(body.lunch, []);
  });
});

test('catalog fails closed with 503 when the repository read throws', async () => {
  const broken = { async loadState() { throw new Error('db down'); } };
  await withServer(broken, async (base) => {
    const response = await fetch(`${base}/api/site/catalog`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
