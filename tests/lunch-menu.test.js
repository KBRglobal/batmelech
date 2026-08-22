'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { LUNCH_MENU } = require('../server/domain/lunch-menu');

test('the weekday lunch menu matches the prices Moshe dictated', () => {
  const priceOf = (key, variantKey) => {
    const item = LUNCH_MENU.find((candidate) => candidate.key === key);
    if (variantKey === undefined) return item.priceUsd;
    return item.variants.find((candidate) => candidate.key === variantKey).priceUsd;
  };
  assert.equal(priceOf('baguette'), 22);
  assert.equal(priceOf('schnitzel-roll', 'baguette'), 25);
  assert.equal(priceOf('schnitzel-roll', 'challah'), 28);
  assert.equal(priceOf('kubeh'), 35);
  assert.equal(priceOf('schnitzel-plate', 'single'), 35);
  assert.equal(priceOf('schnitzel-plate', 'couple'), 60);
  assert.equal(priceOf('schnitzel-plate', 'family'), 145);
  assert.equal(priceOf('couscous'), 35);
  assert.equal(LUNCH_MENU.find((item) => item.key === 'couscous').addon.priceUsd, 20);
});

// server/domain/lunch-menu.js and DEFAULT_LUNCH in
// web/src/domain/settings-catalog.ts are two physical files that must agree
// — the panel and מיי both turn an item's INDEX into the catalog id a review
// refers to, so a reordered or renamed item would silently point one of
// them at the wrong dish. Parsing the web file as text is the same tripwire
// tests/package-rules.test.js uses, and needs no TS toolchain here.
test('the server lunch menu stays in lockstep with the web catalog defaults', () => {
  const webSource = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'domain', 'settings-catalog.ts'),
    'utf8',
  );
  const block = webSource.slice(
    webSource.indexOf('const DEFAULT_LUNCH'),
    webSource.indexOf('const DEFAULT_LUNCH_SIDES'),
  );
  assert.ok(block.length > 0, 'expected to find DEFAULT_LUNCH in the web catalog');

  const webKeys = [...block.matchAll(/^ {2}\{\n {4}key: '([^']+)'/gmu)].map((match) => match[1]);
  assert.deepEqual(webKeys, LUNCH_MENU.map((item) => item.key));

  const webVariantKeys = [...block.matchAll(/^ {8}key: '([^']+)'/gmu)].map((match) => match[1]);
  assert.deepEqual(
    webVariantKeys,
    LUNCH_MENU.flatMap((item) => item.variants.map((variant) => variant.key)),
  );

  const webPrices = [...block.matchAll(/priceMinorUnits: ([\d_]+|null)/gu)]
    .map((match) => (match[1] === 'null' ? null : Number(match[1].replaceAll('_', '')) / 100));
  const serverPrices = LUNCH_MENU.flatMap((item) => [
    item.priceUsd,
    ...item.variants.map((variant) => variant.priceUsd),
    ...(item.addon ? [item.addon.priceUsd] : []),
  ]);
  assert.deepEqual(webPrices, serverPrices, 'lunch prices drifted between the server and the panel');
});
