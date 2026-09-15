'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSiteKnowledge, dishIngredients } = require('../server/ai/site-knowledge');

function fullState() {
  return {
    orders: [{ id: 'o1', name: 'קטי', phone: '+97150000000', total: 500 }],
    settings: {
      out: ['טחינה'],
      siteBanner: 'חג שמח לכולם',
      closedDates: ['2026-08-28'],
      minOrderAbuDhabiMinorUnits: 20_000,
      blockedPhones: ['+971555555'],
      meyAuditLog: [{ id: 'audit-1', tool: 'delete_order' }],
      deliveryWindows: [
        { key: 'noon', start: '12:00', end: '14:00', capacity: 6 },
        { key: 'afternoon', start: '14:00', end: '16:00', capacity: 4 },
      ],
      holidayMenus: [
        {
          id: 'hm1',
          holidayKey: 'rosh-hashanah',
          title: { he: 'תפריט ראש השנה', en: 'Rosh Hashanah Menu', fr: '' },
          dishes: [{ name: 'ראש דג חגיגי', displayName: { en: 'Festive Fish Head', fr: '' }, priceUsd: 45 }],
          publishFrom: '2026-08-01',
          publishUntil: '2026-09-11',
          orderCutoff: '2026-09-08',
        },
        {
          id: 'hm2',
          holidayKey: 'pesach',
          title: { he: 'תפריט פסח', en: '', fr: '' },
          dishes: [{ name: 'קניידלעך', displayName: { en: '', fr: '' }, priceUsd: 30 }],
          publishFrom: '2027-03-01',
          publishUntil: '2027-04-01',
          orderCutoff: '2027-03-20',
        },
      ],
    },
    menu: {
      couplePrice: 240,
      addonDinerPrice: 150,
      soloDinerPrice: 170,
      challahPrice: 12,
      includedChallot: 2,
      salads: ['טחינה', 'מטבוחה פיקנטית'],
      firsts: ['פילה דג ברוטב מרוקאי'],
      mains: ['תבשיל עוף מרוקאי עם חומוסים'],
      sides: ['אורז לבן'],
      desserts: ['סופלה שוקולד'],
      itemIds: {
        salads: { 'מטבוחה פיקנטית': 'shabbat-salads-04' },
        mains: { 'תבשיל עוף מרוקאי עם חומוסים': 'shabbat-mains-05' },
      },
      itemMeta: {
        'shabbat-salads-04': { description: 'מטבוחה ביתית חריפה', allergens: 'ללא', heatingInstructions: 'מוגש קר' },
      },
      extras: [{ id: 'ex1', name: 'מארז הבדלה', price: 20, description: 'נר, בשמים ויין' }],
      lunch: [{ key: 'kubeh', price: 35 }],
      lunchSides: ['אורז לבן'],
    },
    recipes: [
      {
        itemId: 'shabbat-mains-05',
        yield: 10,
        ingredients: [
          { ingredientId: 'p1', ingredientName: 'עוף שלם', quantity: '3', unit: 'ק"ג', wastePercent: '10' },
          { ingredientId: 'p2', ingredientName: 'חומוס יבש', quantity: '900', unit: 'גרם' },
          { ingredientId: 'p2', ingredientName: 'חומוס יבש', quantity: '100', unit: 'גרם' },
        ],
      },
      { itemId: 'unknown-item', yield: 5, ingredients: [{ ingredientId: 'p3', ingredientName: 'סולת', quantity: '1', unit: 'ק"ג' }], name: 'קובה סולת' },
    ],
    productLibrary: [
      {
        id: 'p1',
        name: 'עוף שלם',
        category: 'meat',
        listings: { rimon: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 3_200, updatedAt: 1, manualPrice: null } },
      },
    ],
  };
}

test('knowledge covers package rules, live status, windows, holidays and dish meta', () => {
  const knowledge = buildSiteKnowledge(fullState(), { today: '2026-08-19' });

  // Package rules with live overrides: the three ways to order.
  assert.match(knowledge, /package for two[^\n]*costs \$240 and INCLUDES Dubai delivery/u);
  assert.match(knowledge, /add-on diner \(סועד נוסף\) costs \$150 and joins a couple package[^\n]*1 fish fillet, half a main course, half a side, one dessert half-portion[^\n]*1 challah and 6 salads/u);
  assert.match(knowledge, /solo diner \(סועד בודד\) costs \$170 and INCLUDES Dubai delivery[^\n]*1 fish fillet, half a main course, half a side, one dessert half-portion, 2 challot and the full 12-salad box/u);
  assert.match(knowledge, /Abu Dhabi delivery is \$55 on top of any of the three/u);
  assert.match(knowledge, /one couple package \(\$240\) \+ one add-on diner \(\$150\) = \$390/u);
  assert.match(knowledge, /2 challot/u);
  assert.match(knowledge, /2 fillets, one per person/u);
  assert.match(knowledge, /extra challah \$12 each/u);

  // Dish descriptions, allergens and heating from itemMeta.
  assert.match(knowledge, /מטבוחה פיקנטית \(מטבוחה ביתית חריפה; allergens: ללא; heating: מוגש קר\)/u);
  assert.match(knowledge, /מארז הבדלה — \$20 \(נר, בשמים ויין\)/u);

  // Live status.
  assert.match(knowledge, /Ordering is currently open/u);
  assert.match(knowledge, /Current site announcement: חג שמח לכולם/u);
  assert.match(knowledge, /Currently sold out.*טחינה/u);
  assert.match(knowledge, /Dates closed for orders: 2026-08-28/u);
  assert.match(knowledge, /Minimum order for Abu Dhabi delivery: \$200\.00/u);
  assert.match(knowledge, /Delivery time slots: 12:00–14:00, 14:00–16:00/u);

  // Only the holiday menu whose publish window covers today.
  assert.match(knowledge, /תפריט ראש השנה.*ראש דג חגיגי — \$45.*Order by 2026-09-08/u);
  assert.doesNotMatch(knowledge, /תפריט פסח/u);

  // Ingredients resolved through itemIds, deduplicated, names only.
  assert.match(knowledge, /תבשיל עוף מרוקאי עם חומוסים: עוף שלם, חומוס יבש\./u);
  assert.match(knowledge, /קובה סולת: סולת\./u);

  // Allergen coverage: the full ingredient inventory plus the dishes whose
  // recipes are not recorded yet, so "is there X in the food" gets honesty.
  assert.match(knowledge, /Complete inventory of every ingredient used across the recorded recipes: עוף שלם, חומוס יבש, סולת\./u);
  assert.match(knowledge, /NOT recorded here yet[^\n]*טחינה, מטבוחה פיקנטית, פילה דג ברוטב מרוקאי, אורז לבן, סופלה שוקולד/u);
  assert.doesNotMatch(knowledge, /NOT recorded here yet[^\n]*תבשיל עוף מרוקאי/u);

  // Admin bookkeeping never leaks: quantities, supplier prices, capacities,
  // audit entries, blocked phones, customer data, internal ids.
  assert.doesNotMatch(knowledge, /900/u);
  assert.doesNotMatch(knowledge, /3_?200/u);
  assert.doesNotMatch(knowledge, /capacity/u);
  assert.doesNotMatch(knowledge, /audit-1/u);
  assert.doesNotMatch(knowledge, /\+971555555/u);
  assert.doesNotMatch(knowledge, /קטי/u);
  assert.doesNotMatch(knowledge, /shabbat-mains-05/u);
  assert.doesNotMatch(knowledge, /wastePercent|10%/u);
});

test('closed ordering is reported with its reopen date', () => {
  const state = fullState();
  state.settings.orderingOpen = false;
  state.settings.orderingClosedUntil = '2099-01-04';
  const knowledge = buildSiteKnowledge(state, { today: '2026-08-19' });
  assert.match(knowledge, /Ordering is currently closed; it reopens on 2099-01-04/u);
});

test('empty state still yields the fixed business facts and package fallbacks', () => {
  const knowledge = buildSiteKnowledge({}, { today: '2026-08-19' });
  assert.match(knowledge, /Dubai delivery is INCLUDED in the price of every Shabbat package[^\n]*pays \$15 for Dubai delivery\. Abu Dhabi delivery is \$55 on every order/u);
  assert.match(knowledge, /costs \$299 and INCLUDES Dubai delivery/u);
  assert.match(knowledge, /add-on diner \(סועד נוסף\) costs \$149/u);
  assert.match(knowledge, /solo diner \(סועד בודד\) costs \$169/u);
  assert.match(knowledge, /Thursday at 6:00 PM/u);
  assert.doesNotMatch(knowledge, /Holiday menus/u);
});

test('dishIngredients skips recipes with no resolvable name or no ingredients', () => {
  const dishes = dishIngredients({
    recipes: [
      { itemId: 'x', yield: 1, ingredients: [] },
      { itemId: 'y', yield: 1, ingredients: [{ ingredientId: 'a', ingredientName: 'מלח', quantity: '1', unit: 'גרם' }] },
    ],
  });
  assert.equal(dishes.length, 0);
});
