import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { CurrencyNote } from '../components/currency-note'
import { Footer } from '../components/footer'
import { Photo } from '../components/photo'
import { Reveal } from '../components/reveal'
import { OutOfStockBadge } from '../components/out-of-stock-badge'
import { useCart } from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { useSiteCatalog } from '../catalog-context'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

type Variant = { id: string; label: string; price: number; catalogKey?: string }
type MenuItem = {
  id: string
  /** Canonical HEBREW dish name — stock/catalog/order key. Never localized. */
  name: string
  img: string
  allergies: Array<'gluten' | 'egg' | 'spicy' | 'gluten-free'>
  price?: number
  variants?: Variant[]
  realPhoto?: boolean
  lunchKey?: string
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
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7VXcb8xTxLR.jpeg',
    allergies: ['gluten', 'egg'],
    variants: [
      // Variant labels stay Hebrew — they are folded into the canonical
      // order-line name. Display labels live in COPY.variantLabels.
      { id: 'schnitzel-baguette-bread', label: 'בגט', price: 25, catalogKey: 'baguette' },
      { id: 'schnitzel-baguette-challah', label: 'חלה', price: 28, catalogKey: 'challah' },
    ],
    lunchKey: 'schnitzel-roll',
  },
  {
    id: 'tunisian-baguette',
    name: 'בגט טוניסאי אותנטי',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/L2KsnsfAZbI.jpeg',
    allergies: ['gluten', 'egg'],
    price: 22,
    lunchKey: 'baguette',
  },
  {
    id: 'kubbe-selek',
    name: 'קובה סלק ביתית',
    img: '/site/assets/kubbe-selek-real.jpg',
    allergies: ['gluten-free'],
    price: 35,
    realPhoto: true,
    lunchKey: 'kubeh',
  },
]

const HE = {
  heroBadge: 'Fresh Every Single Day',
  heroTitle: ['מטעמי', 'יום חול'] as [string, string],
  heroSubtitle: 'הטעם של הבית מחכה לכם בכל יום בשבוע. כשר, טרי ומבושל באהבה - במיוחד עבורכם בדובאי.',
  heroImageAlt: 'תפריט יום חול כשר וטרי - מטעמי בת מלך דובאי',
  menuHeading: 'התפריט היומי שלנו',
  menuIntro: 'מטבח ביתי כשר בדובאי עם משלוח יומי — בגטים, קובה וסלטים טריים שמגיעים חמים לכל אזור בעיר.',
  legendGluten: 'גלוטן',
  legendEgg: 'ביצים',
  legendSpicy: 'חריף',
  items: {
    'schnitzel-baguette': {
      ingredients: 'רכיבים: שניצל עוף, קמח, ביצים, פירורי לחם, מטבוחה, חציל, צ׳ירשי.',
      desc: 'מטבוחה ביתית פיקנטית, שניצל קריספי, חציל מטוגן וצ׳ירשי.',
    },
    'tunisian-baguette': {
      ingredients: 'רכיבים: בגט, טונה, ביצים, תפו״א, לימון כבוש, צלפים, אריסה.',
      desc: 'אריסה פיקנטית, טונה איכותית, ביצים קשות, תפו"א, לימון כבוש וצלפים.',
    },
    'kubbe-selek': {
      ingredients: 'רכיבים: סולת, בקר, בצל, סלק, לימון, מלח, סוכר, תבלינים.',
      desc: '5 יח׳ קובה עבודת יד במרק סלק עשיר וקטיפתי. מוגש לצד אורז לבן.',
    },
  },
  variantLabels: {
    'schnitzel-baguette-bread': 'בגט',
    'schnitzel-baguette-challah': 'חלה',
  } as Record<string, string>,
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    heroBadge: 'Fresh Every Single Day',
    heroTitle: ['Weekday', 'Delights'],
    heroSubtitle: 'The taste of home, every day of the week. Kosher, fresh, and cooked with love — just for you in Dubai.',
    heroImageAlt: 'Fresh kosher weekday menu — Bat Melech Delights, Dubai',
    menuHeading: 'Our Daily Menu',
    menuIntro: 'A kosher home kitchen in Dubai with daily delivery — fresh baguettes, kubbeh, and salads arriving hot anywhere in the city.',
    legendGluten: 'Gluten',
    legendEgg: 'Egg',
    legendSpicy: 'Spicy',
    items: {
      'schnitzel-baguette': {
        ingredients: 'Ingredients: chicken schnitzel, flour, eggs, breadcrumbs, matbucha, eggplant, chirshi.',
        desc: 'Spicy homemade matbucha, crispy golden schnitzel, fried eggplant, and chirshi.',
      },
      'tunisian-baguette': {
        ingredients: 'Ingredients: baguette, tuna, eggs, potato, preserved lemon, capers, harissa.',
        desc: 'Fiery harissa, premium tuna, hard-boiled eggs, potato, preserved lemon, and capers.',
      },
      'kubbe-selek': {
        ingredients: 'Ingredients: semolina, beef, onion, beet, lemon, salt, sugar, spices.',
        desc: '5 handmade kubbeh in a rich, velvety beet broth. Served alongside white rice.',
      },
    },
    variantLabels: {
      'schnitzel-baguette-bread': 'Baguette',
      'schnitzel-baguette-challah': 'Challah',
    },
  },
  fr: {
    heroBadge: 'Frais chaque jour',
    heroTitle: ['Délices de', 'semaine'],
    heroSubtitle: 'Le goût de la maison, tous les jours de la semaine. Casher, frais et cuisiné avec amour — pour vous, à Dubaï.',
    heroImageAlt: 'Menu de semaine casher et frais — Bat Melech, Dubaï',
    menuHeading: 'Notre menu du jour',
    menuIntro: 'Une cuisine familiale casher à Dubaï, avec livraison quotidienne — baguettes, kubés et salades fraîches, livrés chauds partout en ville.',
    legendGluten: 'Gluten',
    legendEgg: 'Œufs',
    legendSpicy: 'Piquant',
    items: {
      'schnitzel-baguette': {
        ingredients: 'Ingrédients : schnitzel de poulet, farine, œufs, chapelure, matboukha, aubergine, tchirchi.',
        desc: 'Matboukha maison relevée, schnitzel croustillant, aubergines frites et tchirchi.',
      },
      'tunisian-baguette': {
        ingredients: 'Ingrédients : baguette, thon, œufs, pommes de terre, citron confit, câpres, harissa.',
        desc: 'Harissa relevée, thon de qualité, œufs durs, pommes de terre, citron confit et câpres.',
      },
      'kubbe-selek': {
        ingredients: 'Ingrédients : semoule, bœuf, oignon, betterave, citron, sel, sucre, épices.',
        desc: '5 kubés faits main dans un bouillon de betterave riche et velouté. Servis avec du riz blanc.',
      },
    },
    variantLabels: {
      'schnitzel-baguette-bread': 'Baguette',
      'schnitzel-baguette-challah': 'Halla',
    },
  },
}

export function Weekdays() {
  const { addLine } = useCart()
  const { isOutOfStock } = useSiteStatus()
  const { lunchItem, dishByName } = useSiteCatalog()
  const { locale, dir } = useLocale()
  const t = COPY[locale]

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/weekdays"
        size="tall"
        badge={t.heroBadge}
        title={t.heroTitle}
        subtitle={t.heroSubtitle}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/1zGIolEp4on.jpeg"
        imageAlt={t.heroImageAlt}
      />

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 md:py-20 pb-28 md:pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-6xl font-black font-heading mb-6 tracking-tight">{t.menuHeading}</h2>
          <p className="max-w-2xl mx-auto text-[#3B151A]/60 font-bold text-lg mb-8">
            {t.menuIntro}
          </p>
          <div className="flex justify-center gap-4">
            <span className="flex items-center gap-1 text-xs font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:bread-bold" className="text-amber-800" /> {t.legendGluten}
            </span>
            <span className="flex items-center gap-1 text-xs font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:egg-bold" className="text-amber-600" /> {t.legendEgg}
            </span>
            <span className="flex items-center gap-1 text-xs font-black bg-white/50 px-2 py-1 rounded-md border border-[#EDB2C1]/30">
              <Icon icon="ph:pepper-bold" className="text-red-600" /> {t.legendSpicy}
            </span>
          </div>
          <CurrencyNote className="mt-6" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 md:gap-16">
          {MENU.map((item, i) => {
            const soldOut = isOutOfStock(item.name)
            const live = item.lunchKey !== undefined ? lunchItem(item.lunchKey) : null
            const dish = dishByName(item.name)
            const itemPrice = item.price !== undefined ? (live?.priceUsd ?? item.price) : undefined
            const displayItemName = dishName(item.name, locale)
            const itemCopy = t.items[item.id as keyof typeof t.items]
            return (
            <Reveal
              key={item.id}
              delay={(i % 3) * 100}
              className="bg-white rounded-[2.5rem] md:rounded-[4rem] p-6 md:p-8 shadow-2xl border-2 border-[#EDB2C1]/20 transition-all duration-500 hover:-translate-y-3 flex flex-col"
            >
              <div className="relative aspect-square rounded-3xl md:rounded-[3.5rem] overflow-hidden mb-6 md:mb-8 shadow-xl">
                <Photo src={item.img} className={`w-full h-full object-cover ${soldOut ? 'grayscale opacity-60' : ''}`} alt={displayItemName} real={item.realPhoto} />
                <div className="absolute top-6 start-6 flex flex-col gap-2">
                  {item.allergies.map((a) => (
                    <span key={a} className="bg-white/90 p-2 rounded-2xl shadow-xl flex items-center justify-center" title={a}>
                      <Icon icon={ALLERGY_ICON[a]} className="text-xl" />
                    </span>
                  ))}
                </div>
                {soldOut && <OutOfStockBadge className="absolute bottom-6 start-6" />}
              </div>
              <div className="flex-grow">
                <h3 className="text-2xl md:text-3xl font-black mb-2 leading-tight">{displayItemName}</h3>
                <p className="text-xs text-[#3B151A]/60 font-bold mb-4">{itemCopy.ingredients}</p>
                <p className="text-[#3B151A]/60 font-bold mb-8 leading-relaxed text-lg">{itemCopy.desc}</p>
                {dish !== null && (dish.imageUrl !== null || dish.description !== '') && (
                  <div className="mb-8 flex flex-col gap-3">
                    {dish.imageUrl !== null && (
                      <img
                        src={dish.imageUrl}
                        alt={dishName(dish.name, locale)}
                        loading="lazy"
                        className="w-full max-h-40 object-cover rounded-[2rem] shadow-xl"
                      />
                    )}
                    {dish.description !== '' && (
                      <p className="text-[#3B151A]/60 font-bold leading-relaxed">{dish.description}</p>
                    )}
                  </div>
                )}
              </div>
              {item.variants ? (
                <div className="pt-8 border-t-2 border-[#EDB2C1]/10 flex flex-col gap-3">
                  {item.variants.map((v) => {
                    const variantPrice = live?.variants.find((c) => c.key === v.catalogKey)?.priceUsd ?? v.price
                    const variantLabel = t.variantLabels[v.id] ?? v.label
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={soldOut}
                        onClick={() =>
                          addLine({
                            // Canonical Hebrew order-line name (unchanged) —
                            // the kitchen and stock matching rely on it.
                            id: v.id,
                            name: `${item.name} (${v.label})`,
                            displayName: `${displayItemName} (${variantLabel})`,
                            unitPrice: variantPrice,
                          })
                        }
                        className="flex items-center justify-between bg-[#F7ECE6] rounded-2xl px-6 py-4 font-black transition-all enabled:hover:bg-[#3B151A] enabled:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span>{variantLabel}</span>
                        <span>${variantPrice}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="pt-8 border-t-2 border-[#EDB2C1]/10 flex items-center justify-between mt-auto">
                  <span className="text-3xl md:text-4xl font-black">${itemPrice}</span>
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => addLine({ id: item.id, name: item.name, displayName: displayItemName, unitPrice: itemPrice! })}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-[2rem] md:rounded-[2.5rem] bg-[#3B151A] text-white flex items-center justify-center shadow-xl transition-all duration-500 enabled:hover:bg-[#F5A83A] enabled:hover:text-[#3B151A] enabled:hover:rotate-90 disabled:bg-[#3B151A]/30 disabled:cursor-not-allowed"
                  >
                    <Icon icon="ph:plus-bold" className="text-3xl md:text-4xl" />
                  </button>
                </div>
              )}
            </Reveal>
            )
          })}
        </div>
      </main>

      <Footer />
    </div>
  )
}
