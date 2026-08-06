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

  await page.goto('file://' + path.resolve(__dirname, '../index.html'));

  // --- demo data ---
  await page.click('[data-tab="backup"]');
  await page.click('[data-act="loadDemo"]');
  let body = await page.locator('#view').textContent();
  assert(body.includes('בוקר טוב') || body.includes('צהריים') || body.includes('ערב'), 'landed on today after demo load');
  await page.click('[data-tab="orders"]');
  assert(await page.locator('.order-card').count() === 4, 'four demo orders loaded');
  body = await page.locator('#view').textContent();
  assert(body.includes('קטי סוזנה') && body.includes('ניר מסס'), 'demo names present');

  // customers show VIP from meta
  await page.click('[data-tab="customers"]');
  const first = await page.locator('#custList .oc-name').first().textContent();
  assert(first.includes('⭐') && first.includes('קטי'), 'Katy VIP from demo meta');

  // --- money screen ---
  await page.click('[data-tab="money"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('הכנסות'), 'money screen renders');
  // month of fr1 has katy 390 + lilach 540 + haim 230 = 1160 (nir may be next month)
  assert(body.includes('נשאר ביד'), 'profit stat present');
  assert(body.includes('210'), 'demo expense 210 shown');
  assert(body.includes('הלקוחות הגדולים'), 'top customers card');
  // edit expense
  const expInput = page.locator('[data-bind="expense"]').first();
  await expInput.fill('300');
  await expInput.blur();
  await page.waitForTimeout(200);
  body = await page.locator('#view').textContent();
  assert(body.includes('300'), 'expense updated');

  // --- menu editor ---
  await page.click('[data-tab="backup"]');
  await page.fill('[data-bind="menu-num"][data-k="couplePrice"]', '250');
  // add a holiday dish to mains
  await page.locator('details', { hasText: '🍖 עיקריות' }).first().click();
  await page.fill('#menuAdd-mains', 'קציצות דגים לחג');
  await page.locator('[data-act="menuAdd"][data-cat="mains"]').click();
  body = await page.locator('#view').textContent();
  assert(body.includes('קציצות דגים לחג'), 'new dish added to menu');
  // new price + dish reflected in form
  await page.click('[data-tab="form"]');
  body = await page.locator('#view').textContent();
  assert(body.includes('250$'), 'form shows new couple price 250');
  assert(body.includes('קציצות דגים לחג'), 'new dish appears in order form');
  const hint0 = await page.locator('#priceHint').textContent();
  assert(hint0.includes('250'), 'price suggestion uses 250');
  await page.click('[data-act="cancel"]');
  // menu persists after reload
  await page.reload();
  await page.click('[data-tab="form"]');
  assert((await page.locator('#view').textContent()).includes('קציצות דגים לחג'), 'menu edit persisted');
  await page.click('[data-act="cancel"]');
  // reset menu
  await page.click('[data-tab="backup"]');
  page.once('dialog', d => d.accept());
  await page.click('[data-act="menuReset"]');
  await page.click('[data-tab="form"]');
  body = await page.locator('#view').textContent();
  assert(!body.includes('קציצות דגים לחג'), 'menu reset removed custom dish');
  assert(body.includes('230$'), 'price back to 230');
  await page.click('[data-act="cancel"]');

  // --- free-text import (the exact case she tested) ---
  await page.click('[data-tab="form"]');
  await page.click('summary');
  await page.fill('#importOrderText', 'אני רוצה ארוחה זוגית עם כל סוגי הסלטים ו10 חלות');
  await page.click('[data-act="importOrder"]');
  assert((await page.locator('[data-badge="salads"]').textContent()).includes('17'), 'free text: all 17 salads filled');
  const challotCell = await page.locator('[data-cell="challot|0"]').textContent();
  assert(challotCell === '10', 'free text: 10 challot: ' + challotCell);
  const notes = await page.locator('[data-bind="notes"]').inputValue();
  assert(notes.includes('הודעת הלקוח'), 'original message kept in notes');
  await page.click('[data-act="cancel"]');

  // richer free text
  await page.click('[data-tab="form"]');
  await page.click('summary');
  await page.fill('#importOrderText', 'היי! לשישי בבקשה: זוגית אחת, סלטים: טחינה, מטבוחה, כרוב סגול, חמוצים. 1 מרוקאי 1 חריימה לא חריף. עוף מרוקאי עם חומוסים, קוסקוס, סופלה. מלון גרנד הייאט 16:30, 054-2016970');
  await page.click('[data-act="importOrder"]');
  assert((await page.locator('[data-badge="salads"]').textContent()).includes('4/4'), 'free text: 4 salads matched');
  assert((await page.locator('[data-badge="firsts"]').textContent()).includes('2/2'), 'free text: both fish');
  assert(await page.locator('select[data-bind="heat"]').inputValue() === 'לא חריף', 'free text: heat');
  assert(await page.locator('[data-bind="phone"]').inputValue() === '054-2016970', 'free text: phone');
  assert(await page.locator('[data-bind="time"]').inputValue() === '16:30', 'free text: time');
  assert((await page.locator('[data-bind="place"]').inputValue()).includes('גרנד'), 'free text: hotel');
  assert(await page.locator('[data-bind="date"]').inputValue() !== '', 'free text: date set to next friday');
  await page.click('[data-act="cancel"]');

  // --- payment request button ---
  await page.click('[data-tab="backup"]');
  await page.fill('[data-bind="payLink"]', 'https://paybox.me/batmelech');
  await page.click('[data-tab="orders"]');
  const payBtn = page.locator('a', { hasText: 'בקשת תשלום' }).first();
  assert(await payBtn.count() === 1 || await page.locator('a:has-text("בקשת תשלום")').count() >= 1, 'payment request button on unpaid order');
  const payHref = await page.locator('a:has-text("בקשת תשלום")').first().getAttribute('href');
  const payTxt = decodeURIComponent(payHref.split('text=')[1]);
  assert(payTxt.includes('נשאר לתשלום') && payTxt.includes('paybox.me/batmelech'), 'payment message has amount + link');

  // --- promo message ---
  await page.click('[data-tab="backup"]');
  await page.fill('[data-bind="orderFormUrl"]', 'https://batmelech.pages.dev/order-form');
  await page.click('[data-tab="today"]');
  await page.evaluate(() => { window.__opened = null; window.open = u => { window.__opened = u; return null; }; });
  await page.click('[data-act="promoMsg"]');
  const promo = decodeURIComponent((await page.evaluate(() => window.__opened)).split('text=')[1]);
  assert(promo.includes('מטעמי בת מלך') && promo.includes('שבת'), 'promo header');
  assert(promo.includes('230$'), 'promo price');
  assert(promo.includes('נשארו רק') || promo.includes('מלאה'), 'promo scarcity from capacity');
  assert(promo.includes('batmelech.pages.dev'), 'promo has order link');

  // --- clear demo ---
  await page.click('[data-tab="backup"]');
  await page.click('[data-act="clearDemo"]');
  await page.click('[data-tab="orders"]');
  assert(await page.locator('.order-card').count() === 0, 'demo cleared');

  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log(' -', e)); process.exit(1); }
  console.log('\nALL TESTS PASSED');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
