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

  // nav has all 7 destinations
  assert(await page.locator('#tabs .bn-item').count() === 8, 'nav has 8 items');
  assert(await page.locator('.bn-item.active').first().textContent().then(t => t.includes('היום')), 'today active by default');

  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(); d3.setDate(d3.getDate() + 3);

  // form: jump chips work, nav stays visible (web-system style)
  await page.click('[data-tab="form"]');
  assert(await page.locator('#tabs').isVisible(), 'nav visible during form');
  assert(await page.locator('.jump .btn').count() === 9, 'nine jump chips');
  await page.click('[data-act="jump"][data-target="sec-pay"]');
  await page.waitForTimeout(600);
  const payVisible = await page.locator('#sec-pay').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight;
  });
  assert(payVisible, 'jump scrolls to payment section');

  // create orders: one delivery with time, one pickup
  await page.click('[data-act="jump"][data-target="sec-details"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'קטי סוזנה');
  await page.fill('[data-bind="phone"]', '054-2016970');
  await page.fill('[data-bind="place"]', 'גרנד הייאט');
  await page.fill('[data-bind="time"]', '14:00');
  await page.fill('[data-bind="total"]', '230');
  await page.click('[data-act="save"]');

  await page.click('[data-tab="form"]');
  await page.fill('[data-bind="date"]', iso(d3));
  await page.fill('[data-bind="name"]', 'חיים הלוי');
  await page.check('[data-bind="pickup"]');
  await page.fill('[data-bind="total"]', '30');
  await page.click('[data-act="save"]');

  // delivery tab
  await page.click('[data-tab="delivery"]');
  let body = await page.locator('#view').textContent();
  assert(body.includes('🚚 משלוחים —'), 'delivery screen title');
  assert(body.includes('לגבות בדרך'), 'collect-on-route stat');
  assert(body.includes('260'), 'collect total 260 (230+30)');
  assert(await page.locator('[data-act="sendRoute"]').count() === 1, 'send route button on delivery tab');
  assert(body.includes('איסוף עצמי (1)'), 'pickup section');
  assert((await page.locator('a[href*="google.com/maps"]').count()) >= 1, 'nav button per stop');
  // stop numbered
  assert((await page.locator('#view .order-card').first().textContent()).includes('14:00'), 'stop shows time');

  // settings screen via gear icon
  await page.click('[data-tab="backup"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('הגדרות וגיבוי'), 'settings screen title');
  const secOrder = await page.locator('#view .sec-h').allTextContents();
  assert(secOrder[0].includes('תקרת עומס') && secOrder.some(s=>s.includes('אזל')) && secOrder.some(s=>s.includes('גיבוי')), 'settings sections present: ' + secOrder.join('|'));

  // customers via top icon
  await page.click('[data-tab="customers"]');
  assert(await page.locator('#custList .order-card').count() === 2, 'customers screen via nav');

  await page.click('[data-tab="delivery"]');
  await page.screenshot({ path: 'shot-delivery.png', fullPage: true });
  await page.click('[data-tab="today"]');
  await page.screenshot({ path: 'shot-nav.png', fullPage: false });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
