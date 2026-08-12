'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const DEFAULT_PROVIDER_URL = 'https://nominatim.openstreetmap.org/search';
const PROVIDER_INTERVAL_MS = 1_100;
const PROVIDER_TIMEOUT_MS = 8_000;
const PROVIDER_MAX_RESPONSE_BYTES = 256 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 250;
const MAX_RESULTS = 10;
const MAX_PROVIDER_ROWS = 100;
const HOTEL_TYPES = new Set(['hotel', 'resort', 'guest_house', 'hostel', 'motel', 'apartment']);
const PROVIDER_ID_PATTERN = /^[NWR][1-9]\d{0,18}$/u;
const UAE_BOUNDS = Object.freeze({
  minimumLatitude: 22.5,
  maximumLatitude: 26.5,
  minimumLongitude: 51,
  maximumLongitude: 56.6,
});

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalQuery(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length < 2 || normalized.length > 100) return null;
  return /[\p{Cc}\p{Cf}]/u.test(normalized) ? null : normalized;
}

function boundedString(value, maximum) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0 || normalized.length > maximum) return null;
  return /[\p{Cc}\p{Cf}]/u.test(normalized) ? null : normalized;
}

function providerId(row) {
  const osmType = boundedString(row.osm_type, 16);
  const osmId = typeof row.osm_id === 'number' && Number.isSafeInteger(row.osm_id) && row.osm_id > 0
    ? row.osm_id
    : null;
  const prefix = osmType === 'node' ? 'N' : osmType === 'way' ? 'W' : osmType === 'relation' ? 'R' : null;
  return prefix && osmId ? `${prefix}${osmId}` : null;
}

function hotelRegion(row) {
  const address = isPlainRecord(row.address) ? row.address : null;
  if (!address) return null;
  const countryCode = boundedString(address.country_code, 8);
  if (!countryCode || countryCode.toLocaleLowerCase('en-US') !== 'ae') return null;
  const regionNames = [
    address.city,
    address.town,
    address.village,
    address.state,
    address.state_district,
    address.county,
    address.municipality,
    address.region,
  ].flatMap((value) => {
    const text = boundedString(value, 200);
    return text ? [text.toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim()] : [];
  });
  if (regionNames.some((name) => /^(?:(?:emirate|municipality) of )?dubai(?: emirate| municipality)?$/u.test(name) || name === 'دبي' || name === 'إمارة دبي')) {
    return 'dubai';
  }
  if (regionNames.some((name) => /^(?:(?:emirate|municipality) of )?abu (?:dhabi|zaby)(?: emirate| municipality)?$/u.test(name) || ['أبو ظبي', 'ابو ظبي', 'إمارة أبو ظبي'].includes(name))) {
    return 'abu-dhabi';
  }
  return null;
}

function providerCoordinate(value, minimum, maximum) {
  const text = boundedString(value, 32);
  if (!text || !/^-?\d{1,3}(?:\.\d{1,15})?$/u.test(text)) return null;
  const coordinate = Number(text);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

function navigationUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function normalizeProviderResult(value) {
  if (!isPlainRecord(value)) return null;
  const row = value;
  const id = providerId(row);
  const fullAddress = boundedString(row.display_name, 500);
  const latitude = providerCoordinate(
    row.lat,
    UAE_BOUNDS.minimumLatitude,
    UAE_BOUNDS.maximumLatitude,
  );
  const longitude = providerCoordinate(
    row.lon,
    UAE_BOUNDS.minimumLongitude,
    UAE_BOUNDS.maximumLongitude,
  );
  const category = boundedString(row.category ?? row.class, 100);
  const type = boundedString(row.type ?? row.addresstype, 100);
  const region = hotelRegion(row);
  const isHotel = category?.toLocaleLowerCase('en-US') === 'tourism' &&
    type !== null && HOTEL_TYPES.has(type.toLocaleLowerCase('en-US'));
  if (!id || !fullAddress || latitude === null || longitude === null) return null;
  if (!region || !isHotel) return null;
  const explicitName = boundedString(row.name, 200);
  if (row.name !== undefined && explicitName === null) return null;
  const name = explicitName ?? boundedString(fullAddress.split(',')[0], 200);
  if (!name) return null;
  return {
    id,
    name,
    fullAddress,
    latitude,
    longitude,
    navigationUrl: navigationUrl(latitude, longitude),
  };
}

function providerEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('providerUrl must be a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new TypeError('providerUrl must use HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('providerUrl must not contain URL credentials');
  }
  url.hash = '';
  return url;
}

async function boundedResponseText(response, maximumBytes) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maximumBytes) {
    throw new Error('provider response too large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw new Error('provider response too large');
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('provider response malformed');
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new Error('provider response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function providerRows(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/iu.test(contentType)) {
    throw new Error('provider response malformed');
  }
  const text = await boundedResponseText(response, PROVIDER_MAX_RESPONSE_BYTES);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('provider response malformed');
  }
  if (!Array.isArray(payload) || payload.length > MAX_PROVIDER_ROWS) {
    throw new Error('provider response malformed');
  }
  return payload;
}

function normalizeSearchResults(value) {
  if (!Array.isArray(value) || value.length > MAX_RESULTS) throw new Error('search results malformed');
  const unique = new Map();
  for (const result of value) {
    if (!isPlainRecord(result)) throw new Error('search results malformed');
    const id = boundedString(result.id, 32);
    const name = boundedString(result.name, 200);
    const fullAddress = boundedString(result.fullAddress, 500);
    const latitude = result.latitude;
    const longitude = result.longitude;
    if (!id || !PROVIDER_ID_PATTERN.test(id) || !name || !fullAddress) {
      throw new Error('search results malformed');
    }
    if (
      typeof latitude !== 'number' || !Number.isFinite(latitude) ||
      latitude < UAE_BOUNDS.minimumLatitude || latitude > UAE_BOUNDS.maximumLatitude ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) ||
      longitude < UAE_BOUNDS.minimumLongitude || longitude > UAE_BOUNDS.maximumLongitude ||
      result.navigationUrl !== navigationUrl(latitude, longitude)
    ) throw new Error('search results malformed');
    if (!unique.has(id)) {
      unique.set(id, { id, name, fullAddress, latitude, longitude, navigationUrl: result.navigationUrl });
    }
  }
  return [...unique.values()];
}

function createHotelSearcher({
  fetchImpl = globalThis.fetch,
  providerUrl = process.env.BM_HOTEL_SEARCH_PROVIDER_URL || process.env.BM_GEOCODER_URL || DEFAULT_PROVIDER_URL,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = PROVIDER_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError('timeoutMs must be between 1 and 60000 milliseconds');
  }
  const endpoint = providerEndpoint(providerUrl);
  let nextProviderAt = 0;
  let providerQueue = Promise.resolve();
  const cache = new Map();
  const inFlight = new Map();

  return async function searchHotels(rawQuery) {
    const query = canonicalQuery(rawQuery);
    if (!query) throw Object.assign(new Error('invalid query'), { code: 'INVALID_QUERY' });
    const cacheKey = query.toLocaleLowerCase('en-US');
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return structuredClone(cached.results);
    const pending = inFlight.get(cacheKey);
    if (pending) return structuredClone(await pending);

    const task = providerQueue.then(async () => {
      const waitMs = Math.max(0, nextProviderAt - now());
      if (waitMs > 0) await sleep(waitMs);
      nextProviderAt = now() + PROVIDER_INTERVAL_MS;
      const url = new URL(endpoint);
      url.searchParams.set('q', `${query}, United Arab Emirates`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('namedetails', '1');
      url.searchParams.set('countrycodes', 'ae');
      url.searchParams.set('layer', 'poi');
      url.searchParams.set('dedupe', '1');
      url.searchParams.set('limit', String(MAX_RESULTS));
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'User-Agent': 'BatMelechOrders/1.0 (+https://app-production-e89e.up.railway.app)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('provider unavailable');
      const payload = await providerRows(response);
      const unique = new Map();
      for (const row of payload) {
        const result = normalizeProviderResult(row);
        if (result && !unique.has(result.id)) unique.set(result.id, result);
      }
      const results = [...unique.values()].slice(0, MAX_RESULTS);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { expiresAt: now() + CACHE_TTL_MS, results });
      return results;
    });
    inFlight.set(cacheKey, task);
    providerQueue = task.catch(() => undefined);
    try {
      return structuredClone(await task);
    } finally {
      if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey);
    }
  };
}

function createHotelSearchRouter(options = {}) {
  const router = express.Router();
  const searchHotels = options.searchHotels || createHotelSearcher(options);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('Pragma', 'no-cache');
    next();
  });
  router.use(rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 20,
    keyGenerator: () => 'authenticated-batmelech-staff',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }));
  router.get('/', async (request, response) => {
    const query = canonicalQuery(request.query.q);
    if (!query) return response.status(400).json({ error: 'invalid hotel search' });
    try {
      const results = normalizeSearchResults(await searchHotels(query));
      return response.json({
        results,
        attribution: {
          label: 'OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
        },
      });
    } catch {
      return response.status(502).json({ error: 'hotel search unavailable' });
    }
  });
  return router;
}

module.exports = {
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  PROVIDER_INTERVAL_MS,
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_TIMEOUT_MS,
  canonicalQuery,
  createHotelSearcher,
  createHotelSearchRouter,
  normalizeProviderResult,
};
