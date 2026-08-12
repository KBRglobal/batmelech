'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'order-form.html'), 'utf8');
const requireWeb = createRequire(path.join(projectRoot, 'web', 'package.json'));
const { JSDOM, VirtualConsole } = requireWeb('jsdom');

function orderFormFixture(t) {
  const clipboardWrites = [];
  const instrumentedHtml = html.replace('</body>', `<script>
    window.__orderFormTest = {
      state:o, firsts:FIRSTS, mains:MAINS, sides:SIDES, desserts:DESSERTS, extras:EXTRAS,
      lunch:LUNCH, lunchSides:LUNCH_SIDES, paidMainExtras:PAID_MAIN_EXTRAS,
      estLines, buildText, buildInternalText, refresh, bump, nextFridayDubai, isRealIsoDate,
      challotOverridden:()=>challotOverridden
    };
  </script></body>`);
  const virtualConsole = new VirtualConsole();
  const scriptErrors = [];
  virtualConsole.on('jsdomError', error => scriptErrors.push(error));
  const dom = new JSDOM(instrumentedHtml, {
    runScripts: 'dangerously',
    url: 'https://batmelech.test/order-form.html',
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { clipboardWrites.push(value); } },
      });
      window.document.execCommand = () => true;
    },
  });
  t.after(() => dom.window.close());
  assert.deepEqual(scriptErrors, []);
  assert.ok(dom.window.__orderFormTest, 'the real inline order form script must execute');
  return { dom, api: dom.window.__orderFormTest, clipboardWrites };
}

function resetSelections(api) {
  Object.assign(api.state, {
    date: '2099-08-14',
    name: 'לקוח בדיקה',
    phone: '0500000000',
    place: 'מלון בדיקה',
    meals: 0,
    challot: 0,
    pickup: true,
    salads: {},
    firsts: {},
    mains: {},
    sides: {},
    desserts: {},
    extras: {},
    lunch: {},
  });
}

function decodeBM1(api) {
  const encoded = api.buildInternalText().match(/#BM1#([A-Za-z0-9+/=]+)#/u)?.[1];
  assert.ok(encoded, 'the WhatsApp text must include a BM1 payload');
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

test('actual untouched form starts with zero couple meals and zero challahs', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  assert.equal(api.state.meals, 0);
  assert.equal(api.state.challot, 0);
  assert.equal(document.querySelector('[data-cell="meals|0"]').textContent, '0');
  assert.equal(document.querySelector('[data-cell="challot|0"]').textContent, '0');
  assert.equal(api.estLines().total, 0);
  assert.equal(api.estLines().lines.length, 0);
  assert.equal(document.querySelector('#waSend').getAttribute('href'), null);
  assert.equal(document.querySelector('#copyBtn').disabled, true);
  const payload = decodeBM1(api);
  assert.equal(payload.meals, 0);
  assert.equal(payload.challot, 0);
});

test('customer WhatsApp text is clean and keeps the internal BM1 payload out of the message', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.name = 'לקוח בדיקה';
  api.state.phone = '0500000000';
  api.state.mains = { 'רולדת בשר — במקום עיקרית': 1 };
  api.refresh();
  const customerText = api.buildText();
  assert.doesNotMatch(customerText, /#BM1#/u);
  assert.doesNotMatch(customerText, /[A-Za-z0-9+/]{30,}={0,2}#/u);
  assert.match(api.buildInternalText(), /#BM1#[A-Za-z0-9+/=]+#/u);
  assert.match(customerText, /רולדת בשר/u);
});

test('actual customer copy presents the Shabbat couple package as optional beside weekday orders', t => {
  const { dom } = orderFormFixture(t);
  const text = dom.window.document.body.textContent;
  assert.match(text, /מטבח ביתי אותנטי · שבת ואמצע השבוע/u);
  assert.match(text, /חבילת שבת זוגית — לבחירה/u);
  assert.match(text, /אקסטרות או תפריט צהריים בלבד, בלי לבחור חבילת שבת/u);
});

test('actual empty pickup and delivery drafts both remain zero and blocked', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  resetSelections(api);
  for (const pickup of [false, true]) {
    api.state.pickup = pickup;
    api.refresh();
    assert.equal(api.estLines().total, 0);
    assert.deepEqual(Array.from(api.estLines().lines), []);
    assert.equal(document.querySelector('#waSend').getAttribute('href'), null);
    assert.equal(document.querySelector('#copyBtn').disabled, true);
  }
});

function setFish(api, meals, firsts) {
  resetSelections(api);
  api.state.meals = meals;
  api.state.challot = 2 * meals;
  api.state.firsts = firsts;
  return api.estLines();
}

test('actual estLines includes two mixed or identical fish units and prices every extra fillet at $30', t => {
  const { api } = orderFormFixture(t);
  const [moroccan, chraime] = api.firsts;
  const mixed = setFish(api, 1, { [moroccan]: 1, [chraime]: 1 });
  assert.equal(mixed.fishUnits, 2);
  assert.equal(mixed.extraFishUnits, 0);
  assert.equal(mixed.total, 230);
  assert.equal(setFish(api, 1, { [moroccan]: 2 }).total, 230);
  assert.equal(setFish(api, 1, { [moroccan]: 3 }).total, 260);
  assert.equal(setFish(api, 2, { [moroccan]: 5 }).total, 490);

  const standalone = setFish(api, 0, { [moroccan]: 1 });
  assert.equal(standalone.total, 30);
  assert.equal(standalone.extraFishUnits, 1);
  assert.equal(standalone.blockingWarnings.length, 0);
});

test('actual estLines treats one fish-cake portion as two fish units without a manual warning', t => {
  const { api } = orderFormFixture(t);
  const fishCakes = api.firsts[2];
  assert.equal(setFish(api, 1, { [fishCakes]: 1 }).total, 230);
  const standalone = setFish(api, 0, { [fishCakes]: 1 });
  assert.equal(standalone.fishUnits, 2);
  assert.equal(standalone.extraFishUnits, 2);
  assert.equal(standalone.total, 60);
  assert.equal(standalone.blockingWarnings.length, 0);
  assert.equal(api.extras.some(extra => /דג|קציצות דגים/u.test(extra.name)), false);
  assert.doesNotMatch(html, /המחיר לדגים הנוספים יתואם/u);
});

test('actual estLines repeats salad blocks and seven-dollar remainders', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.meals = 1;
  api.state.challot = 2;
  const expected = new Map([[4, 230], [5, 237], [6, 244], [7, 251], [8, 255], [9, 262]]);
  for (const [count, total] of expected) {
    api.state.salads = { salad: count };
    assert.equal(api.estLines().total, total);
  }
  assert.doesNotMatch(html, /exp\.extras\['תוספת 4 סלטים לבחירה'\]/u);
});

test('actual form charges standalone challah and exactly one automatic delivery fee', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.challot = 1;
  assert.equal(api.estLines().total, 10);

  api.state.pickup = false;
  const delivery = api.estLines();
  const deliveryLines = delivery.lines.filter(line => line.l === 'משלוח ברחבי דובאי');
  assert.equal(deliveryLines.length, 1);
  assert.equal(deliveryLines[0].a, 15);
  assert.equal(delivery.total, 25);
});

test('actual form blocks WhatsApp and copy for unpriced main, side, and dessert overages', t => {
  const { dom, api, clipboardWrites } = orderFormFixture(t);
  const document = dom.window.document;
  const send = document.querySelector('#waSend');
  const copy = document.querySelector('#copyBtn');

  resetSelections(api);
  api.state.meals = 1;
  api.state.challot = 2;
  api.state.mains = { [api.mains[0]]: 2 };
  api.refresh();
  assert.equal(send.getAttribute('href'), null);
  assert.equal(send.getAttribute('aria-disabled'), 'true');
  assert.equal(copy.disabled, true);
  assert.match(document.querySelector('#priceBreakdown').textContent, /כמות העיקריות/u);
  assert.equal(send.dispatchEvent(new dom.window.MouseEvent('click', { cancelable: true })), false);
  copy.click();
  assert.equal(clipboardWrites.length, 0);

  api.state.mains = {};
  api.state.sides = { [api.sides[0]]: 2 };
  api.refresh();
  assert.match(document.querySelector('#priceBreakdown').textContent, /כמות התוספות גדולה/u);
  assert.equal(send.getAttribute('href'), null);

  api.state.sides = {};
  api.state.desserts = { [api.desserts[0]]: 3 };
  api.refresh();
  assert.match(document.querySelector('#priceBreakdown').textContent, /כמות הקינוחים גדולה/u);
  assert.equal(send.getAttribute('href'), null);

  api.state.desserts = { 'קינוח לא מוכר': 1 };
  api.refresh();
  assert.match(document.querySelector('#priceBreakdown').textContent, /אינה יודעת לסווג/u);
  assert.equal(copy.disabled, true);

  api.state.desserts = { [api.desserts[0]]: 2 };
  api.refresh();
  assert.match(send.href, /^https:\/\/wa\.me\//u);
  assert.equal(send.getAttribute('aria-disabled'), 'false');
  assert.equal(copy.disabled, false);
});

test('actual form accepts scaled mixed dessert allowances without inventing a price', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.meals = 2;
  api.state.challot = 4;
  api.state.desserts = { [api.desserts[0]]: 2, [api.desserts[1]]: 1 };
  const estimate = api.estLines();
  assert.equal(estimate.blockingWarnings.length, 0);
  assert.equal(estimate.total, 460);
  assert.equal(estimate.lines.some(line => /קינוח/u.test(line.l)), false);
});

test('actual form defaults to Friday in Dubai and blocks a missing or impossible date', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  const dateInput = document.querySelector('[data-bind="date"]');
  assert.equal(api.isRealIsoDate(dateInput.value), true);
  assert.equal(new Date(`${dateInput.value}T00:00:00Z`).getUTCDay(), 5);
  assert.equal(api.nextFridayDubai(new Date('2026-08-14T18:00:00Z')), '2026-08-14');
  assert.equal(api.nextFridayDubai(new Date('2026-08-14T21:00:00Z')), '2026-08-21');
  assert.equal(api.isRealIsoDate('2026-02-30'), false);

  api.state.date = '';
  api.refresh();
  assert.equal(document.querySelector('#waSend').getAttribute('href'), null);
  assert.equal(document.querySelector('#copyBtn').disabled, true);
  assert.match(document.querySelector('#priceBreakdown').textContent, /תאריך הזמנה תקין/u);

  api.state.date = '2026-02-30';
  api.refresh();
  assert.equal(document.querySelector('#waSend').getAttribute('href'), null);
});

test('actual meal stepper synchronizes two challahs per meal only until manual override', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  document.querySelector('[data-group="meals"][data-d="1"]').click();
  assert.equal(api.state.meals, 1);
  assert.equal(api.state.challot, 2);
  assert.equal(document.querySelector('[data-cell="challot|0"]').textContent, '2');

  document.querySelector('[data-group="challot"][data-d="-1"]').click();
  assert.equal(api.challotOverridden(), true);
  assert.equal(api.state.challot, 1);
  document.querySelector('[data-group="meals"][data-d="1"]').click();
  assert.equal(api.state.meals, 2);
  assert.equal(api.state.challot, 1);
});

test('requested extras remain separate catalog rows and public form contains no emoji', t => {
  const { api } = orderFormFixture(t);
  const prices = new Map(api.extras.map(extra => [extra.name, extra.price]));
  for (const [name, price] of [
    ['צלי בקר פרוס ברוטב פטריות וערמונים (ל־4 אנשים)', 150],
    ['מפרום ביתי של אמא (זוגי)', 40],
    ['טבחה בשר אדומה עם אפונה ותפו"א (ל־2־3 אנשים)', 100],
    ['רולדת בשר פריך ברוטב פטריות עשיר', 100],
    ["מגש שניצלים (זוגי, כ־13–15 יח')", 100],
    ['מגש תפו"א קריספיים', 30],
    ['אורז', 25], ['פסטה אדומה', 25], ['קוסקוס', 25],
    ['צלחת פתיחה (זיתים וחמוצים)', 15], ['צלחת חריפים', 15],
    ['תוספת חומוס ישראלי לניגוב', 15],
    ['מרק ירקות לקוסקוס ללא עוף', 70], ['מרק ירקות לקוסקוס עם עוף', 100],
    ['סיר קובה סלק בתוספת אורז (ל־4 אנשים)', 125],
    ['מנת ילדים — פסטה אדומה ושניצלונים', 35],
    ['חלת שניצל (ספיישל סופ"ש)', 28], ['מנת מפרום ביתי (תוספת)', 20],
    ['מארז הבדלה', 20], ['סט עריכה', 10], ['תוספת יין', 5],
  ]) assert.equal(prices.get(name), price);
  assert.equal(prices.size, 21);
  assert.equal(prices.has('מגש אורז / קוסקוס / פסטה אדומה'), false);
  assert.match(html, /h2\.sec::before/u);
  assert.match(html, /data:image\/svg\+xml/u);
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(html, /[✿✓]/u);
});

test('actual main steppers price ten standalone roulades before WhatsApp and BM1 export', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  const rouladeMain = 'רולדת בשר — במקום עיקרית';
  const rouladeExtra = 'רולדת בשר פריך ברוטב פטריות עשיר';
  resetSelections(api);
  api.state.pickup = false;
  const mainIndex = api.mains.indexOf(rouladeMain);
  assert.notEqual(mainIndex, -1);
  const plus = document.querySelector(`[data-group="mains"][data-i="${mainIndex}"][data-d="1"]`);
  for (let quantity = 0; quantity < 10; quantity += 1) plus.click();

  let estimate = api.estLines();
  assert.equal(estimate.total, 1_015);
  assert.deepEqual(
    Array.from(estimate.lines, line => [line.l, line.a]),
    [[`${rouladeExtra} ×10`, 1_000], ['משלוח ברחבי דובאי', 15]],
  );
  assert.match(decodeURIComponent(document.querySelector('#waSend').href), /סה"כ משוער: 1015\$/u);
  let payload = decodeBM1(api);
  assert.deepEqual(payload.mains, {});
  assert.deepEqual(payload.extras[rouladeExtra], { q: 10, note: '' });
  assert.deepEqual(payload.extras['משלוח'], { q: 1, note: '' });

  const pickup = document.querySelector('[data-bind="pickup"]');
  pickup.checked = true;
  pickup.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  estimate = api.estLines();
  assert.equal(estimate.total, 1_000);
  assert.equal(estimate.lines.some(line => line.l === 'משלוח ברחבי דובאי'), false);
  payload = decodeBM1(api);
  assert.equal(payload.extras['משלוח'], undefined);
});

test('actual main allocation keeps the first tray in a couple and charges only the overage', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.meals = 1;
  api.state.challot = 2;
  api.state.mains = { 'רולדת בשר — במקום עיקרית': 3 };
  const estimate = api.estLines();
  assert.equal(estimate.total, 430);
  assert.deepEqual(
    Array.from(estimate.lines, line => [line.l, line.a]),
    [['ארוחה זוגית ×1', 230], ['רולדת בשר פריך ברוטב פטריות עשיר ×2', 200]],
  );
  const payload = decodeBM1(api);
  assert.deepEqual(payload.mains, { 'רולדת בשר — במקום עיקרית': 1 });
  assert.deepEqual(payload.extras['רולדת בשר פריך ברוטב פטריות עשיר'], { q: 2, note: '' });
});

test('actual form exposes one customer control for each paid tray intent', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  for (const [mainName, paid] of Object.entries(api.paidMainExtras)) {
    const mainIndex = api.mains.indexOf(mainName);
    assert.notEqual(mainIndex, -1);
    assert.ok(document.querySelector(`[data-group="mains"][data-i="${mainIndex}"]`));
    const extraIndex = api.extras.findIndex(extra => extra.name === paid.name);
    assert.notEqual(extraIndex, -1);
    assert.equal(document.querySelector(`[data-group="extras"][data-i="${extraIndex}"]`), null);
  }
});

test('actual estimator, WhatsApp text, and BM1 price every explicit paid extra by quantity', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  for (const [index, extra] of api.extras.entries()) {
    if (Object.values(api.paidMainExtras).some(paid => paid.name === extra.name)) continue;
    resetSelections(api);
    const plus = document.querySelector(`[data-group="extras"][data-i="${index}"][data-d="1"]`);
    for (let quantity = 0; quantity < 3; quantity += 1) plus.click();
    const note = document.querySelector(`[data-note-cell="extras|${index}"]`);
    note.value = 'בדיקה';
    note.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const estimate = api.estLines();
    assert.equal(estimate.total, extra.price * 3, extra.name);
    assert.deepEqual(Array.from(estimate.lines, line => line.a), [extra.price * 3], extra.name);
    const text = api.buildText();
    assert.match(text, new RegExp(`${extra.price * 3}\\$`, 'u'), extra.name);
    assert.deepEqual(decodeBM1(api).extras[extra.name], { q: 3, note: 'בדיקה' }, extra.name);
  }
});

test('actual form requires customer details and a destination only for delivery', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  resetSelections(api);
  api.state.name = '';
  api.state.phone = '';
  api.state.extras = { 'תוספת יין': { q: 1, note: '' } };
  api.refresh();
  assert.match(document.querySelector('#priceBreakdown').textContent, /שם מלא/u);
  assert.match(document.querySelector('#priceBreakdown').textContent, /מספר טלפון/u);
  assert.equal(document.querySelector('#waSend').getAttribute('href'), null);

  api.state.name = 'לקוחה';
  api.state.phone = '0500000000';
  api.state.pickup = false;
  api.state.place = '';
  api.refresh();
  assert.match(document.querySelector('#priceBreakdown').textContent, /מלון או אזור/u);
  assert.equal(document.querySelector('#copyBtn').disabled, true);

  api.state.pickup = true;
  api.refresh();
  assert.match(document.querySelector('#waSend').href, /^https:\/\/wa\.me\//u);
  assert.equal(document.querySelector('#copyBtn').disabled, false);
});

test('actual lunch catalog prices every item and variant by quantity in estimate, WhatsApp, and BM1', t => {
  const { api } = orderFormFixture(t);
  const cases = [
    ['baguette', '', 22],
    ['schnitzel-roll', 'baguette', 25],
    ['schnitzel-roll', 'challah', 28],
    ['kubeh', '', 35],
    ['schnitzel-plate', 'single', 35],
    ['schnitzel-plate', 'couple', 60],
    ['schnitzel-plate', 'family', 145],
    ['couscous', '', 35],
  ];
  for (const [key, variant, unitPrice] of cases) {
    resetSelections(api);
    api.state.lunch = { [key]: { q: 2, v: variant, sides: {}, addon: 0 } };
    assert.equal(api.estLines().total, unitPrice * 2, `${key}:${variant}`);
    assert.match(api.buildText(), new RegExp(`סה"כ משוער: ${unitPrice * 2}\\$`, 'u'));
    assert.deepEqual(decodeBM1(api).lunch[key], { q: 2, v: variant, sides: {}, addon: 0 });
  }
});

test('actual lunch pricing scales included sides and charges every paid side and couscous add-on once', t => {
  const { api } = orderFormFixture(t);
  resetSelections(api);
  api.state.lunch = {
    'schnitzel-plate': {
      q: 2,
      v: 'family',
      sides: { 'אורז לבן': 3, 'פסטה אדומה': 2 },
      addon: 0,
    },
  };
  let estimate = api.estLines();
  assert.equal(estimate.total, 315);
  assert.deepEqual(Array.from(estimate.lines, line => line.a), [290, 25]);

  resetSelections(api);
  api.state.lunch = {
    couscous: { q: 1, v: '', sides: {}, addon: 2 },
  };
  estimate = api.estLines();
  assert.equal(estimate.total, 75);
  assert.deepEqual(Array.from(estimate.lines, line => line.a), [35, 40]);
  assert.deepEqual(decodeBM1(api).lunch.couscous, { q: 1, v: '', sides: {}, addon: 2 });
});

test('actual customer path supports a lunch-only midweek pickup without hidden couple or challah', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  const pickup = document.querySelector('[data-bind="pickup"]');
  pickup.checked = true;
  pickup.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const date = document.querySelector('[data-bind="date"]');
  date.value = '2026-08-12';
  date.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const baguetteIndex = api.lunch.findIndex(item => item.key === 'baguette');
  document.querySelector(`[data-group="lunch"][data-i="${baguetteIndex}"][data-d="1"]`).click();

  const estimate = api.estLines();
  assert.equal(estimate.total, 22);
  assert.equal(estimate.lines.some(line => /ארוחה זוגית|חלות/u.test(line.l)), false);
  assert.equal(api.state.meals, 0);
  assert.equal(api.state.challot, 0);
  const payload = decodeBM1(api);
  assert.equal(payload.date, '2026-08-12');
  assert.equal(payload.meals, 0);
  assert.equal(payload.challot, 0);
  assert.deepEqual(payload.lunch.baguette, { q: 1, v: '', sides: {}, addon: 0 });
});

test('actual form blocks the weekend-only schnitzel challah on a weekday', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  resetSelections(api);
  api.state.date = '2099-08-12';
  const itemIndex = api.lunch.findIndex(item => item.key === 'schnitzel-roll');
  document.querySelector(`[data-group="lunch"][data-i="${itemIndex}"][data-d="1"]`).click();
  const challah = document.querySelector(`[data-bind="lunch-variant"][data-i="${itemIndex}"][value="challah"]`);
  challah.checked = true;
  challah.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(api.estLines().total, 28);
  assert.match(document.querySelector('#priceBreakdown').textContent, /זמינה בסוף השבוע בלבד/u);
  assert.equal(document.querySelector('#waSend').getAttribute('href'), null);

  api.state.date = '2099-08-15';
  api.refresh();
  assert.equal(api.estLines().blockingWarnings.length, 0);
  assert.match(document.querySelector('#waSend').href, /^https:\/\/wa\.me\//u);
});

test('actual price summary and customer footer render exactly one total and one closing notice', t => {
  const { dom, api } = orderFormFixture(t);
  const document = dom.window.document;
  resetSelections(api);
  api.state.extras = { 'תוספת יין': { q: 2, note: '' } };
  api.refresh();
  const summary = document.querySelector('#priceBreakdown').textContent;
  assert.equal((summary.match(/סה"כ משוער/gu) || []).length, 1);
  assert.equal((document.body.textContent.match(/ההזמנה נסגרת סופית/gu) || []).length, 1);
});
