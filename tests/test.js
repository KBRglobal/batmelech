const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '../index.html');
  await page.goto(url);

  const assert = (cond, msg) => { if (!cond) { errors.push('ASSERT FAIL: ' + msg); } else console.log('ok:', msg); };

  assert(await page.locator('.empty').count() === 1, 'empty state shown');

  // Open new order form
  await page.click('[data-tab="form"]');
  assert(await page.locator('[data-bind="date"]').count() === 1, 'form rendered');

  // Fill order like Katy's
  await page.fill('[data-bind="date"]', '2026-08-07');
  await page.fill('[data-bind="name"]', 'קטי סוזנה');
  await page.fill('[data-bind="phone"]', '054-2016970');
  await page.fill('[data-bind="place"]', 'גרנד הייאט');
  await page.fill('[data-bind="time"]', '16:30');

  // salads: ordered — index 1 (כרוב סגול), 6 (מסייר), 7 (טחינה), 13 (עגבניות שרי); pinuk — 3 (מטבוחה), 9 (גזר מרוקאי)
  for (const i of [1, 6, 7, 13]) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="o"][data-d="1"]`);
  for (const i of [3, 9]) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="p"][data-d="1"]`);
  assert((await page.locator('[data-badge="salads"]').textContent()).includes('4/4'), 'salad badge shows 4/4 included');

  // firsts: 1 moroccan + 1 chraime
  await page.click('[data-act="bump"][data-group="firsts"][data-i="0"][data-d="1"]');
  await page.click('[data-act="bump"][data-group="firsts"][data-i="1"][data-d="1"]');
  await page.selectOption('[data-bind="heat"]', 'לא חריף');

  // main: index 0 (קציצות בשר ברוטב אדום)
  await page.click('[data-act="bump"][data-group="mains"][data-i="0"][data-d="1"]');
  // sides: אורז לבן x2
  await page.click('[data-act="bump"][data-group="sides"][data-i="0"][data-d="1"]');
  await page.click('[data-act="bump"][data-group="sides"][data-i="0"][data-d="1"]');
  // dessert: סופלה x1
  await page.click('[data-act="bump"][data-group="desserts"][data-i="0"][data-d="1"]');
  // extra: kids meal (index 14) qty 1 + note appears
  await page.click('[data-act="bump"][data-group="extras"][data-i="14"][data-d="1"]');
  assert(!(await page.locator('[data-note-cell="extras|14"]').evaluate(el => el.classList.contains('hidden'))), 'extra note input appears');
  await page.fill('[data-note-cell="extras|14"]', 'מנת פסטה ושניצל ילדים');

  // aricha 6, challot stays 2
  for (let j = 0; j < 6; j++) await page.click('[data-act="bump"][data-group="aricha"][data-i="0"][data-d="1"]');

  // price suggestion should be 230 + 35 = 265
  const hint = await page.locator('#priceHint').textContent();
  assert(hint.includes('265'), 'suggested total 265 in hint: ' + hint.trim().slice(0, 120));
  await page.click('[data-act="useSuggested"]');
  assert(await page.locator('[data-bind="total"]').inputValue() === '265', 'total filled from suggestion');
  await page.fill('[data-bind="total"]', '390');
  await page.selectOption('[data-bind="paid"]', 'מקדמה');
  await page.fill('[data-bind="deposit"]', '100');

  await page.click('[data-act="save"]');
  assert(await page.locator('.order-card').count() === 1, 'order saved and listed');
  assert((await page.locator('.oc-name').textContent()) === 'קטי סוזנה', 'name on card');
  assert((await page.locator('.oc-total').textContent()).includes('390'), 'total on card');

  // order text card
  await page.click('[data-act="toggleText"]');
  const txt = await page.locator('.order-text').textContent();
  assert(txt.includes('פינוק'), 'order text marks pinuk');
  assert(txt.includes('פילה דג ברוטב מרוקאי ×1'), 'order text firsts qty');
  assert(txt.includes('עריכה: 6 איש'), 'order text aricha');

  // second order same date, salads-only
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', '2026-08-07');
  await page.fill('[data-bind="name"]', 'חיים הלוי');
  // meals -> 0
  await page.click('[data-act="bump"][data-group="meals"][data-i="0"][data-d="-1"]');
  // pickup
  await page.check('[data-bind="pickup"]');
  assert(await page.locator('#deliveryFields').evaluate(el => el.hidden), 'delivery fields hidden on pickup');
  for (const i of [1, 6]) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="o"][data-d="1"]`);
  await page.click('[data-act="bump"][data-group="salads"][data-i="7"][data-k="p"][data-d="1"]');
  // custom item
  await page.click('[data-act="addCustom"]');
  await page.fill('[data-bind="custom-name"][data-i="0"]', 'סלטים בודדים');
  await page.fill('[data-bind="custom-price"][data-i="0"]', '30');
  await page.fill('[data-bind="total"]', '30');
  await page.click('[data-act="save"]');
  assert(await page.locator('.order-card').count() === 2, 'two orders listed');

  // third order far in future (like Nir end of month)
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', '2026-08-28');
  await page.fill('[data-bind="name"]', 'ניר מסס');
  await page.click('[data-act="save"]');
  const dateHeaders = await page.locator('.date-h .d').allTextContents();
  assert(dateHeaders.length === 2, 'orders grouped under 2 dates: ' + JSON.stringify(dateHeaders));

  // summary for 07.08
  await page.click('[data-act="daySummary"][data-date="2026-08-07"]');
  const stats = await page.locator('.stats').textContent();
  assert(stats.includes('2'), 'summary shows 2 orders');
  const body = await page.locator('#view').textContent();
  assert(body.includes('סלטים להכנה'), 'salad prep table present');
  assert(body.includes('טחינה'), 'tahina row aggregated');
  assert(body.includes('נשאר לגבות'), 'owed stat present');
  // owed = (390-100) + 30 = 320
  assert(body.includes('320'), 'owed 320 computed');
  // salads: purple cabbage ordered total 2 (katy 1 + haim 1)
  const rowTexts = await page.locator('table.sum tr').allTextContents();
  const cab = rowTexts.find(r => r.includes('כרוב סגול'));
  assert(cab && cab.includes('2'), 'purple cabbage aggregated to 2: ' + cab);

  // delivery board
  assert(body.includes('גרנד הייאט'), 'delivery board hotel');
  assert(body.includes('איסוף עצמי'), 'pickup row');

  // persistence: reload
  await page.reload();
  await page.click('[data-tab="orders"]');
  assert(await page.locator('.order-card').count() === 3, 'orders persisted after reload');

  // edit flow: open Katy, add pinuk salad, save
  const editBtns = await page.locator('[data-act="edit"]').all();
  await editBtns[0].click();
  assert(await page.locator('[data-bind="name"]').inputValue() === 'קטי סוזנה', 'edit loads draft');
  await page.click('[data-act="bump"][data-group="salads"][data-i="10"][data-k="p"][data-d="1"]');
  await page.click('[data-act="save"]');
  await page.click('[data-act="toggleText"]');
  const txt2 = await page.locator('.order-text').first().textContent();
  assert(txt2.includes('חציל במיונז') && txt2.includes('פינוק'), 'edited pinuk salad in card');

  // backup export text present
  await page.click('[data-tab="backup"]');
  assert((await page.locator('#view').textContent()).includes('3 הזמנות'), 'backup shows 3 orders');

  // screenshots
  await page.click('[data-tab="orders"]');
  await page.screenshot({ path: 'shot-orders.png', fullPage: true });
  await page.click('[data-tab="summary"]');
  await page.screenshot({ path: 'shot-summary.png', fullPage: true });
  await page.click('[data-tab="form"]');
  await page.screenshot({ path: 'shot-form.png', fullPage: false });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
