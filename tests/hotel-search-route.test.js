'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const {
  MAX_CACHE_ENTRIES,
  PROVIDER_INTERVAL_MS,
  PROVIDER_MAX_RESPONSE_BYTES,
  createHotelSearcher,
  createHotelSearchRouter,
  normalizeProviderResult,
} = require('../server/hotels/hotel-search-route');

function providerRow(overrides = {}) {
  return {
    osm_type: 'node',
    osm_id: 123,
    name: 'Rosewood Abu Dhabi',
    display_name: 'Rosewood Abu Dhabi, Al Maryah Island, Abu Dhabi, United Arab Emirates',
    lat: '24.5012',
    lon: '54.3875',
    category: 'tourism',
    type: 'hotel',
    address: { city: 'Abu Dhabi', state: 'Abu Dhabi', country_code: 'ae' },
    ...overrides,
  };
}

test('normalizes only real Dubai or Abu Dhabi hotel results', () => {
  assert.deepEqual(normalizeProviderResult(providerRow()), {
    id: 'N123',
    name: 'Rosewood Abu Dhabi',
    fullAddress: 'Rosewood Abu Dhabi, Al Maryah Island, Abu Dhabi, United Arab Emirates',
    latitude: 24.5012,
    longitude: 54.3875,
    navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.5012%2C54.3875',
  });
  assert.equal(normalizeProviderResult(providerRow({ category: 'amenity' })), null);
  assert.equal(normalizeProviderResult(providerRow({
    name: 'Dubai Dream Hotel',
    address: { city: 'Sharjah', state: 'Sharjah', country_code: 'ae' },
    display_name: 'Dubai Dream Hotel, Sharjah, United Arab Emirates',
  })), null);
  assert.equal(normalizeProviderResult(providerRow({ address: { city: 'Abu Dhabi' } })), null);
  assert.equal(normalizeProviderResult(providerRow({ address: { city: 'Abu Dhabi', country_code: 'us' } })), null);
  assert.equal(normalizeProviderResult(providerRow({ lat: 'not-a-number' })), null);
  assert.equal(normalizeProviderResult(providerRow({ lat: '27.1' })), null);
  assert.equal(normalizeProviderResult(providerRow({ name: 'Unsafe\u0000Hotel' })), null);
});

test('searcher restricts UAE POIs, serializes provider calls, caches exact queries, and sanitizes rows', async () => {
  let clock = 10_000;
  const waits = [];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify([
      providerRow(),
      providerRow(),
      providerRow({ osm_id: 456, name: 'Dubai Hotel', display_name: 'Dubai Hotel, Dubai, UAE', lat: '25.2', lon: '55.3', address: { city: 'Dubai', state: 'Dubai', country_code: 'ae' } }),
      providerRow({ osm_id: 789, category: 'shop' }),
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const search = createHotelSearcher({
    fetchImpl,
    providerUrl: 'https://provider.example/search?api_key=server-only',
    now: () => clock,
    sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
  });

  const [first, coalesced] = await Promise.all([search('Rosewood'), search('  rosewood  ')]);
  first[0].name = 'mutated caller copy';
  const cached = await search('rosewood');
  const second = await search('Atlantis');
  assert.equal(first.length, 2);
  assert.equal(coalesced[0].name, 'Rosewood Abu Dhabi');
  assert.equal(cached[0].name, 'Rosewood Abu Dhabi');
  assert.equal(requests.length, 2);
  assert.deepEqual(waits, [PROVIDER_INTERVAL_MS]);
  assert.equal(second.length, 2);
  const providerUrl = new URL(requests[0].url);
  assert.equal(providerUrl.searchParams.get('api_key'), 'server-only');
  assert.equal(providerUrl.searchParams.get('countrycodes'), 'ae');
  assert.equal(providerUrl.searchParams.get('layer'), 'poi');
  assert.equal(providerUrl.searchParams.get('format'), 'jsonv2');
  assert.equal(providerUrl.searchParams.get('addressdetails'), '1');
  assert.equal(providerUrl.searchParams.get('namedetails'), '1');
  assert.equal(providerUrl.searchParams.get('dedupe'), '1');
  assert.equal(providerUrl.searchParams.get('limit'), '10');
  assert.equal(providerUrl.searchParams.get('q'), 'Rosewood, United Arab Emirates');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.match(requests[0].init.headers['User-Agent'], /BatMelechOrders/)
});

test('searcher fails closed on invalid queries and malformed provider responses', async () => {
  const malformed = createHotelSearcher({ fetchImpl: async () => new Response('{}') });
  await assert.rejects(() => malformed('x'));
  await assert.rejects(() => malformed('bad\u0000query'));
  await assert.rejects(() => malformed('valid query'), /malformed/);

  const invalidJson = createHotelSearcher({
    fetchImpl: async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(() => invalidJson('valid query'), /malformed/);

  const oversized = createHotelSearcher({
    fetchImpl: async () => new Response('[]', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(PROVIDER_MAX_RESPONSE_BYTES + 1),
      },
    }),
  });
  await assert.rejects(() => oversized('valid query'), /too large/);

  assert.throws(() => createHotelSearcher({ providerUrl: 'file:///tmp/provider' }), /HTTPS/);
  assert.throws(() => createHotelSearcher({ providerUrl: 'http://provider.example/search' }), /HTTPS/);
  assert.throws(() => createHotelSearcher({ providerUrl: 'https://secret@provider.example/search' }), /credentials/);
  assert.throws(() => createHotelSearcher({ timeoutMs: 0 }), /timeoutMs/);
});

test('searcher enforces the configured provider timeout', async () => {
  const keepAlive = setTimeout(() => {}, 100);
  const search = createHotelSearcher({
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }),
  });

  try {
    await assert.rejects(() => search('Rosewood'));
  } finally {
    clearTimeout(keepAlive);
  }
});

test('cache stays bounded and evicts the oldest completed query', async () => {
  let clock = 1_000;
  let calls = 0;
  const search = createHotelSearcher({
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    fetchImpl: async () => {
      calls += 1;
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    },
  });

  for (let index = 0; index <= MAX_CACHE_ENTRIES; index += 1) {
    await search(`hotel ${index}`);
  }
  assert.equal(calls, MAX_CACHE_ENTRIES + 1);
  await search('hotel 0');
  assert.equal(calls, MAX_CACHE_ENTRIES + 2);
});

async function withServer(searchHotels, run) {
  const app = express();
  app.use('/api/hotels/search', createHotelSearchRouter({ searchHotels }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('authenticated route shape returns attribution and never leaks a failed query', async () => {
  await withServer(async (query) => query === 'fail' ? Promise.reject(new Error(`private ${query}`)) : [normalizeProviderResult(providerRow())], async (origin) => {
    const success = await fetch(`${origin}/api/hotels/search?q=Rosewood`);
    assert.equal(success.status, 200);
    assert.match(success.headers.get('cache-control') || '', /no-store/);
    const body = await success.json();
    assert.equal(body.results[0].id, 'N123');
    assert.equal(body.attribution.label, 'OpenStreetMap contributors');
    assert.equal(body.attribution.url, 'https://www.openstreetmap.org/copyright');
    assert.match(success.headers.get('pragma') || '', /no-cache/);

    const invalid = await fetch(`${origin}/api/hotels/search?q=x`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'invalid hotel search' });

    const failed = await fetch(`${origin}/api/hotels/search?q=fail`);
    assert.equal(failed.status, 502);
    const failedText = await failed.text();
    assert.equal(failedText.includes('fail'), false);
    assert.equal(failedText.includes('private'), false);
  });
});

test('route rejects a malformed injected result without reflecting its contents', async () => {
  await withServer(async () => [{
    id: 'N123',
    name: 'Unsafe\u0000Hotel',
    fullAddress: 'Private address',
    latitude: 24.5,
    longitude: 54.3,
    navigationUrl: 'javascript:alert(1)',
  }], async (origin) => {
    const response = await fetch(`${origin}/api/hotels/search?q=private-query`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'hotel search unavailable' });
  });
});
