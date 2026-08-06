const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const assert = (cond, msg) => { if (!cond) { errors.push('ASSERT FAIL: ' + msg); } else console.log('ok:', msg); };

  await page.goto('file://' + path.resolve(__dirname, '../index.html'));

  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3);

  // create an order with salads, extra, delivery
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'קטי סוזנה');
  await page.fill('[data-bind="place"]', 'גרנד הייאט');
  await page.fill('[data-bind="address"]', 'מגדל 2');
  for (const i of [0, 7]) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="o"][data-d="1"]`);
  await page.click('[data-act="bump"][data-group="firsts"][data-i="0"][data-d="1"]');
  await page.click('[data-act="bump"][data-group="extras"][data-i="14"][data-d="1"]');
  await page.fill('[data-bind="total"]', '265');
  await page.click('[data-act="save"]');

  // backup reminder shows on today screen (no backup yet, orders exist)
  await page.click('[data-tab="today"]');
  let body = await page.locator('#view').textContent();
  assert(body.includes('עוד לא נשמר קובץ גיבוי'), 'backup reminder shown');
  assert(body.includes('מה מכינים'), 'cook-day shortcut on load rows');
  // click backup → reminder disappears
  await page.click('[data-act="exportFile"]');
  await page.waitForTimeout(700);
  body = await page.locator('#view').textContent();
  assert(!body.includes('עוד לא נשמר קובץ גיבוי'), 'reminder gone after backup');

  // prep checklist on single-date summary
  await page.click('[data-act="daySummary"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('נגיעה על שורה'), 'checklist hint shown');
  assert(body.includes('0/4'), 'progress 0/4 (2 salads + 1 fish + 1 extra): ' + (body.match(/\d+\/\d+/g) || []).join(','));
  // tap first salad row
  const rows = page.locator('tr[data-check]');
  const n0 = await rows.count();
  assert(n0 === 4, 'four checkable rows: got ' + n0);
  await rows.first().click();
  body = await page.locator('#view').textContent();
  assert(body.includes('1/4'), 'progress 1/4 after tap');
  assert(await page.locator('tr[data-check].done').count() === 1, 'row marked done with strikethrough');
  // tap extra row (last)
  await page.locator('tr[data-check]').last().click();
  assert((await page.locator('#view').textContent()).includes('2/4'), 'progress 2/4');
  // untap
  await page.locator('tr[data-check].done').first().click();
  assert((await page.locator('#view').textContent()).includes('1/4'), 'untap works');

  // persists after reload
  await page.reload();
  await page.click('[data-tab="summary"]');
  await page.selectOption('select[data-bind="summaryDate"]', iso(d3));
  assert((await page.locator('#view').textContent()).includes('1/4'), 'checklist persisted after reload');

  // maps button in delivery board
  const mapHref = await page.locator('a[href*="google.com/maps"]').first().getAttribute('href');
  assert(mapHref.includes(encodeURIComponent('גרנד הייאט')), 'maps link includes hotel name');
  assert(mapHref.includes('Dubai'), 'maps link includes Dubai');

  // week scope with ONE date still checkable (keyed to the real date)
  await page.selectOption('select[data-bind="summaryDate"]', 'next7');
  assert(await page.locator('tr[data-check]').count() === 4, 'single-date week scope still checkable');
  assert((await page.locator('#view').textContent()).includes('1/4'), 'week scope shows same progress (keyed by date)');
  // add order on a second date -> week becomes multi -> no checkboxes
  await page.click('[data-tab="form"]');
  const d5 = new Date(); d5.setDate(d5.getDate() + 5);
  await page.fill('[data-bind="date"]', iso(d5));
  await page.fill('[data-bind="name"]', 'חיים הלוי');
  await page.click('[data-act="bump"][data-group="salads"][data-i="1"][data-k="o"][data-d="1"]');
  await page.click('[data-act="save"]');
  await page.click('[data-tab="summary"]');
  await page.selectOption('select[data-bind="summaryDate"]', 'next7');
  assert(await page.locator('tr[data-check]').count() === 0, 'no checkboxes in true multi-date scope');

  await page.selectOption('select[data-bind="summaryDate"]', iso(d3));
  await page.screenshot({ path: 'shot-checklist.png', fullPage: true });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
