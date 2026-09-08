const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const modulePath = path.resolve(__dirname, '../shared/rosh-hashanah.mjs');
test('holiday pricing module implements the approved additional menu', async () => {
  assert.ok(fs.existsSync(modulePath), 'new festive pricing must exist');
  const { quote, initialSelection, catalog, packageOptions, kitchenNote } = await import(modulePath);
  assert.equal(catalog.salads.length,12);
  assert.equal(catalog.blessings.length,8);
  for (const [id,base,units,sets,mains,sides,challah,children] of [['couple',350,2,1,1,1,2,0],['four',650,4,2,2,2,4,0],['family',450,2,1,1,1,2,2]]) {
    const s=initialSelection(id), p=packageOptions[id];
    assert.equal(p.price,base); assert.equal(p.fish,units); assert.equal(s.salads,sets); assert.equal(s.challah,challah); assert.equal(s.children.length,children);
    // Choose all included categories. Removing quota subtraction would fail these assertions.
    s.fish.moroccan=units; s.mains.peas=mains; s.sides.white=sides;
    for(const c of s.children)c.rice=1;
    assert.equal(quote(s).total,base); assert.equal(quote(s).ready,true);
    for(const [a,b,expected] of [[units,0,0],[units+1,0,30],[units+2,0,60],[0,units/2,0],[1,units/2,30],[units,1,60],[1,1,units===2?30:0]]) {
      s.fish={moroccan:a,chraime:0,balls:b}; assert.equal(quote(s).extras.fish,expected);
    }
    s.fish={moroccan:0,chraime:units,balls:0};
    s.salads+=2; s.mains.peas+=2; s.sides.white++; s.challah+=2; s.jam=1000000;
    assert.deepEqual(quote(s).extras,{salads:120,fish:0,mains:200,sides:25,challah:20,children:0,childSides:0});
    assert.equal(quote(s).total,base+365);
    assert.match(kitchenNote(s),/צלחת ברכות/); assert.match(kitchenNote(s),/ריבות ביתיות/);
  }
  const f=initialSelection('family');f.fish.balls=1;f.mains.peas=1;f.sides.white=1;
  f.children=[{rice:1,red:1,white:1},{rice:1,red:0,white:0},{rice:0,red:0,white:1}];
  assert.equal(quote(f).extras.children,49); assert.equal(quote(f).extras.childSides,30);
  assert.equal(quote(f).total,529); assert.equal(f.challah,2);
  f.children[1]={rice:0,red:0,white:0}; assert.equal(quote(f).ready,false);
  // No pooling a child's unused allowance against another child's extras.
  assert.equal(quote(f).extras.childSides,30);
  for(const change of [s=>s.children.push({rice:1,red:0,white:0}),s=>s.fish.balls=-1,s=>s.jam=1.5,s=>s.salads=NaN,s=>s.mains.unknown=1,s=>s.packageId='invalid']){
    const s=initialSelection('couple');change(s);assert.throws(()=>quote(s));
  }
  assert.equal(quote(initialSelection('couple')).ready,false);
});

test('customer concierge distinguishes the festive menu from the existing Shabbat package', () => {
  const {buildSiteKnowledge}=require('../server/ai/site-knowledge');
  const text=buildSiteKnowledge({}, {today:'2026-09-08'});
  assert.match(text,/Separate festive Rosh Hashanah menu/);
  assert.match(text,/\$350/);assert.match(text,/\$650/);assert.match(text,/\$450/);
  assert.match(text,/Shabbat package/);
});
