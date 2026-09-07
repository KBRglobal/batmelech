'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { USD_TO_AED, withCurrencyLabels } = require('../server/domain/money-labels');

test('the dirham peg is the fixed central-bank rate', () => {
  assert.equal(USD_TO_AED, 3.6725);
});

test('every minor-units amount gets ready-made USD and AED strings, nested and in arrays', () => {
  const labelled = withCurrencyLabels({
    totalMinorUnits: 14_800,
    orders: [{ money: { collectedMinorUnits: 43_000, outstandingMinorUnits: null } }],
    name: 'טוני',
  });
  assert.equal(labelled.totalUsd, '148.00');
  assert.equal(labelled.totalAed, '543.53');
  assert.equal(labelled.totalMinorUnits, 14_800, 'the raw number stays for anyone who computes');
  assert.equal(labelled.orders[0].money.collectedUsd, '430.00');
  assert.equal(labelled.orders[0].money.collectedAed, '1579.18');
  assert.equal(labelled.name, 'טוני');
});

test('unreadable amounts stay null and get no labels', () => {
  const labelled = withCurrencyLabels({ totalMinorUnits: null, depositMinorUnits: 'junk' });
  assert.equal(labelled.totalMinorUnits, null);
  assert.equal('totalUsd' in labelled, false);
  assert.equal('depositUsd' in labelled, false);
});

test('the input is not mutated', () => {
  const input = { totalMinorUnits: 100, nested: { feeMinorUnits: 50 } };
  withCurrencyLabels(input);
  assert.deepEqual(input, { totalMinorUnits: 100, nested: { feeMinorUnits: 50 } });
});
