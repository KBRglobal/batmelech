import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { Photo } from '../components/photo'
import { Reveal } from '../components/reveal'
import { useCart } from '../cart-context'

type Variant = { id: string; label: string; price: number }
type MenuItem = {
  id: string
  name: string
  ingredients: string
  desc: string
  img: string
  allergies: Array<'gluten' | 'egg' | 'spicy' | 'gluten-free'>
  price?: number
  variants?: Variant[]
  realPhoto?: boolean
}

const ALLERGY_ICON: Record<MenuItem['allergies'][number], string> = {
  gluten: 'ph:bread-bold',
  egg: 'ph:egg-bold',
  spicy: 'ph:pepper-bold',
  'gluten-free': 'ph:check-circle-bold',
}

const MENU: MenuItem[] = [
  {
    id: 'schnitzel-baguette',
    name: 'בגט / חלת שניצל ישראלי',
    ingredients: 'רכיבים: שניצל עוף, קמח, ביצים, פירורי לחם, מטבוחה, חציל, צ׳ירשי.',
    desc: 'מטבוחה ביתית פיקנטית, שניצל קריספי, חציל מטוגן וצ׳ירשי.',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7VXcb8xTxLR.jpeg',
    allergies: ['gluten', 'egg'],
    variants: [
      { id: 'schnitzel-baguette-bread', label: 'בגט', price: 25 },
      { id: 'schnitzel-baguette-challah', label: 'חלה', price: 28 },
    ],
  },
  {
    id: 'tunisian-baguette',
    name: 'בגט טוניסאי אותנטי',
    ingredients: 'רכיבים: בגט, טונה, ביצים, תפו״א, לימון כבוש, צלפים, אריסה.',
    desc: 'אריסה פיקנטית, טונה איכותית, ביצים קשות, תפו"א, לימון כבוש וצלפים.',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/L2KsnsfAZbI.jpeg',
    allergies: ['gluten', 'egg'],
    price: 22,
  },
  {
    id: 'kubbe-selek',
    name: 'קובה סלק ביתית',
    ingredients: 'רכיבים: סולת, בקר, בצל, סלק, לימון, מלח, סוכר, תבלינים.',
    desc: '5 יח׳ קובה עבודת יד במרק סלק עשיר וקטיפתי. מוגש לצד אורז לבן.',
    img: '/site/assets/kubbe-selek-real.jpg',
    allergies: ['gluten-free'],
    price: 35,
    realPhoto: true,
  },
]

export function Weekdays() {
  const { addLine } = useCart()

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir="rtl">
      <PageHero
        active="/weekdays"
        size="tall"
        badge="Fresh Every Single Day"
        title={['מטעמי', 'יום חול']}
        subtitle="הטעם של הבית מחכה לכם בכל יום בשבוע. כשר, טרי ומבושל באהבה - במיוחד עבורכם בדובאי."
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/1zGIolEp4on.jpeg"
        imageAlt="תפריט יום חול כשר וטרי - מטעמי בת מלך דובאי"
      />

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-20 pb-56">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-6xl font-black font-heading mb-6 tracking-tight">התפריט היומי שלנו</h2>
          <p className="max-w-2xl mx-auto text-[#3B151A]/60 font-bold text-lg mb-8">
            מטבח ביתי כשר בדובאי עם משלוח יומי — בגטים, קובה וסלטים טריים שמגיעים חמים לכל אזור בעיר.
          </p>
          <div className="flex justify-center gap-4">
            <span className="flex items-center gap-1 text-[10px] font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:bread-bold" className="text-amber-800" /> גלוטן
            </span>
            <span className="flex items-center gap-1 text-[10px] font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:egg-bold" className="text-amber-600" /> ביצים
            </span>
            <span className="flex items-center gap-1 text-[10px] font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:pepper-bold" className="text-red-600" /> חריף
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 md:gap-16">
          {MENU.map((item, i) => (
            <Reveal
              key={item.id}
              delay={(i % 3) * 100}
              className="bg-white rounded-[4rem] p-8 shadow-2xl border-2 border-[#EDB2C1]/20 transition-all duration-500 hover:-translate-y-3 flex flex-col"
            >
              <div className="relative aspect-square rounded-[3.5rem] overflow-hidden mb-8 shadow-xl">
                <Photo src={item.img} className="w-full h-full object-cover" alt={item.name} real={item.realPhoto} />
                <div className="absolute top-6 left-6 flex flex-col gap-2">
                  {item.allergies.map((a) => (
                    <span key={a} className="bg-white/90 p-2 rounded-2xl shadow-xl flex items-center justify-center" title={a}>
                      <Icon icon={ALLERGY_ICON[a]} className="text-xl" />
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex-grow">
                <h3 className="text-2xl md:text-3xl font-black mb-2 leading-tight">{item.name}</h3>
                <p className="text-[10px] text-[#3B151A]/40 font-black mb-4">{item.ingredients}</p>
                <p className="text-[#3B151A]/60 font-bold mb-8 leading-relaxed text-lg">{item.desc}</p>
              </div>
              {item.variants ? (
                <div className="pt-8 border-t-2 border-[#EDB2C1]/10 flex flex-col gap-3">
                  {item.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => addLine({ id: v.id, name: `${item.name} (${v.label})`, unitPrice: v.price })}
                      className="flex items-center justify-between bg-[#F7ECE6] hover:bg-[#3B151A] hover:text-white rounded-2xl px-6 py-4 font-black transition-all"
                    >
                      <span>{v.label}</span>
                      <span>${v.price}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="pt-8 border-t-2 border-[#EDB2C1]/10 flex items-center justify-between mt-auto">
                  <span className="text-3xl md:text-4xl font-black">${item.price}</span>
                  <button
                    type="button"
                    onClick={() => addLine({ id: item.id, name: item.name, unitPrice: item.price! })}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-[2rem] md:rounded-[2.5rem] bg-[#3B151A] text-white flex items-center justify-center shadow-xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all duration-500 hover:rotate-90"
                  >
                    <Icon icon="ph:plus-bold" className="text-3xl md:text-4xl" />
                  </button>
                </div>
              )}
            </Reveal>
          ))}
        </div>
      </main>

      <Footer className="mb-40" />
    </div>
  )
}
