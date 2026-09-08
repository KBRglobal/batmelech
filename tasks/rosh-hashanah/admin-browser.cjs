const express=require('express');
const {chromium,webkit}=require('../../tests/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
async function run(){
 const app=express();app.use(express.json());let state={orders:[]},revision=1;
 const envelope=()=>({data:state,revision,ts:revision,hash:String(revision).repeat(64).slice(0,64)});
 app.get('/api/state',(_,res)=>res.json(envelope()));
 app.post('/api/state',(req,res)=>{assert.equal(req.body.baseRevision,revision);state=req.body.localState;revision++;res.json({ok:true,idempotent:false,...envelope()})});
 app.get('/api/*',(_,res)=>res.json({}));
 app.use('/app',express.static(path.join(root,'web/dist')));app.get('/app/*',(_,res)=>res.sendFile(path.join(root,'web/dist/index.html')));
 app.use('/site',express.static(path.join(root,'site')));app.get('*',(_,res)=>res.sendFile(path.join(root,'site/index.html')));
 const server=await new Promise(resolve=>{const s=app.listen(4187,'127.0.0.1',()=>resolve(s))});
 const report={cases:[],errors:[]};
 const totalIs=async(page,value)=>{await page.waitForFunction(value=>document.querySelector('[aria-label="סך לתשלום"]').value===value,value);assert.equal(await page.getByLabel('סך לתשלום',{exact:true}).inputValue(),value)};
 try {for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]){
  state={orders:[]};revision=1;
  const browser=await engine.launch();try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
   await page.goto('http://127.0.0.1:4187/app/orders/new');
   await page.getByLabel('שם מלא',{exact:true}).fill('Festive QA');await page.getByRole('checkbox',{name:'איסוף עצמי',exact:true}).check();
   await page.getByRole('button',{name:'הוספת מארז משפחתי · $450',exact:true}).click();
   const box=page.getByTestId('festive-package-0');
   await box.getByLabel('קציצות דגים ברוטב מרוקאי',{exact:true}).fill('1');
   await box.getByLabel('קציצות בקר ברוטב אפונה וארטישוק',{exact:true}).fill('1');
   await box.getByLabel('אורז לבן קלאסי',{exact:true}).fill('1');
   await box.getByLabel('ילד 1 — אורז',{exact:true}).fill('1');await box.getByLabel('ילד 2 — אורז',{exact:true}).fill('1');
   await totalIs(page,'450.00');
   await box.getByLabel(/מארזי סלטים/).fill('2');await box.getByLabel('דג ברוטב מרוקאי',{exact:true}).fill('1');await box.getByLabel('קציצות בקר ברוטב עגבניות',{exact:true}).fill('1');await box.getByLabel('אורז זהוב עם זעפרן',{exact:true}).fill('1');await box.getByLabel(/חלות —/).fill('3');await box.getByLabel('מארזי ריבות',{exact:true}).fill('999999');await box.getByLabel('ילד 1 — פסטה אדומה',{exact:true}).fill('1');await box.getByRole('button',{name:'הוספת ילד · $49',exact:true}).click();await box.getByLabel('ילד 3 — אורז',{exact:true}).fill('1');
   await totalIs(page,'739.00');
   await page.getByRole('button',{name:/שמירת ההזמנה|שמירת השינויים/}).click();await page.waitForURL('**/app/orders');assert.equal(state.orders.length,1);const saved=state.orders[0];assert.equal(saved.meals,0);assert.equal(saved.challot,0);assert.equal(Number(saved.total),739);assert.match(saved.notes,/\[ROSH_HASHANAH\]/);
   await page.goto(`http://127.0.0.1:4187/app/orders/${saved.id}/edit`);await page.getByTestId('festive-package-0').waitFor();
   await totalIs(page,'739.00');
   await page.getByRole('checkbox',{name:'איסוף עצמי',exact:true}).uncheck();
   await totalIs(page,'754.00');
   await page.getByRole('checkbox',{name:'איסוף עצמי',exact:true}).check();
   await page.getByTestId('festive-package-0').getByLabel(/חלות —/).fill('4');
   await totalIs(page,'749.00');
   await page.getByRole('button',{name:/שמירת ההזמנה|שמירת השינויים/}).click();await page.waitForURL('**/app/orders');assert.equal(Number(state.orders[0].total),749);assert.match(state.orders[0].notes,/חלות × 4/);assert.doesNotMatch(state.orders[0].notes,/חלות × 3/);
   await page.goto(`http://127.0.0.1:4187/app/orders/${saved.id}/edit`);await page.getByLabel('סך לתשלום',{exact:true}).fill('700.00');await page.getByTestId('festive-package-0').getByLabel(/חלות —/).fill('5');await totalIs(page,'700.00');
   // Persisted override remains fixed even when a selection temporarily matches it.
   state.orders[0].total='739.00';state.orders[0].festivePackages[0].selection.challah=4;revision++;
   await page.goto(`http://127.0.0.1:4187/app/orders/${saved.id}/edit`);await page.getByTestId('festive-package-0').waitFor();
   await page.getByTestId('festive-package-0').getByLabel(/חלות —/).fill('3');await totalIs(page,'739.00');
   await page.getByTestId('festive-package-0').getByLabel(/חלות —/).fill('4');await totalIs(page,'739.00');
   await page.setViewportSize({width:390,height:844});await page.getByTestId('festive-editor').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(name==='chromium')await page.screenshot({path:path.join(__dirname,'evidence/admin-festive.png')});
   report.cases.push({browser:name,base:450,extras:289,saved:739,reopened:739,delivery:754,edited:749,manualOverride:700,persistedOverrideAfterMatchingPrice:739,mobileOverflow:false});
   await page.goto('http://127.0.0.1:4187/rosh-hashanah');await page.getByRole('heading',{level:1}).waitFor();assert.ok((await page.locator('body').innerText()).includes('350'));assert.equal(await page.locator('footer a[href="https://kbr.global"]').count(),1);
  }finally{await browser.close()}
 }
 assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(__dirname,'evidence/admin-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{server.close()}
}
run().catch(e=>{console.error(e);process.exit(1)});
