import { describe,it,expect } from 'vitest'
import { initialSelection, quote } from '../../../shared/rosh-hashanah.mjs'
import { buildOrderEditorMenu,createOrderDraft,createOrderDraftFromLegacy,calculateOrderDraftPricing,serializeOrderDraft,orderPricingFingerprint } from './order-editor'
const menu=buildOrderEditorMenu({orders:[]})
const complete=(id:'couple'|'four'|'family')=>{const s=initialSelection(id);s.fish.balls=id==='four'?2:1;s.mains.peas=id==='four'?2:1;s.sides.white=id==='four'?2:1;for(const c of s.children)c.rice=1;return s}
describe('festive administration pricing',()=>{
 it.each(['couple','four','family'] as const)('round-trips %s without adding a default Shabbat meal',id=>{
  const s=complete(id),price=quote(s).total
  const draft=createOrderDraftFromLegacy({id:'site-rh-1',name:'QA',date:'2026-09-10',pickup:true,total:price,festivePackages:[{selection:s,quantity:1,unitPrice:price}]},menu)
  expect(draft.meals).toBe(0);expect(draft.challot).toBe(0)
  expect(calculateOrderDraftPricing(draft,menu).result?.totalMinorUnits).toBe(price*100)
  const stored=serializeOrderDraft(draft,'site-rh-1')
  expect(stored.notes).toContain('צלחת ברכות × 1')
  expect(createOrderDraftFromLegacy(stored,menu).festivePackages).toHaveLength(1)
 })
 it('prices every excess independently, multiplies full packages and charges delivery once',()=>{
  const s=complete('family');s.salads++;s.fish.moroccan++;s.mains.tomato++;s.sides.saffron++;s.challah++;s.jam=999999;s.children[0].red=1;s.children.push({rice:1,red:0,white:0})
  expect(quote(s).total).toBe(739)
  const d={...createOrderDraft(menu),name:'QA',meals:0,challot:0,festivePackages:[{selection:s,quantity:2}],custom:[{name:'Other',quantity:1,unitPrice:'20.00',note:''}]}
  expect(calculateOrderDraftPricing(d,menu).result?.totalMinorUnits).toBe(151300)
  const f=orderPricingFingerprint(d);const next=structuredClone(d);next.festivePackages[0].selection.challah++
  expect(orderPricingFingerprint(next)).not.toBe(f)
  expect(calculateOrderDraftPricing(next,menu).result?.totalMinorUnits).toBe(153300)
 })
 it('preserves manual discounts while rebuilding kitchen notes after editing',()=>{
  const s=complete('couple');const d={...createOrderDraft(menu),name:'QA',meals:0,challot:0,pickup:true,total:'340.00',notes:'No doorbell',festivePackages:[{selection:s,quantity:1}]}
  const saved=serializeOrderDraft(d,'rh-admin-1');const reopened=createOrderDraftFromLegacy(saved,menu);reopened.festivePackages![0].selection.challah=3
  const savedAgain=serializeOrderDraft(reopened,'rh-admin-1')
  expect(savedAgain.total).toBe('340.00');expect(savedAgain.notes).toContain('No doorbell');expect(savedAgain.notes).toContain('חלות × 3');expect(savedAgain.notes).not.toContain('חלות × 2')
  expect(calculateOrderDraftPricing(reopened,menu).result?.totalMinorUnits).toBe(36000)
 })
 it('blocks incomplete holiday choices even if a manual price was entered',()=>{
  const d={...createOrderDraft(menu),meals:0,challot:0,total:'450',festivePackages:[{selection:initialSelection('family'),quantity:1}]}
  expect(calculateOrderDraftPricing(d,menu).issues).toContainEqual(expect.objectContaining({code:'FESTIVE_INCOMPLETE',blocking:true}))
 })
})
