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
      estLines, buildText, refresh, bump, nextFridayDubai, isRealIsoDate,
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
    meals: 0,
    challot: 0,
    pickup: true,
    salads: {},
    firsts: {},
    mains: {},
    sides: {},
    desserts: {},
    extras: {},
  });
}

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
  assert.match(document.querySelector('#priceBreakdown').textContent, /כמות העיקריות גדולה/u);
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
  assert.equal(api.state.meals, 2);
  assert.equal(api.state.challot, 4);
  assert.equal(document.querySelector('[data-cell="challot|0"]').textContent, '4');

  document.querySelector('[data-group="challot"][data-d="-1"]').click();
  assert.equal(api.challotOverridden(), true);
  assert.equal(api.state.challot, 3);
  document.querySelector('[data-group="meals"][data-d="1"]').click();
  assert.equal(api.state.meals, 3);
  assert.equal(api.state.challot, 3);
});

test('requested extras remain separate catalog rows and public form contains no emoji', t => {
  const { api } = orderFormFixture(t);
  const prices = new Map(api.extras.map(extra => [extra.name, extra.price]));
  for (const [name, price] of [
    ['אורז', 25], ['פסטה אדומה', 25], ['קוסקוס', 25],
    ['מרק ירקות לקוסקוס ללא עוף', 70], ['מרק ירקות לקוסקוס עם עוף', 100],
    ['מארז הבדלה', 20], ['סט עריכה', 10], ['תוספת יין', 5],
  ]) assert.equal(prices.get(name), price);
  assert.equal(prices.has('מגש אורז / קוסקוס / פסטה אדומה'), false);
  assert.match(html, /h2\.sec::before/u);
  assert.match(html, /data:image\/svg\+xml/u);
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(html, /[✿✓]/u);
});
