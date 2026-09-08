const {chromium,webkit}=require('../../tests/node_modules/playwright-core');
const express=require('express'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),folder=path.join(__dirname,'evidence');
async function run(){
 const app=express();app.get('/api/site/status',(_,res)=>res.json({orderingOpen:true,outOfStockNames:[]}));app.get('/api/*',(_,res)=>res.json({}));app.use('/site',express.static(path.join(root,'site')));app.get('*',(_,res)=>res.sendFile(path.join(root,'site/index.html')));
 const server=await new Promise(resolve=>{const s=app.listen(4192,'127.0.0.1',()=>resolve(s))});const baseline=false;const report={layouts:[],errors:[]};
 try{for(const engine of baseline?[chromium]:[chromium,webkit]){
  const browser=await engine.launch();try{const context=await browser.newContext({locale:'he-IL',reducedMotion:'reduce'});const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
  const open=async(locale,width)=>{await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:4192'+locale+'/rosh-hashanah');await p.locator('h1').waitFor();await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))});};
  if(engine===chromium){await open('',1440);const png=await p.screenshot({fullPage:true,animations:'disabled'});if(baseline){fs.writeFileSync(folder+'/mobile-desktop-before.png',png);return}fs.writeFileSync(folder+'/mobile-desktop-after.png',png);assert.ok(png.equals(fs.readFileSync(folder+'/mobile-desktop-before.png')),'Desktop must remain pixel-identical');report.desktopIdentical=true;}
  for(const locale of ['','/en','/fr'])for(const width of [320,390,430,768,1024]){
   await open(locale,width);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const guide=p.locator('.festive-package-guide');assert.equal(await guide.isVisible(),width<1024);
   if(width<1024){
    const choose=async(id)=>{await p.locator(`.festive-package:has(input[value="${id}"])`).click();await p.waitForFunction(()=>{const y=document.querySelector('#festive-choices').getBoundingClientRect().top;return y>=0&&y<30})};
    await choose('family');assert.equal(await guide.locator('li').count(),4);assert.ok((await guide.innerText()).includes('$450'));
    await choose('four');assert.equal(await guide.locator('li').count(),3);assert.ok((await guide.innerText()).includes('0/4'));
    await choose('couple');assert.ok((await guide.innerText()).includes('$350'));await choose('couple');
    assert.equal(await p.locator('.festive-add-button').isDisabled(),true);
    await p.locator('.festive-mobile-bar button').click();await p.waitForFunction(()=>{const y=document.querySelector('#festive-step-03').getBoundingClientRect().top;return y>=0&&y<30});assert.ok(p.url().endsWith('/rosh-hashanah'));
    if(engine===chromium&&!locale&&width===390){await choose('family');await p.screenshot({path:folder+'/mobile-flow.png'});}
   }
   report.layouts.push({browser:engine.name(),locale:locale||'he',width});
  }
  await open('',390);await p.locator('input[value="family"]').check();await p.getByRole('spinbutton',{name:'קציצות דגים ברוטב מרוקאי',exact:true}).fill('1');await p.getByRole('spinbutton',{name:'קציצות בקר ברוטב אפונה וארטישוק',exact:true}).fill('1');await p.getByRole('spinbutton',{name:'אורז לבן קלאסי',exact:true}).fill('1');
  await p.locator('.festive-mobile-bar button').click();await p.waitForFunction(()=>{const y=document.querySelector('#festive-step-08').getBoundingClientRect().top;return y>=0&&y<30});
  await p.getByRole('spinbutton',{name:'ילד 1: אורז',exact:true}).fill('1');assert.equal(await p.locator('.festive-add-button').isDisabled(),true);await p.getByRole('spinbutton',{name:'ילד 2: אורז',exact:true}).fill('1');assert.equal(await p.getByTestId('festive-total').innerText(),'$450');assert.equal(await p.locator('.festive-add-button').isDisabled(),false);await p.locator('.festive-mobile-bar button').click();await p.waitForURL('**/checkout');
 }finally{await browser.close()}}
 assert.deepEqual(report.errors,[]);fs.writeFileSync(folder+'/mobile-flow.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{server.close()}
}
run().catch(e=>{console.error(e);process.exit(1)});
