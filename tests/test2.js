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

  // dates relative to today so "next7"/"upcoming" scopes are testable
  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3);   // within next 7 days
  const d5 = new Date(today); d5.setDate(d5.getDate() + 5);   // within next 7 days
  const d20 = new Date(today); d20.setDate(d20.getDate() + 20); // beyond week

  const addOrder = async (date, name, opts = {}) => {
    await page.click('[data-tab="form"]');
    await page.fill('[data-bind="date"]', date);
    await page.fill('[data-bind="name"]', name);
    if (opts.place) await page.fill('[data-bind="place"]', opts.place);
    for (const i of opts.saladsO || []) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="o"][data-d="1"]`);
    for (const i of opts.saladsP || []) await page.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-k="p"][data-d="1"]`);
    if (opts.total) await page.fill('[data-bind="total"]', String(opts.total));
    await page.click('[data-act="save"]');
  };

  // salad index 0 = כרוב לבן קלאסי
  await addOrder(iso(d3), 'קטי סוזנה', { place: 'גרנד הייאט', saladsO: [0, 0, 7], saladsP: [3], total: 230 }); // cabbage x2
  await addOrder(iso(d5), 'לילך בוארון', { place: 'אטלנטיס', saladsO: [0], total: 540 });
  await addOrder(iso(d20), 'ניר מסס', { saladsO: [0], total: 338 });

  // --- search ---
  assert(await page.locator('#searchIn').count() === 1, 'search box present');
  await page.fill('#searchIn', 'אטלנטיס');
  let cards = await page.locator('#ordersList .order-card').count();
  assert(cards === 1, 'search by hotel finds 1: got ' + cards);
  assert((await page.locator('#ordersList .oc-name').textContent()) === 'לילך בוארון', 'search result is Lilach');
  await page.fill('#searchIn', 'מטבוחה');
  cards = await page.locator('#ordersList .order-card').count();
  assert(cards === 1, 'search by salad name finds 1: got ' + cards);
  await page.fill('#searchIn', 'זזזז');
  assert((await page.locator('#ordersList').textContent()).includes('לא נמצאו'), 'no-results message');
  await page.click('[data-act="clearSearch"]');
  cards = await page.locator('#ordersList .order-card').count();
  assert(cards === 3, 'clear search shows all 3');

  // --- summary: default next7 aggregates 2 orders across 2 dates ---
  await page.click('[data-tab="summary"]');
  const selVal = await page.locator('select[data-bind="summaryDate"]').inputValue();
  assert(selVal === 'next7', 'default scope is next7: ' + selVal);
  let body = await page.locator('#view').textContent();
  assert(body.includes('השבוע הקרוב'), 'week title shown');
  assert(body.includes('ימי אספקה'), 'days stat shown for multi');
  // cabbage total = 2 (katy) + 1 (lilach) = 3, with per-date breakdown
  const rows = await page.locator('table.sum tr').allTextContents();
  const cab = rows.find(r => r.includes('כרוב לבן'));
  assert(cab && cab.includes('3'), 'cabbage aggregated to 3 for the week: ' + cab);
  const dd3 = String(d3.getDate()).padStart(2, '0') + '.' + String(d3.getMonth() + 1).padStart(2, '0');
  assert(cab.includes(dd3 + ': 2'), 'per-date breakdown shows ' + dd3 + ': 2 → ' + cab);
  // delivery board has date column
  assert(body.includes('יום') && body.includes('אטלנטיס'), 'delivery board with day column');
  // Nir excluded from week
  assert(!body.includes('ניר מסס'), 'order beyond 7 days excluded from week scope');

  // --- upcoming scope includes Nir ---
  await page.selectOption('select[data-bind="summaryDate"]', 'upcoming');
  body = await page.locator('#view').textContent();
  assert(body.includes('ניר מסס'), 'upcoming scope includes far order');
  assert(body.includes('כל ההזמנות הקרובות'), 'upcoming title');

  // --- single date scope still works ---
  await page.selectOption('select[data-bind="summaryDate"]', iso(d3));
  body = await page.locator('#view').textContent();
  assert(!body.includes('לילך'), 'single-date scope excludes other date');
  assert(body.includes('קטי'), 'single-date scope includes its order');

  // persistence after reload keeps search working
  await page.reload();
  await page.click('[data-tab="orders"]');
  await page.fill('#searchIn', 'קטי');
  assert(await page.locator('#ordersList .order-card').count() === 1, 'search works after reload');

  await page.click('[data-act="clearSearch"]');
  await page.screenshot({ path: 'shot-search.png', fullPage: false });
  await page.click('[data-tab="summary"]');
  await page.screenshot({ path: 'shot-week.png', fullPage: true });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
