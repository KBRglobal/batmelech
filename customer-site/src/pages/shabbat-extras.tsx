import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import { Link, useNavigate } from 'react-router'
import { PageHero } from '../components/page-hero'
import { CurrencyNote } from '../components/currency-note'
import { OutOfStockBadge } from '../components/out-of-stock-badge'
import { useCart } from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { useSiteCatalog, type CatalogDish } from '../catalog-context'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

const SALAD_PRICE = 6.25
const FIRST_PRICE = 25
const MAIN_PRICE = 45

type Salad = { id: string; name: string; img: string | null }
type Choice = { id: string; name: string; img: string | null; price: number }
type Royal = { id: string; name: string; price: number; note?: string; dark?: boolean }

// Canonical HEBREW dish names — the keys for stock, catalog and order lines.
// Display names are resolved per-locale with dishName().
// These hardcoded lists are ONLY the no-catalog fallback: when the live
// catalog is present, the rendered lists ARE the catalog (photos, order,
// admin-added dishes included) and these supply legacy ids/images by name.
const SALADS: Salad[] = [
  { id: 'salad-matbucha', name: 'מטבוחה פיקנטית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/cVEz0yFtGoP.jpeg' },
  { id: 'salad-cabbage-white', name: 'כרוב לבן קלאסי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-38-tn6OonVbOX3.jpeg' },
  { id: 'salad-tahini', name: 'טחינה', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/7GjgJuaYjlq.jpeg' },
  { id: 'salad-pepper-hot', name: 'פלפל חריף צלוי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/M6PCfCukw4f.jpeg' },
  { id: 'salad-beet', name: 'סלק מבושל', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/twpm8363MgJ.jpeg' },
  { id: 'salad-egg', name: 'סלט ביצים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Vz9NyTP6CaJ.jpeg' },
  { id: 'salad-potato', name: 'סלט תפו"א', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/yt88LuvAVmz.jpeg' },
  { id: 'salad-meshwiya', name: 'משוויה מרוקאית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/suiaqbglZMf.jpeg' },
  { id: 'salad-eggplant-mayo', name: 'חציל במיונז', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ArFGA1BIJAz.jpeg' },
  { id: 'salad-pepper-roasted', name: 'פלפלים קלויים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-371-liCX1e96i1L.jpeg' },
]

const FIRST_COURSES: Choice[] = [
  { id: 'first-fish-pair', name: 'זוג פילה דג בר-ים טרי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/XrjUItAqBlY.jpeg', price: FIRST_PRICE },
  { id: 'first-fish-balls', name: 'קציצות דגים ברוטב מרוקאי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/1UoTNxPxBpB.jpeg', price: FIRST_PRICE },
]

const ROYAL: Royal[] = [
  { id: 'up-roast-beef', name: 'צלי בקר פרוס ברוטב פטריות וערמונים', price: 150, note: '4 אנשים' },
  { id: 'special-kubbe-selek', name: 'סיר קובה סלק עבודת יד', price: 125, note: '4 אנשים' },
  { id: 'up-roulade', name: 'רולדת בשר פריך לצד רוטב פטריות עשיר', price: 100 },
  { id: 'up-schnitzel-tray', name: 'מגש שניצלים של בית', price: 100, note: "כ-15 יח'" },
  { id: 'up-tabkha-red', name: 'טבחה בשר אדומה עם אפונה ותפו"א', price: 100, note: '2-3 אנשים' },
  { id: 'main-meat-red', name: 'קציצות בשר ברוטב אדום עשיר', price: MAIN_PRICE },
  { id: 'main-meat-pea', name: 'קציצות בשר עם אפונה וארטישוק', price: MAIN_PRICE },
  { id: 'main-chicken-morocco', name: 'תבשיל עוף מרוקאי עם חומוסים', price: MAIN_PRICE },
  { id: 'main-chicken-yellow', name: 'טבחה עוף צהובה עם תפו"א', price: MAIN_PRICE },
  { id: 'up-mafrum', name: 'מפרום ביתי של אמא (זוגי)', price: 40 },
  { id: 'special-kids', name: 'מנת ילדים — פסטה ושניצלונים', price: 35 },
  { id: 'up-potato-tray', name: 'מגש תפו"א קריספיים', price: 30 },
  { id: 'up-carb-tray', name: 'מגש אורז / קוסקוס / פסטה אדומה', price: 25 },
  { id: 'up-extra-salads', name: 'תוספת 4 סלטים לבחירה', price: 25 },
  { id: 'up-olives', name: 'צלחת פתיחה (זיתים וחמוצים)', price: 15 },
  { id: 'up-spicy-plate', name: 'צלחת חריפים', price: 15 },
  { id: 'up-hummus', name: 'תוספת חומוס ישראלי לניגוב', price: 15 },
  { id: 'up-challah', name: 'תוספת חלה', price: 10 },
  { id: 'up-havdala', name: 'מארז הבדלה', price: 20, dark: true },
]

const DESSERTS = [
  { id: 'dessert-baklava', name: 'סוכריות בקלאווה מלכותיות', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/JCOJo8pP96p.jpeg' },
  { id: 'dessert-souffle', name: 'סופלה שוקולד פרימיום (פרווה)', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/MmM6NDYjm66.jpeg' },
]

const LOGO_URL = 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/bat-removebg-preview1-jKe7guxvdXt.png'

// Live category → renderable cards, in the admin's saved order. A live dish
// reuses the matching hardcoded card's stable id and falls back to its image
// when the admin has not uploaded a photo; an admin-added dish gets a derived
// id and — without a photo — the placeholder look.
function catalogCards(
  liveDishes: readonly CatalogDish[] | undefined,
  fallback: readonly Salad[],
  idPrefix: string,
): Salad[] {
  if (!liveDishes || liveDishes.length === 0) return [...fallback]
  const localByName = new Map(fallback.map((item) => [item.name, item]))
  return liveDishes.map((dish) => {
    const local = localByName.get(dish.name)
    return {
      id: local?.id ?? `${idPrefix}-${dish.name}`,
      name: dish.name,
      img: dish.imageUrl ?? local?.img ?? null,
    }
  })
}

// Localized copy. Hebrew is the source of truth; English is written for an
// American Jewish audience and French for a French Jewish audience — native
// copy, never word-by-word (always Shabbat/Chabbat, never weekday names).
const HE = {
  heroTitle: ['חיזוקים', 'לסופ״ש'] as [string, string],
  heroSubtitle: 'שולחן השבת הוא הלב הפועם של הבית היהודי. אצלנו בבת מלך, כל מנה היא תפילה וכל טעם הוא חיבור לשורשים.',
  heroImageAlt: 'שולחן שבת מלכותי',
  heroQuote: '"כבודה בת מלך פנימה"',
  statKosherValue: '100%',
  statKosherLabel: 'Kosher Glatt',
  statChefValue: 'Chef',
  statChefLabel: 'Traditional',
  statRoyalValue: 'Royal',
  statRoyalLabel: 'Presentation',
  saladsTitle: 'סלטי הבית הטריים',
  saladsQuote: '"וברכת את ה\' אלוהיך על הארץ הטובה" - פתיחה רעננה שמעוררת את החושים',
  firstsTitle: 'מנות ראשונות חגיגיות',
  firstsQuote: '"טעמו וראו כי טוב ה\'" - מנות פתיחה שיכניסו אתכם לאווירת המלכות',
  soldOut: 'אזל מהמלאי',
  addToOrder: 'הוספה להזמנה',
  royalKicker: 'The Royal Masterpieces',
  royalTitle: 'עיקריות של מלכים',
  royalQuote: '"לכבוד שבת קודש" - הכתר של שולחן השבת שלכם. מנות שמבושלות באהבה ובקדושה.',
  specialsTitle: 'הספיישלים של בת מלך',
  specialsSubtitle: 'בישול ארוך, חומרי גלם מובחרים והרבה נשמה יהודית.',
  royalNotes: {
    'up-roast-beef': '4 אנשים',
    'special-kubbe-selek': '4 אנשים',
    'up-schnitzel-tray': "כ-15 יח'",
    'up-tabkha-red': '2-3 אנשים',
  } as { readonly [id: string]: string | undefined },
  addToRoyal: 'הוסף למלכות שלך',
  coupleTitle: 'תפריט זוגי לכבוד שבת קודש',
  coupleSubtitle: 'חבילה שלמה הכוללת 4 סוגי סלטים, מנה ראשונה, עיקרית, תוספת וקינוח.',
  coupleCta: 'להזמנת החבילה המלכותית',
  dessertsTitle: 'סיווג מתוק וקדוש',
  dessertsQuote: '"דבש וחלב תחת לשונך" - הסיום המתוק שחותם את הסעודה',
  dessertsImageAlt: 'קינוחי שבת',
  includedInPackage: 'כלול במארז השבת',
  buildPackageCta: 'להרכבת המארז ובחירת קינוח',
  dvarTorahTitle: 'דבר תורה לשולחן השבת',
  dvarTorahQuote: '"שבת היא מקור הברכה. כשאנו מכבדים את השבת במאכלים משובחים, אנו פותחים את צינורות השפע לכל השבוע הבא עלינו לטובה."',
  footerLine: 'Kosher Luxury • Dubai • Est. 2024',
  cartBarLabel: 'ההזמנה המלכותית שלך',
  cartBarCta: 'לסיים הזמנה',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    heroTitle: ['Elevate', 'Your Shabbat'],
    heroSubtitle: 'The Shabbat table is the beating heart of the Jewish home. At Bat Melech, every dish is a prayer and every flavor is a connection to our roots.',
    heroImageAlt: 'A royal Shabbat table',
    heroQuote: '"The glory of the king\'s daughter is within" — Kevudah bat melech penimah',
    statKosherValue: '100%',
    statKosherLabel: 'Kosher Glatt',
    statChefValue: 'Chef',
    statChefLabel: 'Traditional',
    statRoyalValue: 'Royal',
    statRoyalLabel: 'Presentation',
    saladsTitle: 'Our Fresh House Salads',
    saladsQuote: '"And you shall bless the Lord your God for the good land" — a fresh opening that awakens the senses',
    firstsTitle: 'Festive First Courses',
    firstsQuote: '"Taste and see that the Lord is good" — starters that usher in the royal spirit',
    soldOut: 'Sold out',
    addToOrder: 'Add to order',
    royalKicker: 'The Royal Masterpieces',
    royalTitle: 'Mains Fit for Royalty',
    royalQuote: '"In honor of the holy Shabbat" — the crown of your Shabbat table. Dishes cooked with love and holiness.',
    specialsTitle: 'The Bat Melech Specials',
    specialsSubtitle: 'Slow cooking, choice ingredients, and plenty of Jewish soul.',
    royalNotes: {
      'up-roast-beef': 'Serves 4',
      'special-kubbe-selek': 'Serves 4',
      'up-schnitzel-tray': 'About 15 pieces',
      'up-tabkha-red': 'Serves 2–3',
    },
    addToRoyal: 'Add to your royal feast',
    coupleTitle: 'Shabbat Menu for Two',
    coupleSubtitle: 'A complete package: 4 salads, a first course, a main, a side, and dessert.',
    coupleCta: 'Order the Royal Package',
    dessertsTitle: 'A Sweet & Holy Finish',
    dessertsQuote: '"Honey and milk are under your tongue" — the sweet finale that seals the meal',
    dessertsImageAlt: 'Shabbat desserts',
    includedInPackage: 'Included in the Shabbat package',
    buildPackageCta: 'Build your package & choose a dessert',
    dvarTorahTitle: 'A Dvar Torah for Your Shabbat Table',
    dvarTorahQuote: '"Shabbat is the source of blessing. When we honor Shabbat with fine food, we open the channels of abundance for the whole week ahead."',
    footerLine: 'Kosher Luxury • Dubai • Est. 2024',
    cartBarLabel: 'Your royal order',
    cartBarCta: 'Checkout',
  },
  fr: {
    heroTitle: ['Sublimez', 'votre Chabbat'],
    heroSubtitle: 'La table de Chabbat est le cœur battant du foyer juif. Chez Bat Melech, chaque plat est une prière et chaque saveur, un lien avec nos racines.',
    heroImageAlt: 'Une table de Chabbat royale',
    heroQuote: '« Toute la gloire de la fille du roi est intérieure » — Kevouda bat mélekh penima',
    statKosherValue: '100%',
    statKosherLabel: 'Cacher Glatt',
    statChefValue: 'Chef',
    statChefLabel: 'Traditionnel',
    statRoyalValue: 'Royal',
    statRoyalLabel: 'Présentation',
    saladsTitle: 'Nos salades maison fraîches',
    saladsQuote: '« Tu béniras l\'Éternel ton Dieu pour ce bon pays » — une ouverture fraîche qui éveille les sens',
    firstsTitle: 'Entrées de fête',
    firstsQuote: '« Goûtez et voyez que l\'Éternel est bon » — des entrées qui vous plongent dans une ambiance royale',
    soldOut: 'Épuisé',
    addToOrder: 'Ajouter à la commande',
    royalKicker: 'Les Chefs-d\'Œuvre Royaux',
    royalTitle: 'Plats dignes des rois',
    royalQuote: '« En l\'honneur du saint Chabbat » — le joyau de votre table de Chabbat. Des plats mijotés avec amour et kedoucha.',
    specialsTitle: 'Les spécialités de Bat Melech',
    specialsSubtitle: 'Cuisson lente, ingrédients d\'exception et beaucoup d\'âme juive.',
    royalNotes: {
      'up-roast-beef': 'Pour 4 personnes',
      'special-kubbe-selek': 'Pour 4 personnes',
      'up-schnitzel-tray': 'Environ 15 pièces',
      'up-tabkha-red': 'Pour 2–3 personnes',
    },
    addToRoyal: 'Ajouter à votre table royale',
    coupleTitle: 'Menu Chabbat pour deux',
    coupleSubtitle: 'Une formule complète : 4 salades, une entrée, un plat, un accompagnement et un dessert.',
    coupleCta: 'Commander la formule royale',
    dessertsTitle: 'Une fin douce et sainte',
    dessertsQuote: '« Le miel et le lait sont sous ta langue » — la touche sucrée qui clôt le repas',
    dessertsImageAlt: 'Desserts de Chabbat',
    includedInPackage: 'Inclus dans le coffret Chabbat',
    buildPackageCta: 'Composer votre coffret et choisir un dessert',
    dvarTorahTitle: 'Un Dvar Torah pour votre table de Chabbat',
    dvarTorahQuote: '« Le Chabbat est la source de la bénédiction. En honorant le Chabbat par des mets raffinés, nous ouvrons les canaux d\'abondance pour toute la semaine à venir. »',
    footerLine: 'Luxe Casher • Dubaï • Depuis 2024',
    cartBarLabel: 'Votre commande royale',
    cartBarCta: 'Finaliser la commande',
  },
}

export function ShabbatExtras() {
  const { lines, addLine, setQty, subtotal } = useCart()
  const { isOutOfStock } = useSiteStatus()
  const { catalog, extraPriceUsd, dishByName } = useSiteCatalog()
  const navigate = useNavigate()
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  const count = lines.reduce((n, l) => n + l.qty, 0)

  const qtyOf = (id: string) => lines.find((l) => l.id === id)?.qty ?? 0

  const couplePrice = catalog?.couplePriceUsd ?? 230

  // When the live catalog has a category, its dishes (and their admin order)
  // ARE the rendered list — a dish added in the admin panel shows up here
  // with its photo and description with zero code changes. Hardcoded lists
  // survive only as the no-catalog fallback and as legacy id/image sources.
  const orderedSalads = useMemo<Salad[]>(
    () => catalogCards(catalog?.categories.salads, SALADS, 'catalog-salad'),
    [catalog],
  )
  const orderedFirstCourses = useMemo<Choice[]>(
    () =>
      catalogCards(catalog?.categories.firsts, FIRST_COURSES, 'catalog-first').map((card) => ({
        ...card,
        price: FIRST_COURSES.find((c) => c.name === card.name)?.price ?? FIRST_PRICE,
      })),
    [catalog],
  )

  // Live extras the page does not list yet, appended after the hardcoded
  // royal items. Extras without a price cannot be sold and are skipped;
  // dishes already rendered in a live category section are not repeated.
  const royalItems = useMemo<Royal[]>(() => {
    const knownNames = new Set<string>(
      [...SALADS, ...FIRST_COURSES, ...ROYAL, ...DESSERTS].map((item) => item.name),
    )
    if (catalog !== null) {
      for (const dishes of Object.values(catalog.categories)) {
        for (const dish of dishes) knownNames.add(dish.name)
      }
    }
    const liveExtras = (catalog?.extras ?? []).flatMap((extra): Royal[] =>
      !knownNames.has(extra.name) && extra.priceUsd !== null
        ? [{ id: `catalog-extra-${extra.name}`, name: extra.name, price: extra.priceUsd }]
        : [],
    )
    return [...ROYAL, ...liveExtras]
  }, [catalog])

  // Live price wins over the hardcoded one; the challah row also honors the
  // dedicated challah price field when it has no extras entry of its own.
  const royalPrice = (r: Royal) =>
    extraPriceUsd(r.name) ?? (r.id === 'up-challah' ? (catalog?.challahPriceUsd ?? r.price) : r.price)

  return (
    <div dir={dir} className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#F5A83A]/20 pb-48">
      <PageHero
        active="/shabbat-extras"
        size="tall"
        badge="Royal Catering Dubai"
        title={t.heroTitle}
        subtitle={t.heroSubtitle}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/nnwx4pzCGTT.jpeg"
        imageAlt={t.heroImageAlt}
      >
        <h2 className="text-2xl md:text-4xl font-black font-heading italic text-white/90 leading-tight tracking-tight mb-6">
          {t.heroQuote}
        </h2>
        <div className="flex items-center justify-center gap-4 md:gap-8 pt-4 md:pt-6 border-t border-white/10 text-white">
          <div className="text-center">
            <div className="text-[#F5A83A] font-black text-lg md:text-2xl">{t.statKosherValue}</div>
            <div className="text-[10px] uppercase tracking-widest opacity-50">{t.statKosherLabel}</div>
          </div>
          <div className="w-px h-8 md:h-10 bg-white/10" />
          <div className="text-center">
            <div className="text-[#F5A83A] font-black text-lg md:text-2xl">{t.statChefValue}</div>
            <div className="text-[10px] uppercase tracking-widest opacity-50">{t.statChefLabel}</div>
          </div>
          <div className="w-px h-8 md:h-10 bg-white/10" />
          <div className="text-center">
            <div className="text-[#F5A83A] font-black text-lg md:text-2xl">{t.statRoyalValue}</div>
            <div className="text-[10px] uppercase tracking-widest opacity-50">{t.statRoyalLabel}</div>
          </div>
        </div>
      </PageHero>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-12 space-y-24 md:space-y-40">
        <div>
          <CurrencyNote className="mb-12 md:mb-16" />
          <SectionIntro icon="ph:leaf-fill" iconBg="light" n={1} title={t.saladsTitle} quote={t.saladsQuote} />
        </div>
        <div className="bg-white rounded-[2.5rem] md:rounded-[4rem] p-6 md:p-12 shadow-xl border border-[#3B151A]/5 -mt-16 md:-mt-28">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 md:gap-8">
            {orderedSalads.map((s) => {
              const qty = qtyOf(s.id)
              const soldOut = isOutOfStock(s.name)
              const dish = dishByName(s.name)
              const price = extraPriceUsd(s.name) ?? SALAD_PRICE
              const img = dish?.imageUrl ?? s.img
              const displayName = dishName(s.name, locale)
              return (
                <div key={s.id} className="flex flex-col items-center group">
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => addLine({ id: s.id, name: s.name, displayName, unitPrice: price })}
                    className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden mb-3 md:mb-4 ring-4 ring-[#F7ECE6] transition-all duration-500 relative enabled:group-hover:ring-[#F5A83A] disabled:cursor-not-allowed"
                  >
                    {img !== null ? (
                      <img src={img} alt={displayName} loading="lazy" className={`w-full h-full object-cover ${soldOut ? 'grayscale opacity-50' : ''}`} />
                    ) : (
                      <span className={`w-full h-full flex items-center justify-center bg-[#3B151A]/5 text-[#F5A83A] ${soldOut ? 'opacity-50' : ''}`}>
                        <Icon icon="ph:bowl-food-fill" className="text-3xl md:text-4xl" />
                      </span>
                    )}
                    {qty > 0 && (
                      <span className="absolute inset-0 bg-[#3B151A]/50 flex items-center justify-center text-white font-black text-xl">
                        {qty}
                      </span>
                    )}
                  </button>
                  <span className="font-black text-xs md:text-sm text-center">{displayName}</span>
                  {dish !== null && dish.description !== '' && (
                    <span className="text-[10px] font-bold text-[#3B151A]/50 text-center mt-1 leading-snug">{dish.description}</span>
                  )}
                  {soldOut ? (
                    <OutOfStockBadge className="mt-2" />
                  ) : (
                    <span className="text-[#F5A83A] font-bold text-xs mt-1">${price}</span>
                  )}
                  {qty === 0 ? (
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => addLine({ id: s.id, name: s.name, displayName, unitPrice: price })}
                      className="mt-3 w-11 h-11 rounded-full border border-[#3B151A]/10 flex items-center justify-center transition-colors enabled:hover:bg-[#3B151A] enabled:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Icon icon="ph:plus" />
                    </button>
                  ) : (
                    <div className="mt-3 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQty(s.id, qty - 1)}
                        className="w-11 h-11 rounded-full bg-[#F7ECE6] flex items-center justify-center"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => setQty(s.id, qty + 1)}
                        className="w-11 h-11 rounded-full bg-[#3B151A] text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Icon icon="ph:plus" className="text-xs" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <SectionIntro icon="ph:star-fill" iconBg="dark" n={2} title={t.firstsTitle} quote={t.firstsQuote} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 -mt-16 md:-mt-28">
          {orderedFirstCourses.map((c) => {
            const qty = qtyOf(c.id)
            const soldOut = isOutOfStock(c.name)
            const dish = dishByName(c.name)
            const price = extraPriceUsd(c.name) ?? c.price
            const img = dish?.imageUrl ?? c.img
            const displayName = dishName(c.name, locale)
            return (
              <div key={c.id} className="bg-white rounded-[2.5rem] md:rounded-[3.5rem] overflow-hidden shadow-xl border border-[#3B151A]/5 group">
                <div className="h-48 md:h-64 overflow-hidden relative bg-[#F7ECE6]">
                  {img !== null ? (
                    <img
                      src={img}
                      alt={displayName}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none'
                      }}
                      className={`w-full h-full object-cover transition-transform duration-700 ${soldOut ? 'grayscale opacity-60' : 'group-hover:scale-110'}`}
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-[#F7ECE6] text-[#F5A83A] ${soldOut ? 'opacity-60' : ''}`}>
                      <Icon icon="ph:fish-simple-fill" className="text-6xl md:text-8xl" />
                    </div>
                  )}
                  {soldOut && <OutOfStockBadge className="absolute bottom-4 end-4" />}
                </div>
                <div className="p-6 md:p-8 space-y-3 md:space-y-4 text-center">
                  <h4 className="text-xl md:text-2xl font-black font-heading">{displayName}</h4>
                  {dish !== null && dish.description !== '' && (
                    <p className="text-sm font-bold text-[#3B151A]/50 leading-relaxed">{dish.description}</p>
                  )}
                  <div className="flex items-center justify-center gap-4 md:gap-6 pt-2 md:pt-4">
                    <span className="text-xl md:text-2xl font-black text-[#F5A83A]">${price}</span>
                    {qty === 0 ? (
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => addLine({ id: c.id, name: c.name, displayName, unitPrice: price })}
                        className="bg-[#3B151A] text-white px-6 md:px-8 py-2.5 md:py-3 rounded-full font-black text-xs transition-all enabled:hover:bg-[#F5A83A] disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {soldOut ? t.soldOut : t.addToOrder}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 bg-[#F7ECE6] rounded-full px-4 py-2">
                        <button type="button" onClick={() => setQty(c.id, qty - 1)} className="font-black">−</button>
                        <span className="font-black flex items-center gap-1">
                          <Icon icon="ph:check-bold" className="text-[#F5A83A]" /> {qty}
                        </span>
                        <button
                          type="button"
                          disabled={soldOut}
                          onClick={() => setQty(c.id, qty + 1)}
                          className="font-black disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <section className="space-y-16 md:space-y-24 py-16 md:py-32 px-5 md:px-10 bg-[#3B151A] rounded-[3rem] md:rounded-[5rem] text-white shadow-[0_60px_120px_rgba(59,21,26,0.6)] relative overflow-hidden">
          <img src={LOGO_URL} alt="" className="absolute -bottom-20 -left-20 h-[300px] md:h-[500px] opacity-10 rotate-12" />
          <div className="absolute top-0 right-0 w-[300px] h-[300px] md:w-[600px] md:h-[600px] bg-[#F5A83A]/5 rounded-full blur-[200px] translate-x-1/2 -translate-y-1/2" />
          <div className="text-center space-y-4 md:space-y-6 relative z-10">
            <div className="w-16 h-16 md:w-24 md:h-24 rounded-full bg-[#F5A83A] flex items-center justify-center text-[#3B151A] mx-auto mb-4 md:mb-8 shadow-2xl">
              <Icon icon="ph:crown-fill" className="text-3xl md:text-5xl" />
            </div>
            <span className="text-[#F5A83A] text-xs md:text-sm font-black uppercase tracking-[0.5em] md:tracking-[0.8em] block">
              {t.royalKicker}
            </span>
            <h3 className="text-4xl md:text-9xl font-black font-heading tracking-tighter">{t.royalTitle}</h3>
            <p className="text-lg md:text-3xl font-bold text-white/50 italic max-w-3xl mx-auto">
              {t.royalQuote}
            </p>
            <div className="w-24 md:w-32 h-1 bg-[#F5A83A] mx-auto mt-8 md:mt-12 opacity-50" />
          </div>

          <div className="relative z-10 rounded-[2.5rem] md:rounded-[4rem] overflow-hidden h-[260px] md:h-[500px] shadow-2xl border-4 md:border-8 border-white/5 mb-16 md:mb-24">
            <img
              src="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/LN9pezK0tQH.jpeg"
              alt={t.specialsTitle}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#3B151A] via-transparent to-transparent" />
            <div className="absolute bottom-6 md:bottom-12 end-6 md:end-12 text-start">
              <h4 className="text-2xl md:text-5xl font-black font-heading mb-2 md:mb-4">{t.specialsTitle}</h4>
              <p className="text-sm md:text-xl font-bold text-white/60 italic">{t.specialsSubtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 md:gap-x-32 gap-y-8 md:gap-y-20 relative z-10">
            {royalItems.map((r) => {
              const qty = qtyOf(r.id)
              const soldOut = isOutOfStock(r.name)
              const dish = dishByName(r.name)
              const price = royalPrice(r)
              const displayName = dishName(r.name, locale)
              const note = t.royalNotes[r.id] ?? r.note
              return (
                <div key={r.id} className="space-y-4 md:space-y-6 group">
                  {dish !== null && dish.imageUrl !== null && (
                    <img
                      src={dish.imageUrl}
                      alt={displayName}
                      loading="lazy"
                      className="w-20 h-20 md:w-28 md:h-28 rounded-2xl md:rounded-[2rem] object-cover shadow-2xl border border-white/10"
                    />
                  )}
                  <div className="flex items-baseline justify-between gap-4 md:gap-6 border-b border-white/10 pb-4 md:pb-6">
                    <h4 className={`text-xl md:text-4xl font-black font-heading transition-colors ${soldOut ? 'text-white/40' : 'group-hover:text-[#F5A83A]'}`}>
                      {displayName}
                    </h4>
                    <span className="text-xl md:text-3xl font-black text-[#F5A83A] shrink-0">${price}</span>
                  </div>
                  {soldOut && <OutOfStockBadge />}
                  {note && <p className="text-sm md:text-xl font-bold text-white/40 italic leading-relaxed">{note}</p>}
                  {dish !== null && dish.description !== '' && (
                    <p className="text-sm md:text-lg font-bold text-white/50 leading-relaxed">{dish.description}</p>
                  )}
                  {qty === 0 ? (
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => addLine({ id: r.id, name: r.name, displayName, unitPrice: price })}
                      className="bg-[#F5A83A] text-white px-8 md:px-16 py-3 md:py-5 rounded-full font-black text-xs md:text-sm tracking-widest uppercase transition-all shadow-2xl enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {t.addToRoyal}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 md:gap-4 bg-white/10 rounded-full px-5 md:px-8 py-2.5 md:py-3.5 w-fit">
                      <button type="button" onClick={() => setQty(r.id, qty - 1)} className="font-black text-lg">−</button>
                      <span className="font-black flex items-center gap-2 text-[#F5A83A]">
                        <Icon icon="ph:check-bold" /> {qty}
                      </span>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => setQty(r.id, qty + 1)}
                        className="font-black text-lg disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-16 md:mt-32 bg-white/5 rounded-[2.5rem] md:rounded-[4rem] p-8 md:p-16 text-center border border-white/10 backdrop-blur-sm">
            <h4 className="text-2xl md:text-4xl font-black font-heading text-[#F5A83A] mb-4 md:mb-6 underline decoration-[#F5A83A]/30 underline-offset-8">
              {t.coupleTitle}
            </h4>
            <div className="text-4xl md:text-6xl font-black mb-6 md:mb-8">
              ${couplePrice} <span className="text-lg md:text-2xl align-middle text-white/50">USD</span>
            </div>
            <p className="text-sm md:text-lg font-bold text-white/60 mb-8 md:mb-12 italic">
              {t.coupleSubtitle}
            </p>
            <Link
              to={href('/shabbat-order')}
              className="bg-white text-[#3B151A] px-10 md:px-20 py-4 md:py-6 rounded-full font-black text-lg md:text-2xl hover:bg-[#F5A83A] hover:text-white transition-all shadow-[0_20px_50px_rgba(245,168,58,0.3)] flex items-center gap-3 md:gap-4 mx-auto uppercase w-fit"
            >
              {t.coupleCta} <Icon icon="ph:heart-fill" />
            </Link>
          </div>
        </section>

        <SectionIntro icon="ph:cookie-fill" iconBg="light" n={3} title={t.dessertsTitle} quote={t.dessertsQuote} />
        <div className="bg-white rounded-[2.5rem] md:rounded-[4rem] overflow-hidden shadow-2xl border border-[#3B151A]/5 -mt-16 md:-mt-28">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <div className="h-[220px] md:h-[400px] overflow-hidden">
              <img
                src="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/q97J0XWOoFu.jpeg"
                alt={t.dessertsImageAlt}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-8 md:p-16 flex flex-col justify-center space-y-6 md:space-y-10">
              {DESSERTS.map((d, i) => {
                const soldOut = isOutOfStock(d.name)
                const dish = dishByName(d.name)
                const img = dish?.imageUrl ?? d.img
                const displayName = dishName(d.name, locale)
                return (
                  <div key={d.id} className={`space-y-2 md:space-y-4 group ${i === 0 ? 'border-b border-[#3B151A]/5 pb-6 md:pb-8' : ''}`}>
                    <div className="flex items-center gap-4">
                      <img src={img} alt={displayName} loading="lazy" className={`w-16 h-16 rounded-2xl object-cover shrink-0 ${soldOut ? 'grayscale opacity-60' : ''}`} />
                      <h4 className="text-lg md:text-3xl font-black font-heading group-hover:text-[#F5A83A] transition-colors">{displayName}</h4>
                    </div>
                    {dish !== null && dish.description !== '' && (
                      <p className="text-sm md:text-base font-bold text-[#3B151A]/50 leading-relaxed">{dish.description}</p>
                    )}
                    {soldOut ? (
                      <OutOfStockBadge />
                    ) : (
                      <span className="inline-block text-xs font-black uppercase tracking-widest text-[#F5A83A] bg-[#F5A83A]/10 px-3 py-1 rounded-full">
                        {t.includedInPackage}
                      </span>
                    )}
                  </div>
                )
              })}
              <Link
                to={href('/shabbat-order')}
                className="text-xs font-black uppercase tracking-widest text-[#3B151A] hover:text-[#F5A83A] transition-colors flex items-center gap-2 w-fit"
              >
                {t.buildPackageCta} <Icon icon={dir === 'rtl' ? 'ph:arrow-left-bold' : 'ph:arrow-right-bold'} />
              </Link>
            </div>
          </div>
        </div>

        <section className="py-16 md:py-32 border-t-4 border-[#3B151A]/5 text-center space-y-10 md:space-y-16">
          <div className="bg-[#3B151A] rounded-[2.5rem] md:rounded-[4rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden flex flex-col items-center max-w-4xl mx-auto">
            <Icon icon="ph:scroll-fill" className="text-5xl md:text-8xl text-[#F5A83A] mb-5 md:mb-8" />
            <h4 className="text-2xl md:text-4xl font-black font-heading text-[#F5A83A] mb-4 md:mb-6 italic">{t.dvarTorahTitle}</h4>
            <p className="text-lg md:text-3xl font-bold italic leading-relaxed max-w-3xl">
              {t.dvarTorahQuote}
            </p>
            <div className="h-[3px] w-20 md:w-24 bg-[#F5A83A] my-7 md:my-10" />
            <img src={LOGO_URL} alt="" className="h-20 md:h-32 opacity-50 mb-4 md:mb-6" />
            <p className="text-[9px] md:text-xs font-black text-white/40 uppercase tracking-[0.5em] md:tracking-[0.8em]">
              {t.footerLine}
            </p>
          </div>
        </section>
      </main>

      {count > 0 && (
      <div className="fixed bottom-4 md:bottom-10 left-4 right-4 md:left-6 md:right-6 z-[200] max-w-2xl mx-auto">
        <div className="bg-[#3B151A]/95 backdrop-blur-3xl rounded-[2rem] md:rounded-[3rem] p-3 md:p-4 pe-6 md:pe-12 flex items-center justify-between shadow-[0_50px_100px_rgba(0,0,0,0.4)] border border-white/10">
          <div className="text-white">
            <div className="text-[9px] md:text-[11px] font-black uppercase tracking-[0.2em] md:tracking-[0.3em] opacity-40 mb-1">
              {t.cartBarLabel}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl md:text-4xl font-black text-[#F5A83A]">${subtotal.toFixed(2).replace(/\.00$/, '')}</span>
              <span className="text-[10px] md:text-xs font-bold opacity-30">USD</span>
            </div>
          </div>
          <button
            type="button"
            disabled={count === 0}
            onClick={() => navigate(href('/checkout'))}
            className="bg-[#F5A83A] text-white px-6 md:px-16 py-3 md:py-6 rounded-full font-black text-base md:text-2xl shadow-2xl hover:scale-[1.05] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2 md:gap-4 group"
          >
            {t.cartBarCta} <Icon icon="ph:crown-fill" className="group-hover:rotate-12 transition-transform text-lg md:text-3xl" />
          </button>
        </div>
      </div>
      )}
    </div>
  )
}

function SectionIntro({
  icon,
  iconBg,
  n,
  title,
  quote,
}: {
  icon: string
  iconBg: 'light' | 'dark'
  n: number
  title: string
  quote: string
}) {
  return (
    <div className="flex flex-col items-center text-center space-y-3 md:space-y-4">
      <div
        className={`w-14 h-14 md:w-20 md:h-20 rounded-full flex items-center justify-center mb-2 md:mb-4 ${
          iconBg === 'dark' ? 'bg-[#3B151A] text-[#F5A83A] shadow-xl' : 'bg-[#F7ECE6] text-[#F5A83A] shadow-inner'
        }`}
      >
        <Icon icon={icon} className="text-2xl md:text-4xl" />
      </div>
      <span className="text-[#F5A83A] text-xs md:text-sm font-black uppercase tracking-[0.3em] md:tracking-[0.4em]">
        Section 0{n}
      </span>
      <h3 className="text-3xl md:text-6xl font-black font-heading">{title}</h3>
      <p className="text-base md:text-xl font-bold text-[#3B151A]/40 italic max-w-xl mx-auto">{quote}</p>
    </div>
  )
}
