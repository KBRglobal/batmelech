const {chromium}=require('../../tests/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const base='https://www.batmelech.ae',folder='tasks/rosh-hashanah/evidence';
async function run(){
 const report={pages:[],errors:[],writes:0};const browser=await chromium.launch();
 try{
  const context=await browser.newContext({locale:'he-IL'});await context.route('**/api/**',async route=>{if(route.request().method()!=='GET'){report.writes++;return route.abort()}return route.continue()});
  const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
  for(const width of [390,1440])for(const locale of ['','/en','/fr'])for(const route of ['/','/rosh-hashanah','/weekdays','/shabbat-order','/shabbat-extras']){
   await p.setViewportSize({width,height:900});const url=base+locale+route;const response=await p.goto(url);assert.equal(response.status(),200,url);await p.locator('h1').waitFor();
   await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.decode().catch(()=>{})))});
   const data=await p.evaluate(()=>({language:document.documentElement.lang,overflow:document.documentElement.scrollWidth>innerWidth+1,h1:document.querySelectorAll('h1').length,nav:[...document.querySelectorAll('nav')].map(n=>({clipped:n.scrollWidth>n.clientWidth+1,links:[...n.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))})),broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute('src')),holidayBuilders:document.querySelectorAll('.festive-add-button').length}));
   assert.equal(data.language,locale.slice(1)||'he',url);assert.equal(data.overflow,false,url);assert.equal(data.h1,1,url);assert.deepEqual(data.broken,[],url);
   for(const nav of data.nav){assert.equal(nav.clipped,false,url);const links=nav.links.filter(x=>x===locale+'/rosh-hashanah');assert.ok(links.length<=1,'Duplicate holiday navigation '+url)}
   assert.equal(data.holidayBuilders,route==='/rosh-hashanah'?1:0,'Festive builder must not replace regular menus '+url);
   if(!locale&&route==='/rosh-hashanah')await p.screenshot({path:folder+`/orderliness-${width===390?'mobile':'desktop'}.png`,fullPage:true});
   report.pages.push({url,width,...data});
  }
  assert.equal(report.writes,0);assert.deepEqual(report.errors,[]);
 }finally{await browser.close()}
 const live=cp.spawnSync(process.execPath,['tasks/rosh-hashanah/live-check.cjs'],{encoding:'utf8',timeout:180000});assert.equal(live.status,0,live.stderr);report.management=JSON.parse(fs.readFileSync(folder+'/live.json','utf8')).admin;
 fs.writeFileSync(folder+'/orderliness.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pages:report.pages.length,errors:report.errors,writes:report.writes,management:report.management}));
}
run().catch(e=>{console.error(e);process.exit(1)});
