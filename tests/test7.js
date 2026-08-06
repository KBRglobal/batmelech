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
  const iso = d => d.toISOString().slice(0, 10);
  const d3 = new Date(); d3.setDate(d3.getDate() + 3);

  const addOrder = async (name, opts = {}) => {
    await page.click('[data-tab="form"]');
    await page.fill('[data-bind="date"]', iso(d3));
    await page.fill('[data-bind="name"]', name);
    if (opts.phone) await page.fill('[data-bind="phone"]', opts.phone);
    if (opts.place) await page.fill('[data-bind="place"]', opts.place);
    if (opts.time) await page.fill('[data-bind="time"]', opts.time);
    if (opts.total) await page.fill('[data-bind="total"]', String(opts.total));
    if (opts.status) await page.selectOption('[data-bind="status"]', opts.status);
    await page.click('[data-act="save"]');
  };

  await addOrder('קטי סוזנה', { phone: '054-2016970', place: 'גרנד הייאט', time: '14:00', total: 230, status: 'אושרה' });
  await addOrder('לילך בוארון', { phone: '050-4448731', place: 'אטלנטיס', time: '16:00', total: 540 });
  await addOrder('ניר מסס', { total: 338, status: 'בוטלה' });

  // cancelled excluded from date header totals (230+540=770, not 1108) and dimmed
  const dh = await page.locator('.date-h').first().textContent();
  assert(dh.includes('770'), 'cancelled excluded from header total: ' + dh.trim().slice(0, 90));
  assert(dh.includes('2 זוגיות'), 'cancelled meals excluded from load');
  assert(await page.locator('.order-card.cancelled').count() === 1, 'cancelled card dimmed');

  // cancelled excluded from prep summary
  await page.click(`[data-act="daySummary"][data-date="${iso(d3)}"]`);
  let body = await page.locator('#view').textContent();
  assert(!body.includes('ניר מסס'), 'cancelled order not in summary');
  assert(body.includes('770'), 'summary revenue excludes cancelled');

  // driver route button copies + builds text
  await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; });
  await page.click('[data-act="sendRoute"]');
  const opened = await page.evaluate(() => window.__opened);
  assert(opened && opened.startsWith('https://wa.me/?text='), 'route opens wa.me share');
  const routeTxt = decodeURIComponent(opened.split('text=')[1]);
  assert(routeTxt.includes('מסלול משלוחים'), 'route title');
  assert(routeTxt.includes('1. 14:00 — קטי סוזנה — גרנד הייאט'), 'route stop 1 ordered by time');
  assert(routeTxt.includes('google.com/maps'), 'route has nav links');
  assert(routeTxt.includes('לגבות: 540$'), 'route shows amount to collect');
  assert(!routeTxt.includes('ניר'), 'cancelled not in route');

  // out-of-stock chips
  await page.click('[data-tab="backup"]');
  const chips = await page.locator('[data-act="toggleOut"]').count();
  assert(chips === 36, 'stock chips for all menu items: ' + chips);
  await page.locator('[data-act="toggleOut"][data-i="7"]').click(); // טחינה
  assert(await page.locator('[data-act="toggleOut"].on').count() === 1, 'chip toggled on');
  await page.click('[data-tab="form"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('אזל'), 'form shows out-of-stock mark');
  await page.click('[data-act="cancel"]');

  // customers: VIP + note
  await page.click('[data-tab="customers"]');
  assert(await page.locator('#custList .order-card').count() === 3, 'three customers');
  await page.locator('#custList .order-card', { hasText: 'קטי' }).locator('[data-act="custVip"]').click();
  // VIP sorts first + star shown
  const firstName = await page.locator('#custList .oc-name').first().textContent();
  assert(firstName.includes('⭐') && firstName.includes('קטי'), 'VIP starred and sorted first: ' + firstName);
  await page.locator('#custList .order-card', { hasText: 'קטי' }).locator('[data-bind="custNote"]').fill('אלרגיה לאגוזים');
  // search by note text
  await page.fill('#custSearchIn', 'אגוזים');
  assert(await page.locator('#custList .order-card').count() === 1, 'search finds customer by note');
  // persistence
  await page.reload();
  await page.click('[data-tab="customers"]');
  const noteVal = await page.locator('#custList .order-card', { hasText: 'קטי' }).locator('[data-bind="custNote"]').inputValue();
  assert(noteVal === 'אלרגיה לאגוזים', 'customer note persisted');
  assert((await page.locator('#custList .oc-name').first().textContent()).includes('⭐'), 'VIP persisted');

  // customer form datalists
  const cust = await browser.newPage({ viewport: { width: 420, height: 900 } });
  cust.on('pageerror', e => errors.push('CUST PAGEERROR: ' + e.message));
  await cust.goto('file://' + path.resolve(__dirname, '../order-form.html'));
  assert(await cust.locator('#hotelsDl option').count() >= 10, 'hotel suggestions present');
  assert(await cust.locator('#timesDl option').count() >= 6, 'time suggestions present');

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
