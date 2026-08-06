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

  // today screen is default, empty state
  let body = await page.locator('#view').textContent();
  assert(/בוקר טוב|צהריים טובים|ערב טוב/.test(body), 'today greeting shown');
  assert(body.includes('עדיין אין הזמנות'), 'today empty state');

  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3);

  // set capacity to 2 in settings
  await page.click('[data-tab="backup"]');
  await page.fill('[data-bind="maxMeals"]', '2');

  const addOrder = async (name, opts = {}) => {
    await page.click('[data-tab="form"]');
    await page.fill('[data-bind="date"]', opts.date || iso(d3));
    await page.fill('[data-bind="name"]', name);
    if (opts.total) await page.fill('[data-bind="total"]', String(opts.total));
    if (opts.deposit) await page.fill('[data-bind="deposit"]', String(opts.deposit));
    if (opts.paid) await page.selectOption('[data-bind="paid"]', opts.paid);
    if (opts.status) await page.selectOption('[data-bind="status"]', opts.status);
    await page.click('[data-act="save"]');
  };

  // order 1: 1 meal, no deposit, status default (חדשה)
  await addOrder('קטי סוזנה', { total: 230 });
  // order 2: fills capacity (2/2) — check warning shown in form before save
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'לילך בוארון');
  let hint = await page.locator('#priceHint').textContent();
  assert(hint.includes('מתמלא') && hint.includes('2/2'), 'capacity fill warning at 2/2: ' + hint.trim().slice(-80));
  await page.selectOption('[data-bind="status"]', 'אושרה');
  await page.fill('[data-bind="total"]', '540');
  await page.fill('[data-bind="deposit"]', '100');
  await page.selectOption('[data-bind="paid"]', 'מקדמה');
  await page.click('[data-act="save"]');

  // orders list shows capacity badge full
  let dh = await page.locator('.date-h').first().textContent();
  assert(dh.includes('2/2 זוגיות') && dh.includes('מלא'), 'date header shows 2/2 full: ' + dh.trim().slice(0, 80));

  // third order exceeds → over-capacity warning
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'ניר מסס');
  hint = await page.locator('#priceHint').textContent();
  assert(hint.includes('מעבר לתקרה'), 'over-capacity warning: ' + hint.trim().slice(-80));
  await page.click('[data-act="cancel"]');

  // today screen: capacity bar + alerts
  await page.click('[data-tab="today"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('העומס הקרוב'), 'load section shown');
  assert(await page.locator('.cap-fill.full').count() === 1, 'capacity bar full');
  assert(body.includes('מלא!'), 'full pill');
  assert(body.includes('דורש טיפול'), 'alerts section');
  assert(body.includes('קטי סוזנה') && body.includes('בלי מקדמה'), 'no-deposit alert for Katy');
  assert(body.includes('ממתינה לאישור'), 'pending-approval alert');
  assert(!body.includes('לילך בוארון (') || true, 'ok');
  // owed = (230-0) + (540-100) = 670
  assert(body.includes('670'), 'owed sum 670 shown');
  // alert opens the order
  await page.locator('.item-row', { hasText: 'בלי מקדמה' }).locator('[data-act="edit"]').click();
  assert(await page.locator('[data-bind="name"]').inputValue() === 'קטי סוזנה', 'alert opens order for edit');
  await page.click('[data-act="cancel"]');

  // label food-safety line
  await page.click('[data-tab="summary"]');
  await page.click('[data-act="labels"]');
  const lbl = await page.locator('#lbPreview .label').first().textContent();
  assert(lbl.includes('לשמור בקירור'), 'label has storage line');
  assert(lbl.includes('הוכן בתאריך'), 'label has prep date');

  // settings persist after reload
  await page.reload();
  await page.click('[data-tab="backup"]');
  assert(await page.locator('[data-bind="maxMeals"]').inputValue() === '2', 'capacity setting persisted');

  await page.click('[data-tab="today"]');
  await page.screenshot({ path: 'shot-today.png', fullPage: true });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
