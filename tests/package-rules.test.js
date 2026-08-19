'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverRules = require('../server/domain/package-rules');

test('server package-rules matches the numbers Lin confirmed', () => {
  assert.equal(serverRules.FISH_UNITS_INCLUDED_PER_MEAL, 2);
  assert.equal(serverRules.SALADS_INCLUDED_PER_MEAL, 4);
  assert.equal(serverRules.MAINS_INCLUDED_PER_MEAL, 1);
  assert.equal(serverRules.SIDES_INCLUDED_PER_MEAL, 1);
  assert.equal(serverRules.DESSERT_HALF_UNITS_INCLUDED_PER_MEAL, 2);
  assert.equal(serverRules.BAKLAVA_HALF_UNITS_PER_PORTION, serverRules.SOUFFLE_HALF_UNITS_PER_PORTION * 2);
});

test('classifyDessertKind and defaultDessertPortionsForMeals match the panel behavior', () => {
  assert.equal(serverRules.classifyDessertKind('סופלה שוקולד'), 'souffle');
  assert.equal(serverRules.classifyDessertKind('סוכריות בקלוואה'), 'baklava');
  assert.equal(serverRules.classifyDessertKind('עוגת שוקולד'), 'unclassified');
  assert.equal(serverRules.defaultDessertPortionsForMeals('souffle', 1), 2);
  assert.equal(serverRules.defaultDessertPortionsForMeals('baklava', 1), 1);
  assert.equal(serverRules.defaultDessertPortionsForMeals('souffle', 2), 4);
  assert.equal(serverRules.defaultDessertPortionsForMeals('unclassified', 2), 0);
});

// This server-side module (no build step, plain Node) and
// web/src/domain/package-rules.ts (browser bundle, TypeScript) are two
// physical files that must stay numerically identical — see the comment in
// server/domain/package-rules.js. Parsing the web file's `export const`
// lines as text is a pragmatic tripwire: it fails loudly the moment the
// two drift, without needing a TS toolchain in the server test run.
test('server package-rules constants stay in lockstep with the web twin', () => {
  const webSource = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'domain', 'package-rules.ts'),
    'utf8',
  );
  const webConstants = {};
  for (const match of webSource.matchAll(/export const ([A-Z_]+) = (\d+)/gu)) {
    webConstants[match[1]] = Number(match[2]);
  }
  assert.ok(Object.keys(webConstants).length >= 7, 'expected to find the numeric constants in the web file');
  for (const [name, value] of Object.entries(webConstants)) {
    assert.equal(serverRules[name], value, `${name} drifted between server and web package-rules`);
  }
});
