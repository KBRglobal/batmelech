const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.addInitScript(() => { try { if (!localStorage.getItem('batmelech-orders-v1')) localStorage.setItem('batmelech-orders-v1', '{"orders":[]}'); } catch (e) {} });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const assert = (cond, msg) => { if (!cond) { errors.push('ASSERT FAIL: ' + msg); } else console.log('ok:', msg); };

  // stub print dialog
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));

  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3);

  // order with address + status + phone
  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'קטי סוזנה');
  await page.fill('[data-bind="phone"]', '054-2016970');
  await page.fill('[data-bind="place"]', 'גרנד הייאט');
  await page.fill('[data-bind="address"]', 'מגדל 2, למסור בקבלה');
  await page.fill('[data-bind="time"]', '16:30');
  await page.selectOption('[data-bind="status"]', 'אושרה');
  await page.fill('[data-bind="total"]', '230');
  await page.click('[data-act="save"]');

  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'חיים הלוי');
  await page.check('[data-bind="pickup"]');
  await page.click('[data-act="save"]');

  // status pill on card
  let cardText = await page.locator('.order-card').first().textContent();
  assert(cardText.includes('אושרה'), 'status pill on card');
  // whatsapp link
  const wa = await page.locator('.order-card a[href*="wa.me"]').first().getAttribute('href');
  assert(wa && wa.includes('wa.me/972542016970'), 'whatsapp link normalized: ' + (wa || '').slice(0, 40));
  assert(wa.includes('text='), 'whatsapp link carries order text');
  // address in order text
  await page.click('[data-act="toggleText"]');
  const txt = await page.locator('.order-text').first().textContent();
  assert(txt.includes('כתובת: מגדל 2, למסור בקבלה'), 'address line in order text');

  // bon print from card
  await page.click('[data-act="bon"]');
  assert(await page.evaluate(() => window.__printed) === 1, 'print called for bon');
  let bon = await page.locator('#printArea .bon').count();
  assert(bon === 1, 'bon rendered in print area');
  const bonText = await page.locator('#printArea').textContent();
  assert(bonText.includes('מטעמי בת מלך') && bonText.includes('בס"ד'), 'bon has brand header');
  assert(bonText.includes('230'), 'bon shows total');
  // cleanup after timeout
  await page.waitForTimeout(3300);
  assert((await page.locator('#printArea').textContent()).trim() === '', 'print area cleaned up');
  assert(!(await page.evaluate(() => document.body.classList.contains('printing'))), 'printing class removed');

  // summary: print all bons + labels
  await page.click('[data-tab="summary"]');
  await page.click('[data-act="printBons"]');
  assert(await page.evaluate(() => window.__printed) === 2, 'print called for all bons');
  assert(await page.locator('#printArea .bon').count() === 2, 'two bons in print area');
  await page.waitForTimeout(3300);

  // labels screen
  await page.click('[data-act="labels"]');
  assert((await page.locator('h2').textContent()).includes('מדבקות'), 'labels screen opened');
  assert(await page.locator('#lbPreview .label').count() === 2, 'one label per order by default');
  const lbl = await page.locator('#lbPreview .label').first().textContent();
  assert(lbl.includes('קטי סוזנה') && lbl.includes('מטעמי בת מלך'), 'label has name + brand');
  assert(lbl.includes('מגדל 2'), 'label shows address');
  // bump Katy to 3 labels
  const firstId = await page.locator('[data-act="lbBump"][data-d="1"]').first().getAttribute('data-id');
  await page.click(`[data-act="lbBump"][data-id="${firstId}"][data-d="1"]`);
  await page.click(`[data-act="lbBump"][data-id="${firstId}"][data-d="1"]`);
  assert(await page.locator('#lbPreview .label').count() === 4, '3+1 labels after bump');
  // print labels
  await page.click('[data-act="printLabels"]');
  assert(await page.evaluate(() => window.__printed) === 3, 'print called for labels');
  assert(await page.locator('#printArea .label').count() === 4, 'labels in print area');
  await page.waitForTimeout(3300);
  // back to summary
  await page.click('[data-act="labelsBack"]');
  assert((await page.locator('#view').textContent()).includes('סיכום הכנות'), 'back to summary');

  // load badge on orders list (1 meal each order default)
  await page.click('[data-tab="orders"]');
  const dh = await page.locator('.date-h').first().textContent();
  assert(dh.includes('2 זוגיות'), 'date header shows meals load: ' + dh);

  await page.click('[data-tab="summary"]');
  await page.click('[data-act="labels"]');
  await page.screenshot({ path: 'shot-labels.png', fullPage: true });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
