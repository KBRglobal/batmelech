'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const { JSDOM } = require(
  require.resolve('jsdom', { paths: [path.join(projectRoot, 'web')] }),
);

const MOROCCAN = 'פילה דג ברוטב מרוקאי';
const CHRAIME = 'פילה דג ברוטב חריימה';
const FISH_CAKES = 'קציצות דגים ברוטב מרוקאי';
const AUTHORITATIVE_FIRSTS = [MOROCCAN, CHRAIME, FISH_CAKES];

function loadLegacyManager(store = { orders: [], settings: { maxMeals: 0 } }) {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://manager.example.test/index.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.confirm = () => false;
      window.localStorage.setItem(
        'batmelech-orders-v1',
        JSON.stringify(store),
      );
    },
  });
  return dom;
}

function draftWith(
  window,
  {
    meals = 0,
    firsts = {},
    saladCount = 0,
    extras = {},
    custom = [],
    desserts = {},
    mains = {},
    sides = {},
    challot = 0,
    pickup = true,
  } = {},
) {
  const draft = window.newDraft();
  draft.meals = meals;
  draft.challot = challot;
  draft.pickup = pickup;
  draft.firsts = firsts;
  draft.salads = saladCount > 0 ? { test: { o: saladCount, p: 0 } } : {};
  draft.extras = extras;
  draft.custom = custom;
  draft.desserts = desserts;
  draft.mains = mains;
  draft.sides = sides;
  draft.lunch = {};
  return draft;
}

function surchargeTotal(window, options) {
  const result = window.computeSuggested(draftWith(window, options));
  return result.total - options.meals * 230;
}

function dispatchClick(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected element for selector: ${selector}`);
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return element;
}

function dispatchInput(window, selector, value, eventType = 'input') {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Expected element for selector: ${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event(eventType, { bubbles: true }));
  return element;
}

function persistedStore(window) {
  return JSON.parse(window.localStorage.getItem('batmelech-orders-v1'));
}

function openNewOrder(window, customerName = 'לקוח בדיקה') {
  dispatchClick(window, '[data-act="tab"][data-tab="form"]');
  dispatchInput(window, '[data-bind="name"]', customerName);
}

function clickSuggestedTotal(window) {
  dispatchClick(window, '[data-act="useSuggested"]');
}

test('legacy manager executes the authoritative fish-unit formula', () => {
  const dom = loadLegacyManager();
  const { window } = dom;

  assert.equal(surchargeTotal(window, { meals: 1, firsts: { [MOROCCAN]: 1, [CHRAIME]: 1 } }), 0);
  assert.equal(surchargeTotal(window, { meals: 1, firsts: { [MOROCCAN]: 2 } }), 0);
  assert.equal(surchargeTotal(window, { meals: 1, firsts: { [MOROCCAN]: 2, [CHRAIME]: 1 } }), 30);
  assert.equal(surchargeTotal(window, { meals: 0, firsts: { [CHRAIME]: 1 } }), 30);
  assert.equal(surchargeTotal(window, { meals: 1, firsts: { [FISH_CAKES]: 1 } }), 0);
  assert.equal(surchargeTotal(window, { meals: 1, firsts: { [FISH_CAKES]: 2 } }), 60);
  assert.equal(surchargeTotal(window, { meals: 2, firsts: { [FISH_CAKES]: 2, [MOROCCAN]: 1 } }), 30);

  dom.window.close();
});

test('legacy manager executes the repeating salad formula, including zero couples', () => {
  const dom = loadLegacyManager();
  const { window } = dom;

  assert.equal(surchargeTotal(window, { meals: 0, saladCount: 1 }), 7);
  assert.equal(surchargeTotal(window, { meals: 0, saladCount: 2 }), 14);
  assert.equal(surchargeTotal(window, { meals: 0, saladCount: 3 }), 21);
  assert.equal(surchargeTotal(window, { meals: 0, saladCount: 4 }), 25);
  assert.equal(surchargeTotal(window, { meals: 0, saladCount: 5 }), 32);
  assert.equal(surchargeTotal(window, { meals: 1, saladCount: 4 }), 0);
  assert.equal(surchargeTotal(window, { meals: 1, saladCount: 8 }), 25);
  assert.equal(surchargeTotal(window, { meals: 1, saladCount: 9 }), 32);
  assert.equal(surchargeTotal(window, { meals: 2, saladCount: 8 }), 0);
  assert.equal(surchargeTotal(window, { meals: 2, saladCount: 9 }), 7);

  dom.window.close();
});

test('legacy persisted menu canonically filters automatic charge names and variants', () => {
  const dom = loadLegacyManager({
    orders: [],
    settings: { maxMeals: 0 },
    futureState: { keep: true },
    menu: {
      futureMenuField: 'keep-me',
      extras: [
        { name: '  תוספת   ４ סלטים לבחירה  ', price: 999 },
        { name: 'תוספת\u00a0מנת\u3000דג', price: 999 },
        { name: ' תוספת   קציצות דגים ', price: 999 },
        { name: '  משלוח  ', price: 999 },
        { name: 'תוספת חלה', price: 10 },
      ],
    },
  });
  const { window } = dom;
  const result = window.computeSuggested(draftWith(window, {
    meals: 1,
    pickup: false,
    extras: {
      '  תוספת   ４ סלטים לבחירה  ': { q: 3, note: '' },
      'תוספת\u00a0מנת\u3000דג': { q: 3, note: '' },
      ' תוספת   קציצות דגים ': { q: 3, note: '' },
      '  משלוח  ': { q: 3, note: '' },
    },
  }));

  assert.equal(result.total, 245);
  assert.equal(result.lines.filter((line) => /משלוח/u.test(line.l)).length, 1);
  assert.doesNotMatch(window.menuEditorHtml(), /תוספת\s+４?4?\s*סלטים|תוספת\s+מנת\s+דג|תוספת\s+קציצות\s+דגים/u);
  assert.doesNotMatch(window.menuEditorHtml(), />\s*משלוח\s*</u);

  window.persistMenu();
  const saved = persistedStore(window);
  assert.deepEqual(saved.futureState, { keep: true });
  assert.equal(saved.menu.futureMenuField, 'keep-me');
  assert.deepEqual(saved.menu.extras, []);

  dom.window.close();
});

test('reserved automatic names in custom rows never charge and block save with a clear message', () => {
  for (const name of [
    ' תוספת   ４ סלטים לבחירה ',
    'תוספת\u00a0מנת\u3000דג',
    ' תוספת  קציצות דגים ',
    ' תוספת  חלה ',
  ]) {
    const dom = loadLegacyManager();
    const { window } = dom;
    const calculated = window.computeSuggested(draftWith(window, {
      custom: [{ name, qty: 2, price: '999', note: '' }],
    }));
    assert.equal(calculated.total, 0);
    assert.equal(calculated.lines.length, 0);

    openNewOrder(window);
    dispatchClick(window, '[data-act="addCustom"]');
    dispatchInput(window, '[data-bind="custom-name"]', name);
    dispatchInput(window, '[data-bind="custom-price"]', '999');
    clickSuggestedTotal(window);
    dispatchClick(window, '[data-act="save"]');

    assert.equal(persistedStore(window).orders.length, 0);
    assert.match(window.document.querySelector('#toast').textContent, /מחושב אוטומטית/u);
    dom.window.close();
  }
});

test('legacy save rejects blank, mismatched, stale, and over-deposit totals before exact save', () => {
  const dom = loadLegacyManager({
    orders: [],
    settings: { maxMeals: 0, futureSetting: 'keep' },
    futureState: { keep: true },
  });
  const { window } = dom;
  openNewOrder(window);

  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /מחיר המחושב/u);

  dispatchInput(window, '[data-bind="total"]', '1');
  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /זהה למחיר המחושב/u);

  clickSuggestedTotal(window);
  dispatchClick(window, '[data-act="bump"][data-group="meals"][data-d="1"]');
  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /זהה למחיר המחושב/u);

  clickSuggestedTotal(window);
  const deterministicTotal = window.document.querySelector('[data-bind="total"]').value;
  dispatchInput(window, '[data-bind="deposit"]', String(Number(deterministicTotal) + 1));
  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /מקדמה.*גבוהה/u);

  dispatchInput(window, '[data-bind="deposit"]', deterministicTotal);
  dispatchClick(window, '[data-act="save"]');
  const saved = persistedStore(window);
  assert.equal(saved.orders.length, 1);
  assert.equal(saved.orders[0].total, deterministicTotal);
  assert.equal(saved.orders[0].deposit, deterministicTotal);
  assert.deepEqual(saved.futureState, { keep: true });
  assert.equal(saved.settings.futureSetting, 'keep');

  dom.window.close();
});

test('editing an order with an exact total preserves unknown order and nested fields', () => {
  const dom = loadLegacyManager({
    orders: [{
      id: 'legacy-1',
      date: '2026-08-14',
      name: 'שם קודם',
      phone: '',
      place: 'Dubai',
      address: '',
      time: '',
      pickup: false,
      status: 'חדשה',
      group: '',
      meals: 1,
      aricha: 0,
      challot: 2,
      salads: { [MOROCCAN]: { o: 1, p: 0, futureSelectionField: 'keep' } },
      firsts: {},
      heat: '',
      firstsNote: '',
      mains: {},
      mainsNote: '',
      sides: {},
      desserts: {},
      extras: {},
      custom: [],
      lunch: {},
      notes: '',
      total: '245',
      deposit: '',
      payMethod: '',
      paid: 'לא',
      futureOrderField: { keep: true },
    }],
    settings: { maxMeals: 0 },
    futureState: 'keep-state',
  });
  const { window } = dom;
  dispatchClick(window, '[data-act="tab"][data-tab="orders"]');
  dispatchClick(window, '[data-act="edit"][data-id="legacy-1"]');
  dispatchInput(window, '[data-bind="name"]', 'שם חדש');
  dispatchClick(window, '[data-act="save"]');

  const saved = persistedStore(window);
  assert.equal(saved.futureState, 'keep-state');
  assert.deepEqual(saved.orders[0].futureOrderField, { keep: true });
  assert.equal(saved.orders[0].salads[MOROCCAN].futureSelectionField, 'keep');
  assert.equal(saved.orders[0].name, 'שם חדש');

  dom.window.close();
});

test('legacy menu editor restores and protects the three authoritative first-course rows', () => {
  const dom = loadLegacyManager({
    orders: [],
    settings: { maxMeals: 0 },
    menu: {
      firsts: [MOROCCAN, 'מנה ראשונה לא מסווגת'],
      futureMenuField: 'keep',
    },
  });
  const { window } = dom;
  dispatchClick(window, '[data-act="tab"][data-tab="backup"]');

  const firstsDetails = [...window.document.querySelectorAll('details')]
    .find((details) => /ראשונות/u.test(details.querySelector('summary')?.textContent || ''));
  assert.ok(firstsDetails);
  for (const name of AUTHORITATIVE_FIRSTS) assert.match(firstsDetails.textContent, new RegExp(name, 'u'));
  assert.doesNotMatch(firstsDetails.textContent, /לא מסווגת/u);

  const deleteButton = firstsDetails.querySelector('[data-act="menuDel"][data-cat="firsts"]');
  deleteButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.match(window.document.querySelector('#toast').textContent, /עריכת התפריט.*מערכת החדשה/u);

  dispatchInput(window, '#menuAdd-firsts', 'דג חדש ולא מסווג');
  dispatchClick(window, '[data-act="menuAdd"][data-cat="firsts"]');
  assert.match(window.document.querySelector('#toast').textContent, /עריכת התפריט.*מערכת החדשה/u);
  assert.doesNotMatch(window.menuEditorHtml(), /דג חדש ולא מסווג/u);

  window.persistMenu();
  const saved = persistedStore(window);
  assert.deepEqual(saved.menu.firsts, AUTHORITATIVE_FIRSTS);
  assert.equal(saved.menu.futureMenuField, 'keep');

  dom.window.close();
});

test('dessert overage and unclassified dessert selections block legacy save', () => {
  const overageDom = loadLegacyManager();
  const overageWindow = overageDom.window;
  openNewOrder(overageWindow);
  for (let count = 0; count < 3; count += 1) {
    dispatchClick(overageWindow, '[data-act="bump"][data-group="desserts"][data-i="0"][data-d="1"]');
  }
  clickSuggestedTotal(overageWindow);
  dispatchClick(overageWindow, '[data-act="save"]');
  assert.equal(persistedStore(overageWindow).orders.length, 0);
  assert.match(overageWindow.document.querySelector('#toast').textContent, /קינוחים.*חורגת.*המחיר.*טרם הוגדר/u);
  overageDom.window.close();

  const unknownDom = loadLegacyManager({
    orders: [],
    settings: { maxMeals: 0 },
    menu: { desserts: ['סופלה שוקולד', 'קינוח מסתורי'] },
  });
  const unknownWindow = unknownDom.window;
  openNewOrder(unknownWindow);
  dispatchClick(unknownWindow, '[data-act="bump"][data-group="desserts"][data-i="1"][data-d="1"]');
  clickSuggestedTotal(unknownWindow);
  dispatchClick(unknownWindow, '[data-act="save"]');
  assert.equal(persistedStore(unknownWindow).orders.length, 0);
  assert.match(unknownWindow.document.querySelector('#toast').textContent, /קינוח.*לשייך.*בבטחה/u);
  unknownDom.window.close();
});

test('legacy delivery pricing matches the public single 15-dollar charge and pickup is free', () => {
  const dom = loadLegacyManager({
    orders: [],
    settings: { maxMeals: 0 },
    menu: {
      extras: [
        { name: ' משלוח ', price: 999 },
        { name: 'תוספת חלה', price: 10 },
      ],
    },
  });
  const { window } = dom;
  const manualDelivery = {
    extras: { ' משלוח ': { q: 4, note: '' } },
    custom: [{ name: 'משלוח', qty: 2, price: '999', note: '' }],
  };
  const delivery = window.computeSuggested(draftWith(window, {
    ...manualDelivery,
    meals: 1,
    pickup: false,
  }));
  const pickup = window.computeSuggested(draftWith(window, {
    ...manualDelivery,
    meals: 1,
    pickup: true,
  }));

  assert.equal(delivery.total, 245);
  assert.equal(delivery.lines.filter((line) => /משלוח/u.test(line.l)).length, 1);
  assert.equal(pickup.total, 230);
  assert.equal(pickup.lines.filter((line) => /משלוח/u.test(line.l)).length, 0);

  openNewOrder(window);
  assert.equal(window.document.querySelector('[data-act="useSuggested"]').dataset.total, '245');
  const pickupInput = window.document.querySelector('[data-bind="pickup"]');
  pickupInput.checked = true;
  pickupInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.querySelector('[data-act="useSuggested"]').dataset.total, '230');
  pickupInput.checked = false;
  pickupInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.querySelector('[data-act="useSuggested"]').dataset.total, '245');

  dom.window.close();
});

test('standalone challahs are charged and unpriced main or side overages never save', () => {
  const dom = loadLegacyManager();
  const { window } = dom;

  assert.equal(window.computeSuggested(draftWith(window, { meals: 0, challot: 1 })).total, 10);
  assert.equal(window.computeSuggested(draftWith(window, { meals: 0, challot: 3 })).total, 30);
  const oneAutomaticChallah = window.computeSuggested(draftWith(window, {
    meals: 1,
    challot: 3,
    extras: { ' תוספת  חלה ': { q: 1, note: '' } },
    custom: [{ name: 'תוספת חלה', qty: 1, price: '10', note: '' }],
  }));
  assert.equal(oneAutomaticChallah.total, 240);
  assert.equal(oneAutomaticChallah.lines.filter((line) => /חלות נוספות/u.test(line.l)).length, 1);

  openNewOrder(window);
  dispatchClick(window, '[data-act="bump"][data-group="mains"][data-i="0"][data-d="1"]');
  dispatchClick(window, '[data-act="bump"][data-group="mains"][data-i="0"][data-d="1"]');
  clickSuggestedTotal(window);
  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /עיקריות.*חורגת.*המחיר.*טרם הוגדר/u);

  dispatchClick(window, '[data-act="bump"][data-group="mains"][data-i="0"][data-d="-1"]');
  dispatchClick(window, '[data-act="bump"][data-group="sides"][data-i="0"][data-d="1"]');
  dispatchClick(window, '[data-act="bump"][data-group="sides"][data-i="0"][data-d="1"]');
  clickSuggestedTotal(window);
  dispatchClick(window, '[data-act="save"]');
  assert.equal(persistedStore(window).orders.length, 0);
  assert.match(window.document.querySelector('#toast').textContent, /תוספות.*חורגת.*המחיר.*טרם הוגדר/u);

  dom.window.close();
});

test('legacy couple changes keep automatic challah entitlement in sync but preserve a manual override', () => {
  const dom = loadLegacyManager();
  const { window } = dom;
  openNewOrder(window);

  assert.equal(window.document.querySelector('[data-cell="meals|0"]').textContent, '1');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '2');
  dispatchClick(window, '[data-act="bump"][data-group="meals"][data-d="1"]');
  assert.equal(window.document.querySelector('[data-cell="meals|0"]').textContent, '2');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '4');
  dispatchClick(window, '[data-act="bump"][data-group="meals"][data-d="1"]');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '6');

  dispatchClick(window, '[data-act="bump"][data-group="challot"][data-d="-1"]');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '5');
  dispatchClick(window, '[data-act="bump"][data-group="meals"][data-d="-1"]');
  assert.equal(window.document.querySelector('[data-cell="meals|0"]').textContent, '2');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '5');

  dom.window.close();
});

test('legacy first lunch selection clears the untouched Shabbat defaults instead of adding a hidden couple meal', () => {
  const dom = loadLegacyManager();
  const { window } = dom;
  openNewOrder(window);

  dispatchClick(window, '[data-act="bump"][data-group="lunch"][data-i="0"][data-d="1"]');

  assert.equal(window.document.querySelector('[data-cell="meals|0"]').textContent, '0');
  assert.equal(window.document.querySelector('[data-cell="challot|0"]').textContent, '0');
  const total = Number(window.document.querySelector('[data-act="useSuggested"]').dataset.total);
  assert.equal(total, 37);

  dom.window.close();
});

test('permanent legacy fallback cannot restore, inject demo orders, or delete a production order', () => {
  const existing = {
    id: 'protected-order',
    date: '2026-08-14',
    name: 'לקוחה אמיתית',
    meals: 1,
    challot: 2,
    salads: {},
    firsts: {},
    mains: {},
    sides: {},
    desserts: {},
    extras: {},
    custom: [],
    lunch: {},
    total: '245',
  };
  const dom = loadLegacyManager({ orders: [existing], settings: { maxMeals: 0 } });
  const { window } = dom;

  dispatchClick(window, '[data-act="tab"][data-tab="backup"]');
  assert.equal(window.document.querySelector('[data-act="importApply"]'), null);
  assert.equal(window.document.querySelector('[data-act="loadDemo"]'), null);
  assert.equal(window.document.querySelector('#importFile'), null);
  assert.doesNotMatch(window.document.body.textContent, /קטי סוזנה|לילך בוארון|חיים הלוי|ניר מסס/u);

  dispatchClick(window, '[data-act="tab"][data-tab="orders"]');
  dispatchClick(window, '[data-act="del"][data-id="protected-order"]');
  assert.deepEqual(persistedStore(window).orders, [existing]);
  assert.match(window.document.querySelector('#toast').textContent, /מחיקה הושבתה/u);

  dom.window.close();
});

test('legacy delivery navigation honors stored Google routes and never forces Abu Dhabi into Dubai', () => {
  const dom = loadLegacyManager();
  const { window } = dom;
  const stored = 'https://www.google.com/maps/search/?api=1&query=24.4539%2C54.3773';

  assert.equal(window.mapsUrl({
    place: 'Abu Dhabi Hotel',
    address: 'Room 12',
    hotelAddress: 'Corniche Road, Abu Dhabi, United Arab Emirates',
    navigationUrl: stored,
  }), stored);
  const generated = window.mapsUrl({
    place: 'Abu Dhabi Hotel',
    address: 'Room 12',
    hotelAddress: 'Corniche Road, Abu Dhabi, United Arab Emirates',
    navigationUrl: 'https://attacker.example/route',
  });
  assert.match(generated, /^https:\/\/www\.google\.com\/maps\/search\//u);
  assert.match(decodeURIComponent(generated), /Corniche Road, Abu Dhabi, United Arab Emirates/u);
  assert.doesNotMatch(decodeURIComponent(generated), /Dubai/u);

  dom.window.close();
});

test('legacy fallback cannot change or reset a catalog used by active preparation', () => {
  const initialStore = {
    orders: [{
      id: 'active-order',
      date: '2026-08-14',
      name: 'Active',
      meals: 1,
      challot: 2,
      salads: {},
      firsts: {},
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
      sides: {},
      desserts: {},
      extras: {},
      custom: [],
      lunch: {},
      total: '230',
    }],
    settings: { maxMeals: 0 },
    menu: { mains: ['קציצות בשר ברוטב אדום עשיר'] },
  };
  const dom = loadLegacyManager(initialStore);
  const { window } = dom;
  dispatchClick(window, '[data-act="tab"][data-tab="backup"]');

  dispatchClick(window, '[data-act="menuDel"][data-cat="mains"]');
  dispatchInput(window, '#menuAdd-mains', 'מנה חדשה');
  dispatchClick(window, '[data-act="menuAdd"][data-cat="mains"]');
  dispatchClick(window, '[data-act="menuReset"]');

  assert.deepEqual(persistedStore(window), initialStore);
  assert.match(window.document.querySelector('#toast').textContent, /איפוס התפריט הושבת/u);
  dom.window.close();
});

test('legacy and customer forms pin the same fish and salad prices', () => {
  const legacy = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const customer = fs.readFileSync(path.join(projectRoot, 'order-form.html'), 'utf8');

  assert.match(legacy, /EXTRA_FISH_UNIT_PRICE\s*=\s*30/);
  assert.match(legacy, /SALAD_PRICE\s*=\s*7/);
  assert.match(legacy, /SALAD_BLOCK_PRICE\s*=\s*25/);
  assert.match(customer, /EXTRA_FISH_UNIT_PRICE\s*=\s*30/);
  assert.match(customer, /SALAD_REMAINDER_PRICE\s*=\s*7/);
  assert.match(customer, /SALAD_BLOCK_PRICE\s*=\s*25/);
});
