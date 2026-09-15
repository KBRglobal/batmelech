'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ADDON_DINER_LINE_NAME,
  SOLO_DINER_LINE_NAME,
  deliveryFeeMinorUnits,
  menuPrices,
  orderPriceBreakdown,
} = require('../server/domain/order-pricing');

const MENU = {
  couplePrice: 230,
  challahPrice: 10,
  includedChallot: 2,
  saladUnitPrice: 7,
  saladBlockPrice: 25,
  fishExtraPrice: 30,
  extras: [
    { name: 'קוסקוס', price: 25 },
    { name: 'תוספת יין', price: 5 },
    { name: 'מנת מפרום ביתי (תוספת)', price: 20 },
    { name: 'מגש שניצלים (זוגי, כ־13–15 יח\')', price: 100 },
  ],
};

function amounts(breakdown) {
  return Object.fromEntries(breakdown.lines.map((row) => [row.name, row.amountMinorUnits]));
}

test("Toni's real order: two schnitzel challot, extras, a salad (free since the box), Dubai delivery = 141$", () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '141.00',
      meals: 0,
      challot: 0,
      lunch: { 'schnitzel-roll': { q: 2, v: 'challah', sides: {}, addon: 0, plates: [{ sides: {}, variantKey: 'challah' }, { sides: {}, variantKey: 'challah' }] } },
      extras: { 'קוסקוס': { q: 1 }, 'תוספת יין': { q: 1 }, 'מנת מפרום ביתי (תוספת)': { q: 2 } },
      salads: { 'כרוב לבן קלאסי': { o: 1, p: 0 } },
      pickup: false,
      deliveryZone: 'dubai',
      freeDelivery: false,
    },
    MENU,
  );
  const byName = amounts(breakdown);
  assert.equal(byName['בגט/חלת שניצל ישראלי (בחלה — סופ"ש בלבד)'], 5_600);
  assert.equal(byName['קוסקוס'], 2_500);
  assert.equal(byName['מנת מפרום ביתי (תוספת)'], 4_000);
  assert.equal(byName['סלט אקסטרה בודד'], undefined, 'salads are never priced since the fixed box');
  assert.equal(byName['משלוח בדובאי'], 1_500);
  assert.equal(breakdown.computedTotalMinorUnits, 14_100);
  assert.equal(breakdown.matchesStoredTotal, true);
  assert.deepEqual(breakdown.warnings, []);
});

test('a couple meal with its included fish, salads and challot costs the couple price; Dubai delivery is included', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '230',
      meals: 1,
      challot: 2,
      firsts: { 'פילה דג ברוטב חריימה': 2 },
      salads: { 'טחינה': { o: 2 }, 'מטבוחה פיקנטית': { o: 2 } },
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
      sides: { 'אורז לבן': 1 },
      pickup: false,
      deliveryZone: 'dubai',
    },
    MENU,
  );
  assert.equal(amounts(breakdown)['משלוח בדובאי'], 0, 'Dubai delivery is part of the package price');
  assert.equal(breakdown.computedTotalMinorUnits, 23_000);
  assert.equal(breakdown.matchesStoredTotal, true);
});

// --- the diner model (Lin, 2026-09-15): couple + add-on diner + solo diner ---

test('an add-on diner is its own line at the menu price and widens every allowance by half', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '389',
      meals: 1,
      addons: 1,
      challot: 3,
      firsts: { 'פילה דג ברוטב חריימה': 3 },
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1, 'תבשיל עוף מרוקאי עם חומוסים': 1 },
      sides: { 'אורז לבן': 2 },
      desserts: { 'סופלה שוקולד': 3 },
      pickup: false,
      deliveryZone: 'dubai',
    },
    { ...MENU, addonDinerPrice: 149 },
  );
  const byName = amounts(breakdown);
  assert.equal(byName['ארוחה זוגית'], 23_000);
  assert.equal(byName['סועד נוסף'], 14_900);
  assert.equal(breakdown.lines.find((row) => row.name === 'סועד נוסף').kind, 'addon-diner');
  assert.equal(byName['פילה דג אקסטרה'], undefined, '3 fillets = 2 for the couple + 1 for the add-on diner');
  assert.equal(byName['חלות נוספות'], undefined, '3 challot = 2 + 1');
  assert.equal(byName['עיקרית נוספת'], undefined, '2 mains = 4 half-units; 3 are included');
  assert.equal(byName['חצי עיקרית נוספת'], 5_000, 'the fourth half-unit costs half the extra-main price');
  assert.equal(byName['משלוח בדובאי'], 0);
  assert.equal(breakdown.computedTotalMinorUnits, 23_000 + 14_900 + 5_000);
  assert.equal(breakdown.matchesStoredTotal, false);
});

test('a solo diner alone pays the solo price with Dubai delivery included and one fish fillet', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '169',
      solos: 1,
      challot: 2,
      firsts: { 'פילה דג ברוטב מרוקאי': 1 },
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
      desserts: { 'סופלה שוקולד': 1 },
      pickup: false,
      deliveryZone: 'dubai',
    },
    { ...MENU, soloDinerPrice: 169, mainExtraPrice: 100 },
  );
  const byName = amounts(breakdown);
  assert.equal(byName['ארוחה זוגית'], undefined);
  assert.equal(byName['סועד בודד'], 16_900);
  assert.equal(breakdown.lines.find((row) => row.name === 'סועד בודד').kind, 'solo-diner');
  assert.equal(byName['פילה דג אקסטרה'], undefined);
  assert.equal(byName['חלות נוספות'], undefined, 'a solo diner gets 2 challot');
  assert.equal(byName['חצי עיקרית נוספת'], 5_000, 'a whole main for a solo diner is half a main beyond the allowance');
  assert.equal(byName['משלוח בדובאי'], 0);
  assert.equal(breakdown.computedTotalMinorUnits, 16_900 + 5_000);
});

test('the diner prices fall back to the contract defaults when the menu carries none', () => {
  const breakdown = orderPriceBreakdown({ total: '0', meals: 1, addons: 2, solos: 1, pickup: true }, MENU);
  const byName = amounts(breakdown);
  assert.equal(byName['סועד נוסף'], 2 * 14_900);
  assert.equal(byName['סועד בודד'], 16_900);
});

test('main overage is priced in half-units: a whole extra main, then half of it', () => {
  const twoExtraHalves = orderPriceBreakdown(
    { total: '0', meals: 1, mains: { 'א': 2 }, pickup: true },
    { ...MENU, mainExtraPrice: 100 },
  );
  assert.equal(amounts(twoExtraHalves)['עיקרית נוספת'], 10_000);
  assert.equal(amounts(twoExtraHalves)['חצי עיקרית נוספת'], undefined);

  const threeExtraHalves = orderPriceBreakdown(
    { total: '0', meals: 1, addons: 1, mains: { 'א': 3 }, pickup: true },
    { ...MENU, mainExtraPrice: 100 },
  );
  assert.equal(amounts(threeExtraHalves)['עיקרית נוספת'], 10_000, '6 half-units - 3 included = 3: one whole main...');
  assert.equal(amounts(threeExtraHalves)['חצי עיקרית נוספת'], 5_000, '...and one half');
});

test('Dubai delivery is included with any package but charged without; Abu Dhabi is always charged', () => {
  const noPackage = orderPriceBreakdown({ total: '0', extras: { 'קוסקוס': { q: 1 } }, deliveryZone: 'dubai' }, MENU);
  assert.equal(amounts(noPackage)['משלוח בדובאי'], 1_500);
  for (const order of [{ meals: 1 }, { addons: 1 }, { solos: 1 }]) {
    const withPackage = orderPriceBreakdown({ total: '0', ...order, deliveryZone: 'dubai' }, MENU);
    assert.equal(amounts(withPackage)['משלוח בדובאי'], 0, `${JSON.stringify(order)} includes Dubai delivery`);
    const abuDhabi = orderPriceBreakdown({ total: '0', ...order, deliveryZone: 'abu-dhabi' }, MENU);
    assert.equal(amounts(abuDhabi)['משלוח לאבו דאבי'], 5_500, `${JSON.stringify(order)} still pays Abu Dhabi`);
  }
});

test('deliveryFeeMinorUnits and menuPrices are exposed for the site intake', () => {
  assert.equal(deliveryFeeMinorUnits({ zone: 'dubai', hasPackage: false }), 1_500);
  assert.equal(deliveryFeeMinorUnits({ zone: 'dubai', hasPackage: true }), 0);
  assert.equal(deliveryFeeMinorUnits({ zone: 'abu-dhabi', hasPackage: true }), 5_500);
  assert.equal(deliveryFeeMinorUnits({ zone: 'abu-dhabi', hasPackage: false, pickup: true }), 0);
  assert.equal(deliveryFeeMinorUnits({ zone: 'abu-dhabi', hasPackage: false, freeDelivery: true }), 0);
  const prices = menuPrices({ couplePrice: 299, addonDinerPrice: 150, soloDinerPrice: '170' });
  assert.equal(prices.couplePriceMinorUnits, 29_900);
  assert.equal(prices.addonDinerPriceMinorUnits, 15_000);
  assert.equal(prices.soloDinerPriceMinorUnits, 17_000);
  assert.equal(menuPrices({}).addonDinerPriceMinorUnits, 14_900);
  assert.equal(menuPrices(null).soloDinerPriceMinorUnits, 16_900);
  assert.equal(ADDON_DINER_LINE_NAME, 'סועד נוסף');
  assert.equal(SOLO_DINER_LINE_NAME, 'סועד בודד');
});

test('fish cakes count as two fillets, extra salads cost nothing, Abu Dhabi costs 55$', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '400',
      meals: 1,
      challot: 4,
      firsts: { 'קציצות דגים ברוטב מרוקאי': 1, 'פילה דג ברוטב מרוקאי': 1 },
      salads: { 'טחינה': { o: 5 }, 'קולסלאו': { o: 4 } }, // 9 salads: no surcharge, the box is included
      pickup: false,
      deliveryZone: 'abu-dhabi',
    },
    MENU,
  );
  const byName = amounts(breakdown);
  assert.equal(byName['פילה דג אקסטרה'], 3_000);
  assert.equal(byName['סלטים אקסטרה (רביעייה)'], undefined);
  assert.equal(byName['סלט אקסטרה בודד'], undefined);
  assert.equal(byName['חלות נוספות'], 2_000);
  assert.equal(byName['משלוח לאבו דאבי'], 5_500);
  assert.equal(breakdown.computedTotalMinorUnits, 23_000 + 3_000 + 2_000 + 5_500);
  assert.equal(breakdown.differenceMinorUnits, 40_000 - breakdown.computedTotalMinorUnits);
  assert.equal(breakdown.lines.at(-1).kind, 'manual', 'the gap to the stored total is shown, never hidden');
});

test('an extra with no menu price becomes a warning, not a silent zero', () => {
  const breakdown = orderPriceBreakdown({ total: '50', extras: { 'מנה מסתורית': { q: 1 } }, pickup: true }, MENU);
  assert.equal(breakdown.lines.some((row) => row.name === 'מנה מסתורית'), false);
  assert.match(breakdown.warnings[0], /מנה מסתורית/u);
});

test('pickup has no delivery line; free delivery is a 0$ line', () => {
  const pickup = orderPriceBreakdown({ total: '0', pickup: true }, MENU);
  assert.equal(pickup.lines.some((row) => row.kind === 'delivery'), false);
  const free = orderPriceBreakdown({ total: '0', pickup: false, freeDelivery: true }, MENU);
  assert.equal(free.lines.find((row) => row.kind === 'delivery').amountMinorUnits, 0);
});
