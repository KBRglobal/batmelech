const {chromium}=require('../../tests/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),origin='https://www.batmelech.ae';
async function run(){
 const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const report={public:[],admin:{},errors:[],productionOrderWrites:0};
 try{
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await context.route('**/api/**',async route=>{const req=route.request();if(req.method()!=='GET'&&!req.url().includes('/api/site/access')){report.productionOrderWrites++;await route.abort();return}await route.continue()});
  for(const locale of ['','/en','/fr']){
   const r=await page.goto(origin+locale+'/rosh-hashanah');assert.equal(r.status(),200);await page.getByRole('heading',{level:1}).waitFor();const text=await page.locator('body').innerText();for(const price of ['350','450','650'])assert.ok(text.includes(price));
   const script=await page.locator('script[type="module"]').getAttribute('src');assert.ok(fs.readFileSync(path.join(root,'site/index.html'),'utf8').includes(script));
   assert.equal(await page.locator('footer a[href="https://kbr.global"]').count(),1);assert.equal(await page.locator('footer a[href$="#accessibility"]').count(),1);
   report.public.push({locale:locale||'he',status:r.status(),script,prices:[350,450,650]});
  }
  for(const route of ['/weekdays','/shabbat-order','/legal#accessibility']){const r=await page.goto(origin+route);assert.equal(r.status(),200);await page.getByRole('heading',{level:1}).waitFor();report.public.push({route,status:r.status()})}
  // Credentials stay in memory and are used only at the existing staff login endpoint.
  const vars=JSON.parse(cp.execFileSync('railway',['variables','--json','--service','app'],{cwd:root,encoding:'utf8'}));assert.ok(vars.BM_USER&&vars.BM_PASS);
  for(const message of [vars.BM_USER,vars.BM_PASS]){const r=await context.request.post(origin+'/api/site/access',{data:{message}});assert.equal(r.status(),200)}
  const liveState=await context.request.get(origin+'/api/state');assert.equal(liveState.status(),200);const env=await liveState.json();assert.ok(Array.isArray(env.data.orders));assert.ok(Number.isSafeInteger(env.revision));report.admin.authenticated=true;
  // Actual authenticated production shell/assets, with empty local fixture for a private unsaved QA draft.
  await page.route('**/api/state',route=>route.fulfill({json:{...env,data:{...env.data,orders:[]}}}));
  await page.goto(origin+'/app/orders/new');await page.getByTestId('festive-editor').waitFor();
  const adminScript=await page.locator('script[type="module"]').getAttribute('src');assert.ok(fs.readFileSync(path.join(root,'web/dist/index.html'),'utf8').includes(adminScript));report.admin.script=adminScript;
  await page.getByRole('checkbox',{name:'איסוף עצמי',exact:true}).check();await page.getByRole('button',{name:'הוספת ארוחה זוגית · $350',exact:true}).click();const box=page.getByTestId('festive-package-0');
  await box.getByLabel('קציצות דגים ברוטב מרוקאי',{exact:true}).fill('1');await box.getByLabel('קציצות בקר ברוטב אפונה וארטישוק',{exact:true}).fill('1');await box.getByLabel('אורז לבן קלאסי',{exact:true}).fill('1');
  await page.waitForFunction(()=>document.querySelector('[aria-label="סך לתשלום"]').value==='350.00');
  await box.getByLabel('דג ברוטב מרוקאי',{exact:true}).fill('1');await page.waitForFunction(()=>document.querySelector('[aria-label="סך לתשלום"]').value==='380.00');
  report.admin.prices={included:350,extraFish:380};report.admin.saved=false;
  await page.goto(origin+'/app/settings/menu');await page.getByRole('heading',{name:'תפריט חגיגי לראש השנה',exact:true}).waitFor();report.admin.catalogVisible=true;
  assert.equal(report.productionOrderWrites,0);assert.deepEqual(report.errors,[]);
  fs.writeFileSync(path.join(__dirname,'evidence/live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e.message);process.exit(1)});
