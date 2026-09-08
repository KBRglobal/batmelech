const {chromium,webkit,firefox}=require('../../tests/node_modules/playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const origin='http://127.0.0.1:4186';
const folder='tasks/rosh-hashanah/evidence';
const sizes=[[320,568],[360,800],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1280,800],[1366,768],[1440,900],[1920,1080]];
const routes=['/','/weekdays','/shabbat-order','/shabbat-extras','/story','/legal','/kashrut','/gallery','/events','/how-it-works','/experiences/bbq','/experiences/yacht','/experiences/villa','/experiences/suite','/experiences/desert'];
const report={layouts:[],journeys:[],routes:[],errors:[],browserVersions:{}};
async function layout(page,label){
 const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length,broken:Array.from(document.images).filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src),navClipped:[...document.querySelectorAll('nav')].some(n=>n.scrollWidth>n.clientWidth+1)}));
 assert.ok(result.scroll<=result.width+1,`${label}: overflow ${JSON.stringify(result)}`);
 assert.equal(result.h1,1,`${label}: one H1`);
 assert.equal(result.navClipped,false,`${label}: visible navigation`);
 assert.deepEqual(result.broken,[],`${label}: assets`);
 return {label,...result};
}
async function journey(browser,locale){
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:locale==='he'?'he-IL':locale});
 // Capture the existing WhatsApp handoff locally, without opening/sending anything.
 await context.addInitScript(()=>{window.open=(url)=>{window.__qaHandoff=url;return null}});
 const p=await context.newPage();p.on('pageerror',e=>report.errors.push(String(e)));
 const prefix=locale==='he'?'':`/${locale}`;
 await p.goto(origin+prefix+'/rosh-hashanah',{waitUntil:'networkidle'});
 assert.equal(await p.locator('.festive-add-button').isDisabled(),true);
 await p.locator('input[value="family"]').check();
 const {catalog}=await import('../../shared/rosh-hashanah.mjs');
 const fill=async(name,n)=>p.getByRole('spinbutton',{name,exact:true}).fill(String(n));
 await fill(catalog.fish[2].name[locale],9007199254740991);
 assert.equal(await p.locator('h1').count(),1,'extreme quantity cannot crash the builder');
 await p.getByRole('alert').waitFor();
 await fill(catalog.fish[2].name[locale],1);
 await fill(catalog.fish[0].name[locale],1);
 await fill(catalog.mains[0].name[locale],1);
 await fill(catalog.sides[0].name[locale],1);
 const kid=locale==='he'?'ילד':locale==='fr'?'Enfant':'Child';
 await fill(`${kid} 1: ${catalog.childSides[0].name[locale]}`,1);
 await fill(`${kid} 1: ${catalog.childSides[1].name[locale]}`,1);
 assert.equal(await p.locator('.festive-add-button').isDisabled(),true,'child two must select own side');
 await fill(`${kid} 2: ${catalog.childSides[0].name[locale]}`,1);
 await p.locator('.festive-secondary-button').click();
 assert.equal(await p.locator('.festive-add-button').isDisabled(),true,'extra child must select a side');
 await fill(`${kid} 3: ${catalog.childSides[2].name[locale]}`,1);
 await fill(locale==='he'?'מארזי ריבות':locale==='fr'?'Coffrets de confitures':'Jam sets',1000000);
 assert.equal(await p.getByTestId('festive-total').innerText(),'$544');
 await p.reload({waitUntil:'networkidle'});
 assert.equal(await p.getByTestId('festive-total').innerText(),'$544','draft survives reload');
 await p.locator('.festive-add-button').click();
 await p.waitForURL('**/checkout');
 const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('bm-cart-v1')));
 assert.equal(saved.length,1);assert.equal(saved[0].unitPrice,544);assert.equal(saved[0].festive.children.length,3);assert.equal(saved[0].festive.jam,1000000);
 const expected=locale==='he'?'ילד 3:':locale==='fr'?'Enfant 3 :':'Child 3:';
 await p.getByText(expected, {exact:false}).first().waitFor();
 assert.ok((await p.locator('main').innerText()).includes(expected),'localized children in checkout');
 await p.getByRole('button',{name:locale==='he'?/^איסוף עצמי/:locale==='fr'?/Retrait/:/Pick.?up/i}).click();
 await p.locator('main input[type="text"]').first().fill('Local QA');
 await p.locator('main input[type="tel"]').fill('500000000');
 await p.locator('main input[type="date"]').fill('2026-09-10');
 await p.locator('main input[type="time"]').fill('12:00');
 // Exercise error state before successful local intake.
 const submit= p.getByRole('button',{name:locale==='he'?'אישור ושליחת הזמנה':locale==='fr'?'Confirmer et envoyer la commande':'Confirm & Send Order',exact:true});
 await p.route('**/api/site/orders',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"preview failure"}'}));
 await submit.click();await p.waitForTimeout(100);
 assert.ok(await submit.isVisible());assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('bm-cart-v1')).length),1);
 await p.unroute('**/api/site/orders');
 const response=p.waitForResponse(r=>r.url().endsWith('/api/site/orders')&&r.request().method()==='POST');
 await submit.click();assert.equal((await response).status(),201);
 const orders=await (await p.request.get(origin+'/__qa/orders')).json();const order=orders.at(-1);
 assert.equal(order.total,544);assert.match(order.notes,/צלחת ברכות × 1/);assert.match(order.notes,/ילד 3: שניצלונים/);assert.equal(order.festivePackages[0].selection.children.length,3);
 report.journeys.push({locale,total:order.total,children:3,freeJam:1000000,failureRetainsCart:true,persistedLocally:true});
 await context.close();
}
(async()=>{
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]]){
  const browser=await engine.launch();report.browserVersions[name]=browser.version();
  for(const locale of ['he','en','fr']){
   const context=await browser.newContext({locale:locale==='he'?'he-IL':locale,reducedMotion:'reduce'});const p=await context.newPage();p.on('pageerror',e=>report.errors.push(`${name}/${locale}: ${e}`));
   const prefix=locale==='he'?'':`/${locale}`;
   await p.goto(origin+prefix+'/rosh-hashanah',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);
   assert.ok((await p.title()).includes(locale==='he'?'ראש השנה':locale==='fr'?'Roch Hachana':'Rosh Hashanah'));
   assert.equal(await p.locator('link[rel="canonical"]').getAttribute('href'),'https://www.batmelech.ae'+prefix+'/rosh-hashanah');
   assert.equal(await p.locator('link[rel="alternate"][hreflang]').count(),4);
   for(const [width,height]of sizes){await p.setViewportSize({width,height});report.layouts.push(await layout(p,`${name}/${locale}/${width}`));}
   if(name==='chromium'){
    await p.setViewportSize({width:1440,height:900});await p.screenshot({path:`${folder}/${locale}-desktop.png`,fullPage:true});
    if(locale==='he'){await p.screenshot({path:`${folder}/desktop.png`,fullPage:true});await p.locator('.festive-intro').scrollIntoViewIfNeeded();await p.screenshot({path:`${folder}/desktop-detail.png`});}
    await p.setViewportSize({width:390,height:844});await p.screenshot({path:`${folder}/${locale}-mobile.png`,fullPage:true});
    if(locale==='he'){await p.screenshot({path:`${folder}/mobile.png`,fullPage:true});await p.locator('.festive-section').nth(2).scrollIntoViewIfNeeded();await p.screenshot({path:`${folder}/mobile-detail.png`});}
    // Fixed content has no substitute selectors, free jams have no business max.
    assert.equal(await p.locator('.festive-section').first().locator('input').count(),0);
    assert.equal(await p.locator('.festive-section').nth(1).locator('input').count(),1);
    assert.equal(await p.locator('.festive-section').nth(6).locator('input').getAttribute('max'),null);
    await p.locator('input[value="four"]').check();assert.equal(await p.getByTestId('festive-total').innerText(),'$650');assert.equal(await p.locator('.festive-child').count(),0);
    await p.locator('input[value="family"]').check();assert.equal(await p.locator('.festive-child').count(),2);
    await p.locator('input[value="couple"]').check();assert.equal(await p.locator('.festive-child').count(),0);
    await p.keyboard.press('Tab');assert.notEqual(await p.evaluate(()=>document.activeElement.tagName),'BODY');
   }
   // Every existing public route retains a working heading/navigation at desktop and mobile.
   for(const route of routes){await p.goto(origin+prefix+route,{waitUntil:'domcontentloaded'});await p.locator('h1').waitFor();for(const width of [390,1440]){await p.setViewportSize({width,height:900});report.routes.push(await layout(p,`${name}/${locale}${route}/${width}`));}}
   await p.goto(origin+prefix+'/does-not-exist',{waitUntil:'domcontentloaded'});assert.ok(await p.locator('h1').count());
   await context.close();
  }
  await journey(browser,'he');
  if(name==='chromium'){await journey(browser,'en');await journey(browser,'fr');}
  await browser.close();console.log(`${name}: layouts, existing routes and checkout verified`);
 }
 assert.deepEqual(report.errors,[]);
 fs.writeFileSync(`${folder}/browser.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({layouts:report.layouts.length,routes:report.routes.length,journeys:report.journeys.length,errors:report.errors.length}));
})().catch(e=>{fs.writeFileSync(`${folder}/browser-failure.json`,JSON.stringify({...report,failure:String(e)},null,2));console.error(e);process.exit(1)});
