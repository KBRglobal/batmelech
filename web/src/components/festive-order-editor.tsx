import { catalog, emptyChild, initialSelection, packageOptions, quote, type FestivePackage, type PackageId, type Selection } from '../../../shared/rosh-hashanah.mjs'

const fieldClass = 'w-20 rounded-xl border border-border bg-background p-2 text-center text-sm'
function Quantity({label,value,min=0,onChange}: {label:string;value:number;min?:number;onChange:(value:number)=>void}) {
  return <label className="flex items-center justify-between gap-3 text-sm"><span>{label}</span><input type="number" aria-label={label} min={min} step="1" value={value} className={fieldClass} onChange={event => { const next = Number(event.target.value); if (Number.isSafeInteger(next) && next >= min && next <= 10000) onChange(next) }} /></label>
}
export function FestiveOrderEditor({packages,onChange}: {packages:FestivePackage[];onChange:(packages:FestivePackage[])=>void}) {
  const update = (index:number,selection:Selection) => {
    try { quote(selection); onChange(packages.map((entry,i) => i === index ? {...entry,selection} : entry)) } catch { /* Keep the last valid quantities. */ }
  }
  return <div className="space-y-5" data-testid="festive-editor">
    <p className="text-sm text-muted-foreground">המחיר כולל את מכסות החבילה. חריגות מחויבות אוטומטית בכל קטגוריה בנפרד.</p>
    <div className="flex flex-wrap gap-2">{Object.entries(packageOptions).map(([id,p]) => <button type="button" key={id} className="rounded-xl border border-border bg-primary/5 px-4 py-3 text-sm font-bold" onClick={() => onChange([...packages,{selection:initialSelection(id as PackageId),quantity:1}])}>הוספת {p.name.he} · ${p.price}</button>)}</div>
    {packages.map((entry,index) => {
      const s=entry.selection,p=packageOptions[s.packageId],q=quote(s)
      return <div key={index} className="space-y-4 rounded-2xl border border-border bg-background/60 p-4" data-testid={`festive-package-${index}`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">ראש השנה · {p.name.he}</h3><strong>${q.total} לחבילה · ${q.total * entry.quantity} בסך הכול</strong><button type="button" className="text-sm text-destructive" onClick={() => onChange(packages.filter((_,i)=>i!==index))}>הסרת חבילת חג {index+1}</button></div>
        <Quantity label={`כמות חבילות חג ${index+1}`} value={entry.quantity} min={1} onChange={quantity=>onChange(packages.map((item,i)=>i===index?{...item,quantity}:item))}/>
        <p className="text-xs text-muted-foreground">הבחירות להלן הן לכל חבילה. כל הכמויות והמחיר מוכפלים בכמות החבילות.</p>
        <details><summary className="cursor-pointer font-bold">צלחת ברכות קבועה אחת · כלולה</summary><p className="mt-2 text-sm">{catalog.blessings.map(x=>x.name.he).join(' · ')}</p></details>
        <details><summary className="cursor-pointer font-bold">12 סלטי הבית · מארז קבוע</summary><p className="mt-2 text-sm">{catalog.salads.map(x=>x.name.he).join(' · ')}</p></details>
        <Quantity label={`מארזי סלטים — ${p.salads} כלולים, נוסף $60`} value={s.salads} min={p.salads} onChange={salads=>update(index,{...s,salads})}/>
        {(['fish','mains','sides'] as const).map(category=><fieldset key={category} className="space-y-3 rounded-xl border border-border p-3"><legend className="px-2 font-bold">{category==='fish'?`דגים · ${p.fish} יחידות כלולות · $30 ליחידה נוספת`:category==='mains'?`עיקריות · ${p.mains} כלולות · $100 למנה נוספת`:`תוספות · ${p.sides} כלולות · $25 לתוספת נוספת`}</legend>{category==='fish'&&<p className="text-xs text-muted-foreground">פילה = יחידה אחת. מנת קציצות = 2 יחידות ($60 למנה נוספת מלאה).</p>}{catalog[category].map(item=><Quantity key={item.id} label={item.name.he} value={s[category][item.id]??0} onChange={value=>update(index,{...s,[category]:{...s[category],[item.id]:value}})}/>)}</fieldset>)}
        <Quantity label={`חלות — ${p.challah} כלולות, נוספת $10`} value={s.challah} min={p.challah} onChange={challah=>update(index,{...s,challah})}/>
        <label className="flex items-center justify-between gap-3 text-sm">מארזי ריבות · ללא הגבלה וללא תשלום<input type="number" aria-label="מארזי ריבות" min="0" step="1" value={s.jam} className={fieldClass} onChange={e=>{const jam=Number(e.target.value);if(Number.isSafeInteger(jam)&&jam>=0)update(index,{...s,jam})}}/></label>
        {s.packageId==='family'&&<div className="space-y-3"><p className="font-bold">מארזי ילדים · 2 כלולים · ילד נוסף $49</p><p className="text-sm">{catalog.childFixed.map(x=>x.name.he).join(' · ')}. תוספת ראשונה לכל ילד כלולה; כל תוספת נוספת לאותו ילד $15.</p>{s.children.map((child,childIndex)=><fieldset key={childIndex} className="space-y-2 rounded-xl border border-border p-3"><legend>ילד {childIndex+1}</legend>{catalog.childSides.map(item=><Quantity key={item.id} label={`ילד ${childIndex+1} — ${item.name.he}`} value={child[item.id]??0} onChange={value=>update(index,{...s,children:s.children.map((c,i)=>i===childIndex?{...c,[item.id]:value}:c)})}/>)}{childIndex>=2&&<button type="button" className="text-sm text-destructive" onClick={()=>update(index,{...s,children:s.children.filter((_,i)=>i!==childIndex)})}>הסרת ילד {childIndex+1}</button>}</fieldset>)}<button type="button" className="rounded-xl border border-border px-4 py-2 text-sm font-bold" onClick={()=>update(index,{...s,children:[...s.children,emptyChild()]})}>הוספת ילד · $49</button></div>}
        <p className="text-sm font-bold">מחיר בסיס ${q.base} · חריגות ${q.total-q.base} · לחבילה ${q.total}</p>
        {!q.ready&&<p role="status" className="text-sm text-destructive">יש להשלים את הבחירות הכלולות ותוספת אחת לכל ילד לפני שמירה.</p>}
      </div>
    })}
  </div>
}
