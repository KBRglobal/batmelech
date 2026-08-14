import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useNavigate } from 'react-router'
import { PageHero } from '../components/page-hero'
import { CurrencyNote } from '../components/currency-note'
import { Photo } from '../components/photo'
import { useCart } from '../cart-context'

const BASE_PRICE = 230
const INCLUDED_SALADS = 4
const SALAD_EXTRA_PRICE = 6.25
const INCLUDED_FIRST = 1
const FIRST_EXTRA_PRICE = 25
const INCLUDED_MAIN = 1
const MAIN_EXTRA_PRICE = 45

type Salad = { id: string; name: string; img: string; allergy?: 'gluten-free' | 'egg' | 'spicy'; realPhoto?: boolean }
type Choice = { id: string; name: string; img: string; allergy?: 'gluten' | 'gluten-free' | 'egg' }

const SALADS: Salad[] = [
  { id: 'salad-cabbage-white', name: 'כרוב לבן קלאסי', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/WhatsAppImage2026-08-13at17-58-38-tn6OonVbOX3.jpeg', allergy: 'gluten-free' },
  { id: 'salad-cabbage-purple', name: 'כרוב סגול במיונז', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/WhatsAppImage2026-08-13at17-58-381-bR993g9VsLN.jpeg', allergy: 'egg' },
  { id: 'salad-coleslaw', name: 'קולסלאו', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/FV0qotWV27P.jpeg', allergy: 'egg' },
  { id: 'salad-matbucha', name: 'מטבוחה פיקנטית', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/cVEz0yFtGoP.jpeg', allergy: 'spicy' },
  { id: 'salad-chirshi', name: "צ'ירשי טריפוליטאי", img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/LkkkAnY1xCn.jpeg' },
  { id: 'salad-meshwiya', name: 'משוויה מרוקאית', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/suiaqbglZMf.jpeg', allergy: 'spicy' },
  { id: 'salad-msir', name: 'מסייר (חמוצים)', img: '/site/assets/pickles-real.jpg', realPhoto: true },
  { id: 'salad-tahini', name: 'טחינה', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7GjgJuaYjlq.jpeg' },
  { id: 'salad-beet', name: 'סלק מבושל', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/twpm8363MgJ.jpeg' },
  { id: 'salad-carrot', name: 'גזר מרוקאי מבושל', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ktV7lQAiCxj.jpeg', allergy: 'spicy' },
  { id: 'salad-eggplant-mayo', name: 'חציל במיונז', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ArFGA1BIJAz.jpeg', allergy: 'egg' },
  { id: 'salad-eggplant-fried', name: 'חציל מטוגן', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/oIpRFnfrVKc.jpeg' },
  { id: 'salad-pepper-roasted', name: 'פלפלים קלויים', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/WhatsAppImage2026-08-13at17-58-371-liCX1e96i1L.jpeg' },
  { id: 'salad-cherry-spicy', name: 'עגבניות שרי חריפות', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Cb9z6EshGnU.jpeg', allergy: 'spicy' },
  { id: 'salad-pepper-hot', name: 'פלפל חריף צלוי', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/M6PCfCukw4f.jpeg', allergy: 'spicy' },
  { id: 'salad-egg', name: 'סלט ביצים', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Vz9NyTP6CaJ.jpeg', allergy: 'egg' },
  { id: 'salad-potato', name: 'סלט תפו"א', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/yt88LuvAVmz.jpeg', allergy: 'egg' },
]

const FIRST_COURSES: Choice[] = [
  { id: 'first-fish-pair', name: 'זוג פילה דג בר טרי (חריימה/מרוקאי)', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/DNV0D2JBB1h.jpeg', allergy: 'gluten-free' },
  { id: 'first-fish-balls', name: 'קציצות דגים ברוטב מרוקאי', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/1UoTNxPxBpB.jpeg' },
]

const MAIN_COURSES: Choice[] = [
  { id: 'main-meat-red', name: 'קציצות בשר ברוטב אדום עשיר', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/WhatsAppImage2026-08-13at17-58-40-yVr6wFVvFkl.jpeg', allergy: 'gluten' },
  { id: 'main-meat-pea', name: 'קציצות בשר עם אפונה וארטישוק', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/nQX6y7PSyNL.jpeg' },
  { id: 'main-meat-chestnut', name: 'קציצות בשר בריבת בצל וערמונים', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/qVICFmHhkmz.jpeg' },
  { id: 'main-chicken-red', name: 'טבחה עוף אדומה עם שעועית', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/d31Kxj4sAHE.jpeg' },
  { id: 'main-chicken-morocco', name: 'תבשיל עוף מרוקאי עם חומוסים', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZBzRBV0QnjT.jpeg' },
  { id: 'main-chicken-yellow', name: 'טבחה עוף צהובה עם תפו"א', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/00bCUcj59KN.jpeg' },
]

const SIDES = [
  { id: 'side-rice-white', name: 'אורז לבן' },
  { id: 'side-rice-persian', name: 'אורז פרסי עם עשבי תיבול' },
  { id: 'side-couscous', name: 'קוסקוס עננים' },
]

const DESSERTS: Choice[] = [
  { id: 'dessert-baklava', name: 'סוכריות בקלאווה', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/JCOJo8pP96p.jpeg' },
  { id: 'dessert-souffle', name: 'סופלה שוקולד', img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/MmM6NDYjm66.jpeg' },
]

const ALLERGY_ICON: Record<string, string> = {
  'gluten-free': 'ph:check-circle-bold',
  egg: 'ph:egg-bold',
  spicy: 'ph:pepper-bold',
  gluten: 'ph:bread-bold',
}

export function ShabbatOrder() {
  const { addLine } = useCart()
  const navigate = useNavigate()

  const [salads, setSalads] = useState<Set<string>>(new Set())
  const [firstQty, setFirstQty] = useState<Record<string, number>>({})
  const [mainQty, setMainQty] = useState<Record<string, number>>({})
  const [side, setSide] = useState<string>('')
  const [dessert, setDessert] = useState<string>('')

  const toggleSalad = (id: string) =>
    setSalads((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const bumpFirst = (id: string, delta: number) =>
    setFirstQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  const bumpMain = (id: string, delta: number) =>
    setMainQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))

  const firstCount = Object.values(firstQty).reduce((a, b) => a + b, 0)
  const mainCount = Object.values(mainQty).reduce((a, b) => a + b, 0)

  const { total, saladExtra, firstExtra, mainExtra } = useMemo(() => {
    const saladExtraN = Math.max(0, salads.size - INCLUDED_SALADS) * SALAD_EXTRA_PRICE
    const firstExtraN = Math.max(0, firstCount - INCLUDED_FIRST) * FIRST_EXTRA_PRICE
    const mainExtraN = Math.max(0, mainCount - INCLUDED_MAIN) * MAIN_EXTRA_PRICE
    return {
      saladExtra: saladExtraN,
      firstExtra: firstExtraN,
      mainExtra: mainExtraN,
      total: BASE_PRICE + saladExtraN + firstExtraN + mainExtraN,
    }
  }, [salads, firstCount, mainCount])

  const missing: string[] = []
  if (salads.size < INCLUDED_SALADS) {
    const left = INCLUDED_SALADS - salads.size
    missing.push(left === 1 ? 'עוד סלט אחד' : `עוד ${left} סלטים`)
  }
  if (firstCount < INCLUDED_FIRST) missing.push('מנה ראשונה')
  if (mainCount < INCLUDED_MAIN) missing.push('מנה עיקרית')
  if (!side) missing.push('תוספת')
  if (!dessert) missing.push('קינוח')

  const canContinue = missing.length === 0

  const handleContinue = () => {
    if (!canContinue) return
    const saladNames = SALADS.filter((s) => salads.has(s.id)).map((s) => s.name)
    const firstNames = FIRST_COURSES.filter((c) => (firstQty[c.id] ?? 0) > 0).map((c) => `${c.name} x${firstQty[c.id]}`)
    const mainNames = MAIN_COURSES.filter((c) => (mainQty[c.id] ?? 0) > 0).map((c) => `${c.name} x${mainQty[c.id]}`)
    const sideName = SIDES.find((s) => s.id === side)?.name
    const dessertName = DESSERTS.find((d) => d.id === dessert)?.name
    const note = [
      `סלטים: ${saladNames.join(', ')}`,
      `ראשונה: ${firstNames.join(', ')}`,
      `עיקרית: ${mainNames.join(', ')}`,
      `תוספת: ${sideName}`,
      `קינוח: ${dessertName}`,
    ]
      .filter(Boolean)
      .join(' | ')
    addLine({ id: 'shabbat-package', name: 'מארז שבת זוגי יוקרתי', unitPrice: total, note })
    navigate('/checkout')
  }

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-72" dir="rtl">
      <PageHero
        active="/shabbat-order"
        size="tall"
        badge="The Shabbat Experience"
        title={['מארז שבת', 'זוגי יוקרתי']}
        subtitle="הרכיבו לעצמכם את מארז הקידוש המושלם - כשר, טרי ומגיע עד אליכם."
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/L5fzK0kRQ4N.jpeg"
        imageAlt="מארז שבת זוגי יוקרתי כשר בדובאי - מטעמי בת מלך"
      />

      <main className="max-w-5xl mx-auto px-6 pt-20 space-y-20">
        <div>
          <p className="max-w-2xl mx-auto text-center text-[#3B151A]/60 font-bold text-lg">
            ארוחת שבת כשרה בדובאי, מבושלת טרי ומגיעה עד אליכם — סלטים, מנה ראשונה, עיקרית וקינוח למארז זוגי מלא.
          </p>
          <CurrencyNote className="mt-6" />
        </div>
        <Link
          to="/shabbat-extras"
          className="block max-w-2xl mx-auto text-center text-[#8D182C] font-black underline text-sm"
        >
          לא רוצים חבילה שלמה? לחיזוקים לסופ״ש — מנות בודדות בלי התחייבות
        </Link>
        <div className="bg-amber-100/50 border-2 border-amber-200 p-8 rounded-[3rem] flex items-start gap-6 shadow-sm">
          <Icon icon="ph:info-fill" className="text-amber-600 text-4xl shrink-0" />
          <div>
            <h5 className="font-black text-amber-900 text-xl mb-2">שיטת הבחירה במארז</h5>
            <p className="text-amber-800 font-bold text-sm leading-relaxed">
              המחיר הבסיסי ($230) כולל: 4 סלטים, מנה ראשונה אחת, עיקרית אחת, תוספת אחת וקינוח אחד.
              <br />
              כל בחירה מעבר למכסה מתווספת אוטומטית למחיר למטה.
            </p>
          </div>
        </div>

        <SectionHeader n={1} title="סלטים טריים" hint={`יש לבחור לפחות 4 (סלט חמישי ומעלה: $${SALAD_EXTRA_PRICE} ליחידה)`} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 -mt-12">
          {SALADS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSalad(s.id)}
              className="group relative bg-white rounded-[2.5rem] overflow-hidden border-2 border-transparent transition-all hover:shadow-xl text-right"
            >
              <div className="aspect-square overflow-hidden relative">
                <Photo src={s.img} alt={s.name} className="w-full h-full object-cover" real={s.realPhoto} />
                {s.allergy && (
                  <span className="absolute top-2 left-2 bg-white/90 p-1.5 rounded-lg shadow-md">
                    <Icon icon={ALLERGY_ICON[s.allergy]} className="text-sm" />
                  </span>
                )}
                <span
                  className={`absolute bottom-3 right-3 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-all ${
                    salads.has(s.id) ? 'bg-[#3B151A] text-white' : 'bg-white text-[#3B151A]'
                  }`}
                >
                  <Icon icon={salads.has(s.id) ? 'ph:check-bold' : 'ph:plus-bold'} className="text-xl" />
                </span>
              </div>
              <div className="p-4">
                <h4 className="text-sm font-black">{s.name}</h4>
              </div>
            </button>
          ))}
        </div>
        {saladExtra > 0 && (
          <p className="text-[#8D182C] font-black text-center -mt-12">+${saladExtra.toFixed(2)} עבור {salads.size - INCLUDED_SALADS} סלטים נוספים</p>
        )}

        <SectionHeader n={2} title="מנות ראשונות" hint={`מנה שניה ומעלה: $${FIRST_EXTRA_PRICE} ליחידה`} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 -mt-12">
          {FIRST_COURSES.map((c) => (
            <QtyCard key={c.id} choice={c} qty={firstQty[c.id] ?? 0} onBump={(d) => bumpFirst(c.id, d)} />
          ))}
        </div>
        {firstExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">+${firstExtra} עבור {firstCount - INCLUDED_FIRST} מנות נוספות</p>}

        <SectionHeader n={3} title="עיקריות לשבת" hint={`מנה שניה ומעלה: $${MAIN_EXTRA_PRICE} ליחידה`} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 -mt-12">
          {MAIN_COURSES.map((c) => (
            <QtyCard key={c.id} choice={c} qty={mainQty[c.id] ?? 0} onBump={(d) => bumpMain(c.id, d)} compact />
          ))}
        </div>
        {mainExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">+${mainExtra} עבור {mainCount - INCLUDED_MAIN} מנות נוספות</p>}

        <SectionHeader n={4} title="תוספות לעיקריות" hint="יש לבחור תוספת אחת" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 -mt-12">
          {SIDES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSide((prev) => (prev === s.id ? '' : s.id))}
              className={`block p-6 rounded-3xl border-2 transition-all shadow-sm text-center font-black ${
                side === s.id ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-transparent bg-white'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        <SectionHeader n={5} title="סיום מתוק (פרווה)" hint="יש לבחור מנה אחת" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 -mt-12">
          {DESSERTS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDessert((prev) => (prev === d.id ? '' : d.id))}
              className={`group relative rounded-[3.5rem] overflow-hidden border-4 transition-all shadow-lg text-right ${
                dessert === d.id ? 'border-[#F5A83A]' : 'border-transparent'
              }`}
            >
              <div className="aspect-video overflow-hidden relative">
                <Photo src={d.img} alt={d.name} className="w-full h-full object-cover" />
                <div className="absolute bottom-4 right-4 px-8 py-3 rounded-2xl bg-white font-black shadow-2xl">{d.name}</div>
              </div>
            </button>
          ))}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-6 md:p-10 bg-[#F7ECE6]/95 backdrop-blur-3xl border-t-4 border-[#EDB2C1]/20 z-[200] shadow-[0_-30px_60px_rgba(0,0,0,0.15)]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 md:gap-10">
          <div className="flex items-center gap-6 md:gap-10 w-full sm:w-auto justify-center sm:justify-start">
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-[2rem] md:rounded-[3rem] bg-[#3B151A] text-white flex flex-col items-center justify-center shadow-2xl border-4 border-[#F5A83A]/30 shrink-0">
              <span className="text-2xl md:text-4xl font-black">${total.toFixed(2).replace(/\.00$/, '')}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[#F5A83A] text-xs font-black uppercase tracking-[0.3em] mb-1">מארז שבת זוגי יוקרתי</span>
              <span className="text-xl md:text-3xl font-black leading-tight">{canContinue ? 'סיכום הזמנה' : `חסר: ${missing.join(', ')}`}</span>
            </div>
          </div>
          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="w-full sm:w-auto bg-[#3B151A] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white px-12 md:px-20 py-6 md:py-8 rounded-[2rem] md:rounded-[3rem] font-black text-xl md:text-3xl shadow-2xl transition-all flex items-center justify-center gap-4 md:gap-6 group"
          >
            המשך להזמנה <Icon icon="ph:arrow-left-bold" className="text-2xl md:text-4xl group-hover:-translate-x-3 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="pt-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <span className="w-14 h-14 rounded-2xl bg-[#3B151A] text-white flex items-center justify-center font-black text-2xl shadow-xl">{n}</span>
          <h2 className="text-3xl md:text-5xl font-black font-heading tracking-tight">{title}</h2>
        </div>
      </div>
      <p className="text-[#3B151A]/60 font-bold mr-0 md:mr-16 text-base md:text-lg italic mb-8">{hint}</p>
    </div>
  )
}

function QtyCard({
  choice,
  qty,
  onBump,
  compact = false,
}: {
  choice: Choice
  qty: number
  onBump: (delta: number) => void
  compact?: boolean
}) {
  return (
    <div className="group relative bg-white rounded-[3.5rem] overflow-hidden border-4 border-transparent transition-all hover:shadow-xl">
      <div className={compact ? 'aspect-video overflow-hidden relative' : 'aspect-video overflow-hidden relative'}>
        <Photo src={choice.img} alt={choice.name} className="w-full h-full object-cover" />
        {choice.allergy && (
          <span className="absolute top-4 left-4 bg-white/90 p-2 rounded-xl shadow-lg">
            <Icon icon={ALLERGY_ICON[choice.allergy]} className="text-lg" />
          </span>
        )}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-white rounded-2xl shadow-2xl p-1">
          <button type="button" onClick={() => onBump(1)} className="w-10 h-10 rounded-xl bg-[#3B151A] text-white flex items-center justify-center font-black">
            +
          </button>
          <span className="w-8 text-center font-black">{qty}</span>
          <button type="button" onClick={() => onBump(-1)} className="w-10 h-10 rounded-xl bg-[#F7ECE6] flex items-center justify-center font-black">
            −
          </button>
        </div>
      </div>
      <div className={compact ? 'p-6' : 'p-8 text-center'}>
        <h4 className={compact ? 'text-lg font-black' : 'text-2xl font-black'}>{choice.name}</h4>
      </div>
    </div>
  )
}
