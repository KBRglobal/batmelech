const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errors = [];
  const assert = (cond, msg) => { if (!cond) { errors.push('ASSERT FAIL: ' + msg); } else console.log('ok:', msg); };

  // ---- customer form page ----
  const cust = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await cust.addInitScript(() => { try { if (!localStorage.getItem('batmelech-orders-v1')) localStorage.setItem('batmelech-orders-v1', '{"orders":[]}'); } catch (e) {} });
  cust.on('pageerror', e => errors.push('CUST PAGEERROR: ' + e.message));
  cust.on('console', m => { if (m.type() === 'error') errors.push('CUST CONSOLE: ' + m.text()); });
  await cust.goto('file://' + path.resolve(__dirname, '../order-form.html'));

  const today = new Date();
  const d3 = new Date(today); d3.setDate(d3.getDate() + 3);
  const iso = d => d.toISOString().slice(0, 10);

  await cust.fill('[data-bind="date"]', iso(d3));
  await cust.fill('[data-bind="name"]', 'לילך בוארון');
  await cust.fill('[data-bind="phone"]', '050-4448731');
  await cust.fill('[data-bind="place"]', 'אטלנטיס דה פאלם');
  await cust.fill('[data-bind="time"]', '15:00');
  await cust.fill('[data-bind="address"]', 'לובי מזרחי');
  // salads: 4 (indexes 3,6,7,0)
  for (const i of [0, 3, 6, 7]) await cust.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-d="1"]`);
  assert((await cust.locator('#saladBadge').textContent()) === '4/4 כלולים', 'salad badge 4/4');
  // firsts: 1+1, heat
  await cust.click('[data-act="bump"][data-group="firsts"][data-i="0"][data-d="1"]');
  await cust.click('[data-act="bump"][data-group="firsts"][data-i="1"][data-d="1"]');
  await cust.selectOption('[data-bind="heat"]', 'לא חריף');
  // main + side + dessert
  await cust.click('[data-act="bump"][data-group="mains"][data-i="4"][data-d="1"]');
  await cust.click('[data-act="bump"][data-group="sides"][data-i="0"][data-d="1"]');
  await cust.click('[data-act="bump"][data-group="desserts"][data-i="0"][data-d="1"]');
  // extra: kids meal (index 13 in EXTRAS on customer page) with note
  await cust.click('[data-act="bump"][data-group="extras"][data-i="12"][data-d="1"]');
  await cust.fill('[data-note-cell="extras|12"]', 'בלי רוטב');
  await cust.fill('[data-bind="notes"]', 'אלרגיה לאגוזים');
  // challot 2 default; estimate = 230 + 35 + 15 delivery = 280
  assert((await cust.locator('#totalEst').textContent()).includes('280'), 'customer estimate 280 incl delivery');
  let bd = await cust.locator('#priceBreakdown').textContent();
  assert(bd.includes('משלוח ברחבי דובאי') && bd.includes('15$'), 'breakdown shows delivery line');
  assert(bd.includes('280$'), 'breakdown total 280');
  assert(!bd.includes('סלטים נוספים'), 'no salad surcharge at 4/4');
  // add 2 extra salads -> +25$ block
  for (const i of [1, 2]) await cust.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-d="1"]`);
  bd = await cust.locator('#priceBreakdown').textContent();
  assert(bd.includes('סלטים נוספים (2 מעבר לכלול)') && bd.includes('305$'), 'salad surcharge auto-added: total 305');
  // remove them back
  for (const i of [1, 2]) await cust.click(`[data-act="bump"][data-group="salads"][data-i="${i}"][data-d="-1"]`);
  // pickup removes delivery fee
  await cust.check('[data-bind="pickup"]');
  assert((await cust.locator('#totalEst').textContent()).includes('265'), 'pickup drops delivery: 265');
  await cust.uncheck('[data-bind="pickup"]');
  assert((await cust.locator('#totalEst').textContent()).includes('280'), 'delivery back on uncheck');
  const href = await cust.locator('#waSend').getAttribute('href');
  assert(href.startsWith('https://wa.me/971586288776?text='), 'wa link targets business number');
  const text = decodeURIComponent(href.split('text=')[1]);
  assert(text.includes('לילך בוארון') && text.includes('#BM1#'), 'wa text has name + code');
  assert(text.includes('פירוט מחיר') && text.includes('סה"כ משוער: 280$'), 'wa text has itemized price');

  // ---- paste into the manager app ----
  const app = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await app.addInitScript(() => { try { if (!localStorage.getItem('batmelech-orders-v1')) localStorage.setItem('batmelech-orders-v1', '{"orders":[]}'); } catch (e) {} });
  app.on('pageerror', e => errors.push('APP PAGEERROR: ' + e.message));
  app.on('console', m => { if (m.type() === 'error') errors.push('APP CONSOLE: ' + m.text()); });
  await app.goto('file://' + path.resolve(__dirname, '../index.html'));
  await app.click('[data-tab="form"]');
  await app.click('summary'); // open import details
  await app.fill('#importOrderText', text);
  await app.click('[data-act="importOrder"]');
  assert(await app.locator('[data-bind="name"]').inputValue() === 'לילך בוארון', 'import filled name');
  assert(await app.locator('[data-bind="date"]').inputValue() === iso(d3), 'import filled date');
  assert(await app.locator('[data-bind="place"]').inputValue() === 'אטלנטיס דה פאלם', 'import filled hotel');
  assert(await app.locator('[data-bind="address"]').inputValue() === 'לובי מזרחי', 'import filled address');
  assert((await app.locator('[data-badge="salads"]').textContent()).includes('4/4'), 'import filled 4 salads');
  assert((await app.locator('[data-badge="firsts"]').textContent()).includes('2/2'), 'import filled 2 fish');
  const heat = await app.locator('select[data-bind="heat"]').inputValue();
  assert(heat === 'לא חריף', 'import filled heat');
  const hint = await app.locator('#priceHint').textContent();
  assert(hint.includes('280'), 'imported order suggests 280 incl delivery: ' + hint.trim().slice(0, 140));
  assert(hint.includes('משלוח'), 'delivery carried into manager suggestion');
  await app.click('[data-act="save"]');
  assert(await app.locator('.order-card').count() === 1, 'imported order saved');
  const cardTxt = await app.locator('.order-card').textContent();
  assert(cardTxt.includes('לילך בוארון'), 'saved card has customer name');

  // bad paste
  await app.click('[data-tab="form"]');
  await app.click('summary');
  await app.fill('#importOrderText', 'סתם טקסט בלי קוד');
  await app.click('[data-act="importOrder"]');
  assert((await app.locator('[data-bind="name"]').inputValue()) === '', 'bad code does not fill form');

  // ---- customers tab ----
  // add second order for same phone
  await app.fill('[data-bind="date"]', iso(d3));
  await app.fill('[data-bind="name"]', 'לילך בוארון');
  await app.fill('[data-bind="phone"]', '050-4448731');
  await app.fill('[data-bind="total"]', '540');
  await app.click('[data-act="save"]');
  // and a different customer
  await app.click('[data-tab="form"]');
  await app.fill('[data-bind="date"]', iso(d3));
  await app.fill('[data-bind="name"]', 'קטי סוזנה');
  await app.fill('[data-bind="phone"]', '054-2016970');
  await app.click('[data-act="save"]');

  await app.click('[data-tab="customers"]');
  const cardCount = await app.locator('#custList .order-card').count();
  assert(cardCount === 2, 'two customers grouped by phone: got ' + cardCount);
  const lilach = await app.locator('#custList .order-card', { hasText: 'לילך' }).first().textContent();
  assert(lilach.includes('2 הזמנות'), 'Lilach has 2 orders grouped');
  assert(lilach.includes('540'), 'customer total spent shown');
  // search
  await app.fill('#custSearchIn', 'קטי');
  assert(await app.locator('#custList .order-card').count() === 1, 'customer search filters');
  await app.fill('#custSearchIn', '');
  // repeat order button prefills form
  await app.locator('#custList .order-card', { hasText: 'קטי' }).locator('[data-act="dup"]').click();
  assert(await app.locator('[data-bind="name"]').inputValue() === 'קטי סוזנה', 'repeat-order prefills from last order');

  await app.click('[data-tab="customers"]');
  await app.screenshot({ path: 'shot-customers.png', fullPage: true });
  await cust.screenshot({ path: 'shot-orderform.png', fullPage: false });

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
