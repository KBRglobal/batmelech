'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { orderPriceBreakdown } = require('../server/domain/order-pricing');

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

test("Toni's real order: two schnitzel challot, extras, one single salad, Dubai delivery = 148$", () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '148.00',
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
  assert.equal(byName['סלט אקסטרה בודד'], 700);
  assert.equal(byName['משלוח בדובאי'], 1_500);
  assert.equal(breakdown.computedTotalMinorUnits, 14_800);
  assert.equal(breakdown.matchesStoredTotal, true);
  assert.deepEqual(breakdown.warnings, []);
});

test('a couple meal with its included fish, salads and challot costs the couple price plus delivery', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '245',
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
  assert.equal(breakdown.computedTotalMinorUnits, 24_500);
  assert.equal(breakdown.matchesStoredTotal, true);
});

test('fish cakes count as two fillets, salad overage is priced in blocks then singles, Abu Dhabi costs 55$', () => {
  const breakdown = orderPriceBreakdown(
    {
      total: '400',
      meals: 1,
      challot: 4,
      firsts: { 'קציצות דגים ברוטב מרוקאי': 1, 'פילה דג ברוטב מרוקאי': 1 },
      salads: { 'טחינה': { o: 5 }, 'קולסלאו': { o: 4 } }, // 9 ordered, 4 included -> 5 extra = 1 block + 1 single
      pickup: false,
      deliveryZone: 'abu-dhabi',
    },
    MENU,
  );
  const byName = amounts(breakdown);
  assert.equal(byName['פילה דג אקסטרה'], 3_000);
  assert.equal(byName['סלטים אקסטרה (רביעייה)'], 2_500);
  assert.equal(byName['סלט אקסטרה בודד'], 700);
  assert.equal(byName['חלות נוספות'], 2_000);
  assert.equal(byName['משלוח לאבו דאבי'], 5_500);
  assert.equal(breakdown.computedTotalMinorUnits, 23_000 + 3_000 + 2_500 + 700 + 2_000 + 5_500);
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

test('festive packages use the shared price, multiply quantity, and preserve staff adjustments', async () => {
  const {initialSelection}=await import('../shared/rosh-hashanah.mjs');
  const s=initialSelection('family');s.fish.balls=1;s.fish.moroccan=1;s.mains.peas=1;s.sides.white=1;s.children.forEach(c=>c.rice=1);s.children[0].red=1;
  const order={meals:0,challot:0,pickup:true,festivePackages:[{selection:s,quantity:2,unitPrice:1}],total:'980.00'};
  const result=orderPriceBreakdown(order,{});
  assert.equal(result.computedTotalMinorUnits,99000);
  assert.equal(result.differenceMinorUnits,-1000);
  assert.ok(result.lines.some(line=>line.name.includes('ראש השנה')));
});
