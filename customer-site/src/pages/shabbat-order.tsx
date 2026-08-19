import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useNavigate } from 'react-router'
import { PageHero } from '../components/page-hero'
import { CurrencyNote } from '../components/currency-note'
import { Photo } from '../components/photo'
import { OutOfStockBadge } from '../components/out-of-stock-badge'
import { useCart } from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { useSiteCatalog, type CatalogDish } from '../catalog-context'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

const BASE_PRICE = 230
const INCLUDED_SALADS = 4
const SALAD_EXTRA_PRICE = 6.25
const INCLUDED_FIRST = 1
const FIRST_EXTRA_PRICE = 25
const INCLUDED_MAIN = 1
const MAIN_EXTRA_PRICE = 45

/** The canonical Hebrew name of the whole package — the cart/order key. */
const PACKAGE_NAME_HE = 'מארז שבת זוגי יוקרתי'

type Allergy = 'gluten' | 'gluten-free' | 'egg' | 'spicy'
type Option = {
  id: string
  /** Canonical HEBREW dish name — stock/catalog/order key. Never localized. */
  name: string
  img: string
  allergy?: Allergy
  realPhoto?: boolean
  description?: string
}

const SALADS: Option[] = [
  { id: 'salad-cabbage-white', name: 'כרוב לבן קלאסי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-38-tn6OonVbOX3.jpeg', allergy: 'gluten-free' },
  { id: 'salad-cabbage-purple', name: 'כרוב סגול במיונז', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-381-bR993g9VsLN.jpeg', allergy: 'egg' },
  { id: 'salad-coleslaw', name: 'קולסלאו', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/FV0qotWV27P.jpeg', allergy: 'egg' },
  { id: 'salad-matbucha', name: 'מטבוחה פיקנטית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/cVEz0yFtGoP.jpeg', allergy: 'spicy' },
  { id: 'salad-chirshi', name: "צ'ירשי טריפוליטאי", img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/LkkkAnY1xCn.jpeg' },
  { id: 'salad-meshwiya', name: 'משוויה מרוקאית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/suiaqbglZMf.jpeg', allergy: 'spicy' },
  { id: 'salad-msir', name: 'מסייר (חמוצים)', img: '/site/assets/pickles-real.jpg', realPhoto: true },
  { id: 'salad-tahini', name: 'טחינה', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/7GjgJuaYjlq.jpeg' },
  { id: 'salad-beet', name: 'סלק מבושל', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/twpm8363MgJ.jpeg' },
  { id: 'salad-carrot', name: 'גזר מרוקאי מבושל', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ktV7lQAiCxj.jpeg', allergy: 'spicy' },
  { id: 'salad-eggplant-mayo', name: 'חציל במיונז', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ArFGA1BIJAz.jpeg', allergy: 'egg' },
  { id: 'salad-eggplant-fried', name: 'חציל מטוגן', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/oIpRFnfrVKc.jpeg' },
  { id: 'salad-pepper-roasted', name: 'פלפלים קלויים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-371-liCX1e96i1L.jpeg' },
  { id: 'salad-cherry-spicy', name: 'עגבניות שרי חריפות', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Cb9z6EshGnU.jpeg', allergy: 'spicy' },
  { id: 'salad-pepper-hot', name: 'פלפל חריף צלוי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/M6PCfCukw4f.jpeg', allergy: 'spicy' },
  { id: 'salad-egg', name: 'סלט ביצים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Vz9NyTP6CaJ.jpeg', allergy: 'egg' },
  { id: 'salad-potato', name: 'סלט תפו"א', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/yt88LuvAVmz.jpeg', allergy: 'egg' },
]

const FIRST_COURSES: Option[] = [
  { id: 'first-fish-pair', name: 'זוג פילה דג בר טרי (חריימה/מרוקאי)', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/DNV0D2JBB1h.jpeg', allergy: 'gluten-free' },
  { id: 'first-fish-balls', name: 'קציצות דגים ברוטב מרוקאי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/1UoTNxPxBpB.jpeg' },
]

const MAIN_COURSES: Option[] = [
  { id: 'main-meat-red', name: 'קציצות בשר ברוטב אדום עשיר', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-40-yVr6wFVvFkl.jpeg', allergy: 'gluten' },
  { id: 'main-meat-pea', name: 'קציצות בשר עם אפונה וארטישוק', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/nQX6y7PSyNL.jpeg' },
  { id: 'main-meat-chestnut', name: 'קציצות בשר בריבת בצל וערמונים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/qVICFmHhkmz.jpeg' },
  { id: 'main-chicken-red', name: 'טבחה עוף אדומה עם שעועית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/d31Kxj4sAHE.jpeg' },
  { id: 'main-chicken-morocco', name: 'תבשיל עוף מרוקאי עם חומוסים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ZBzRBV0QnjT.jpeg' },
  { id: 'main-chicken-yellow', name: 'טבחה עוף צהובה עם תפו"א', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/00bCUcj59KN.jpeg' },
]

const SIDES: Option[] = [
  { id: 'side-rice-white', name: 'אורז לבן', img: '' },
  { id: 'side-rice-persian', name: 'אורז פרסי עם עשבי תיבול', img: '' },
  { id: 'side-couscous', name: 'קוסקוס עננים', img: '' },
]

const DESSERTS: Option[] = [
  { id: 'dessert-baklava', name: 'סוכריות בקלאווה', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/JCOJo8pP96p.jpeg' },
  { id: 'dessert-souffle', name: 'סופלה שוקולד', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/MmM6NDYjm66.jpeg' },
]

const ALLERGY_ICON: Record<string, string> = {
  'gluten-free': 'ph:check-circle-bold',
  egg: 'ph:egg-bold',
  spicy: 'ph:pepper-bold',
  gluten: 'ph:bread-bold',
}

// Display names for the few Hebrew keys on this page that are spelled
// slightly differently from the canonical entries in dish-names.ts. Used
// only when the central dishName() falls back to the Hebrew original —
// the central map always wins when it knows the name.
const LOCAL_DISH_NAMES: Readonly<Record<string, { en: string; fr: string }>> = {
  'זוג פילה דג בר טרי (חריימה/מרוקאי)': {
    en: 'Pair of Fresh Sea Bream Fillets (Chraime or Moroccan Sauce)',
    fr: 'Duo de filets de daurade fraîche (chraïmé ou sauce marocaine)',
  },
  'אורז פרסי עם עשבי תיבול': { en: 'Persian Herbed Rice', fr: 'Riz persan aux herbes' },
  'סוכריות בקלאווה': { en: 'Baklava Bites', fr: 'Bouchées de baklawa' },
}

function displayDish(hebrewName: string, locale: Locale): string {
  const central = dishName(hebrewName, locale)
  if (central !== hebrewName || locale === 'he') return central
  return LOCAL_DISH_NAMES[hebrewName]?.[locale] ?? hebrewName
}

const HE = {
  heroBadge: 'The Shabbat Experience',
  heroTitle: ['מארז שבת', 'זוגי יוקרתי'] as [string, string],
  heroSubtitle: 'הרכיבו לעצמכם את מארז הקידוש המושלם - כשר, טרי ומגיע עד אליכם.',
  heroImageAlt: 'מארז שבת זוגי יוקרתי כשר בדובאי - מטעמי בת מלך',
  intro: 'ארוחת שבת כשרה בדובאי, מבושלת טרי ומגיעה עד אליכם — סלטים, מנה ראשונה, עיקרית וקינוח למארז זוגי מלא.',
  extrasLink: 'לא רוצים חבילה שלמה? לחיזוקים לסופ״ש — מנות בודדות בלי התחייבות',
  infoTitle: 'שיטת הבחירה במארז',
  infoBody: (basePrice: number) =>
    `המחיר הבסיסי ($${basePrice} USD) כולל: 4 סלטים, מנה ראשונה אחת, עיקרית אחת, תוספת אחת וקינוח אחד.`,
  infoBody2: 'כל בחירה מעבר למכסה מתווספת אוטומטית למחיר למטה.',
  saladsTitle: 'סלטים טריים',
  saladsHint: `יש לבחור לפחות 4 (סלט חמישי ומעלה: $${SALAD_EXTRA_PRICE} ליחידה)`,
  firstsTitle: 'מנות ראשונות',
  firstsHint: `מנה שניה ומעלה: $${FIRST_EXTRA_PRICE} ליחידה`,
  mainsTitle: 'עיקריות לשבת',
  mainsHint: `מנה שניה ומעלה: $${MAIN_EXTRA_PRICE} ליחידה`,
  sidesTitle: 'תוספות לעיקריות',
  sidesHint: 'יש לבחור תוספת אחת',
  dessertsTitle: 'סיום מתוק (פרווה)',
  dessertsHint: 'יש לבחור מנה אחת',
  extraSalads: (amount: string, count: number) => `+$${amount} עבור ${count} סלטים נוספים`,
  extraFirsts: (amount: number, count: number) => `+$${amount} עבור ${count} מנות נוספות`,
  extraMains: (amount: number, count: number) => `+$${amount} עבור ${count} מנות נוספות`,
  missingSalads: (left: number) => (left === 1 ? 'עוד סלט אחד' : `עוד ${left} סלטים`),
  missingFirst: 'מנה ראשונה',
  missingMain: 'מנה עיקרית',
  missingSide: 'תוספת',
  missingDessert: 'קינוח',
  soldOutLabel: (names: string) => `אזל מהמלאי: ${names}`,
  missingLabel: (list: string) => `חסר: ${list}`,
  summaryReady: 'סיכום הזמנה',
  packageName: 'מארז שבת זוגי יוקרתי',
  continueCta: 'המשך להזמנה',
  noteLabels: {
    salads: 'סלטים',
    first: 'ראשונה',
    main: 'עיקרית',
    side: 'תוספת',
    dessert: 'קינוח',
  },
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    heroBadge: 'The Shabbat Experience',
    heroTitle: ['Premium Shabbat', 'Box for Two'],
    heroSubtitle: 'Build your perfect Shabbat table — kosher, freshly cooked, and delivered to your door.',
    heroImageAlt: 'Premium kosher Shabbat box for two in Dubai — Bat Melech Delights',
    intro: 'A complete kosher Shabbat dinner in Dubai, cooked fresh and delivered to you — salads, a first course, a main, a side, and dessert in one full box for two.',
    extrasLink: 'Not looking for the full box? Weekend Boosters — individual dishes, no commitment',
    infoTitle: 'How the Box Works',
    infoBody: (basePrice: number) =>
      `The base price ($${basePrice} USD) includes: 4 salads, 1 first course, 1 main course, 1 side, and 1 dessert.`,
    infoBody2: 'Anything you choose beyond the included quota is automatically added to the total below.',
    saladsTitle: 'Fresh Salads',
    saladsHint: `Choose at least 4 (5th salad and up: $${SALAD_EXTRA_PRICE} each)`,
    firstsTitle: 'First Courses',
    firstsHint: `Second course and up: $${FIRST_EXTRA_PRICE} each`,
    mainsTitle: 'Shabbat Mains',
    mainsHint: `Second main and up: $${MAIN_EXTRA_PRICE} each`,
    sidesTitle: 'Sides for the Mains',
    sidesHint: 'Choose one side',
    dessertsTitle: 'A Sweet Finish (Pareve)',
    dessertsHint: 'Choose one dessert',
    extraSalads: (amount: string, count: number) =>
      `+$${amount} for ${count} extra salad${count === 1 ? '' : 's'}`,
    extraFirsts: (amount: number, count: number) =>
      `+$${amount} for ${count} extra course${count === 1 ? '' : 's'}`,
    extraMains: (amount: number, count: number) =>
      `+$${amount} for ${count} extra main${count === 1 ? '' : 's'}`,
    missingSalads: (left: number) => (left === 1 ? '1 more salad' : `${left} more salads`),
    missingFirst: 'a first course',
    missingMain: 'a main course',
    missingSide: 'a side',
    missingDessert: 'a dessert',
    soldOutLabel: (names: string) => `Sold out: ${names}`,
    missingLabel: (list: string) => `Still needed: ${list}`,
    summaryReady: 'Order Summary',
    packageName: 'Premium Shabbat Box for Two',
    continueCta: 'Continue to Order',
    noteLabels: {
      salads: 'Salads',
      first: 'First course',
      main: 'Main',
      side: 'Side',
      dessert: 'Dessert',
    },
  },
  fr: {
    heroBadge: "L'expérience Chabbat",
    heroTitle: ['Coffret Chabbat', 'Prestige pour deux'],
    heroSubtitle: 'Composez votre table de Chabbat idéale — casher, cuisinée le jour même et livrée jusque chez vous.',
    heroImageAlt: 'Coffret Chabbat prestige casher pour deux à Dubaï — Bat Melech',
    intro: "Un dîner de Chabbat casher complet à Dubaï, cuisiné frais et livré chez vous — salades, entrée, plat, accompagnement et dessert dans un coffret pour deux.",
    extrasLink: "Vous ne souhaitez pas le coffret complet ? Nos extras du week-end — plats à l'unité, sans engagement",
    infoTitle: 'Comment composer votre coffret',
    infoBody: (basePrice: number) =>
      `Le prix de base ($${basePrice} USD) comprend : 4 salades, 1 entrée, 1 plat, 1 accompagnement et 1 dessert.`,
    infoBody2: "Toute sélection au-delà du quota inclus s'ajoute automatiquement au total ci-dessous.",
    saladsTitle: 'Salades fraîches',
    saladsHint: `Choisissez-en au moins 4 (à partir de la 5e : $${SALAD_EXTRA_PRICE} l'unité)`,
    firstsTitle: 'Entrées',
    firstsHint: `À partir de la 2e : $${FIRST_EXTRA_PRICE} l'unité`,
    mainsTitle: 'Plats de Chabbat',
    mainsHint: `À partir du 2e : $${MAIN_EXTRA_PRICE} l'unité`,
    sidesTitle: 'Accompagnements',
    sidesHint: 'Choisissez un accompagnement',
    dessertsTitle: 'Douceur finale (parvé)',
    dessertsHint: 'Choisissez un dessert',
    extraSalads: (amount: string, count: number) =>
      `+$${amount} pour ${count === 1 ? '1 salade supplémentaire' : `${count} salades supplémentaires`}`,
    extraFirsts: (amount: number, count: number) =>
      `+$${amount} pour ${count === 1 ? '1 entrée supplémentaire' : `${count} entrées supplémentaires`}`,
    extraMains: (amount: number, count: number) =>
      `+$${amount} pour ${count === 1 ? '1 plat supplémentaire' : `${count} plats supplémentaires`}`,
    missingSalads: (left: number) => (left === 1 ? 'encore une salade' : `encore ${left} salades`),
    missingFirst: 'une entrée',
    missingMain: 'un plat',
    missingSide: 'un accompagnement',
    missingDessert: 'un dessert',
    soldOutLabel: (names: string) => `Épuisé : ${names}`,
    missingLabel: (list: string) => `Il manque : ${list}`,
    summaryReady: 'Récapitulatif',
    packageName: 'Coffret Chabbat Prestige pour deux',
    continueCta: 'Continuer la commande',
    noteLabels: {
      salads: 'Salades',
      first: 'Entrée',
      main: 'Plat',
      side: 'Accompagnement',
      dessert: 'Dessert',
    },
  },
}

/**
 * Hardcoded lists stay the fallback; when the live catalog has dishes for a
 * category they replace the list, keeping local ids/photos/allergy badges for
 * names that still match. Photos and descriptions are overridden either way.
 */
function mergeOptions(
  local: Option[],
  live: CatalogDish[] | undefined,
  dishByName: (name: string) => CatalogDish | null,
  idPrefix: string,
): Option[] {
  if (live === undefined || live.length === 0) {
    return local.map((item) => {
      const dish = dishByName(item.name)
      if (dish === null) return item
      return {
        ...item,
        img: dish.imageUrl ?? item.img,
        realPhoto: dish.imageUrl !== null ? true : item.realPhoto,
        description: dish.description !== '' ? dish.description : item.description,
      }
    })
  }
  return live.map((dish) => {
    // Matching stays by the canonical Hebrew name; only rendering localizes.
    const match = local.find((item) => item.name === dish.name)
    return {
      id: match?.id ?? `${idPrefix}-${dish.name}`,
      name: dish.name,
      img: dish.imageUrl ?? match?.img ?? '',
      allergy: match?.allergy,
      realPhoto: dish.imageUrl !== null ? true : match?.realPhoto,
      description: dish.description !== '' ? dish.description : match?.description,
    }
  })
}

export function ShabbatOrder() {
  const { addLine } = useCart()
  const { isOutOfStock } = useSiteStatus()
  const { catalog, dishByName } = useSiteCatalog()
  const navigate = useNavigate()
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]

  const basePrice = catalog?.couplePriceUsd ?? BASE_PRICE
  const saladOptions = useMemo(() => mergeOptions(SALADS, catalog?.categories.salads, dishByName, 'catalog-salad'), [catalog, dishByName])
  const firstOptions = useMemo(() => mergeOptions(FIRST_COURSES, catalog?.categories.firsts, dishByName, 'catalog-first'), [catalog, dishByName])
  const mainOptions = useMemo(() => mergeOptions(MAIN_COURSES, catalog?.categories.mains, dishByName, 'catalog-main'), [catalog, dishByName])
  const sideOptions = useMemo(() => mergeOptions(SIDES, catalog?.categories.sides, dishByName, 'catalog-side'), [catalog, dishByName])
  const dessertOptions = useMemo(() => mergeOptions(DESSERTS, catalog?.categories.desserts, dishByName, 'catalog-dessert'), [catalog, dishByName])

  const [salads, setSalads] = useState<Set<string>>(new Set())
  const [firstQty, setFirstQty] = useState<Record<string, number>>({})
  const [mainQty, setMainQty] = useState<Record<string, number>>({})
  const [side, setSide] = useState<string>('')
  const [dessert, setDessert] = useState<string>('')

  const toggleSalad = (id: string) =>
    setSalads((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
      total: basePrice + saladExtraN + firstExtraN + mainExtraN,
    }
  }, [salads, firstCount, mainCount, basePrice])

  const missing: string[] = []
  if (salads.size < INCLUDED_SALADS) {
    missing.push(t.missingSalads(INCLUDED_SALADS - salads.size))
  }
  if (firstCount < INCLUDED_FIRST) missing.push(t.missingFirst)
  if (mainCount < INCLUDED_MAIN) missing.push(t.missingMain)
  if (!side) missing.push(t.missingSide)
  if (!dessert) missing.push(t.missingDessert)

  // An item can sell out after it was picked (the status call lands late, or a
  // second tab marks it). The picks stay put — the builder just refuses to
  // continue until they are swapped out.
  const soldOutPicks = [
    ...saladOptions.filter((s) => salads.has(s.id)),
    ...firstOptions.filter((c) => (firstQty[c.id] ?? 0) > 0),
    ...mainOptions.filter((c) => (mainQty[c.id] ?? 0) > 0),
    ...sideOptions.filter((s) => s.id === side),
    ...dessertOptions.filter((d) => d.id === dessert),
  ].filter((item) => isOutOfStock(item.name))

  const canContinue = missing.length === 0 && soldOutPicks.length === 0

  const handleContinue = () => {
    if (!canContinue) return
    // The note travels to the kitchen: dish references always carry the
    // canonical Hebrew name — localized display names go in parentheses-free
    // form for Hebrew, and as "Display (עברית)" for other locales.
    const noteDish = (name: string) => (locale === 'he' ? name : `${displayDish(name, locale)} (${name})`)
    const saladNames = saladOptions.filter((s) => salads.has(s.id)).map((s) => noteDish(s.name))
    const firstNames = firstOptions.filter((c) => (firstQty[c.id] ?? 0) > 0).map((c) => `${noteDish(c.name)} x${firstQty[c.id]}`)
    const mainNames = mainOptions.filter((c) => (mainQty[c.id] ?? 0) > 0).map((c) => `${noteDish(c.name)} x${mainQty[c.id]}`)
    const sideName = sideOptions.find((s) => s.id === side)?.name
    const dessertName = dessertOptions.find((d) => d.id === dessert)?.name
    const note = [
      `${t.noteLabels.salads}: ${saladNames.join(', ')}`,
      `${t.noteLabels.first}: ${firstNames.join(', ')}`,
      `${t.noteLabels.main}: ${mainNames.join(', ')}`,
      `${t.noteLabels.side}: ${sideName !== undefined ? noteDish(sideName) : sideName}`,
      `${t.noteLabels.dessert}: ${dessertName !== undefined ? noteDish(dessertName) : dessertName}`,
    ]
      .filter(Boolean)
      .join(' | ')
    addLine({ id: 'shabbat-package', name: PACKAGE_NAME_HE, displayName: t.packageName, unitPrice: total, note })
    navigate(href('/checkout'))
  }

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-72" dir={dir}>
      <PageHero
        active="/shabbat-order"
        size="tall"
        badge={t.heroBadge}
        title={t.heroTitle}
        subtitle={t.heroSubtitle}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/L5fzK0kRQ4N.jpeg"
        imageAlt={t.heroImageAlt}
      />

      <main className="max-w-5xl mx-auto px-6 pt-12 md:pt-20 space-y-12 md:space-y-20">
        <div>
          <p className="max-w-2xl mx-auto text-center text-[#3B151A]/60 font-bold text-lg">
            {t.intro}
          </p>
          <CurrencyNote className="mt-6" />
        </div>
        <Link
          to={href('/shabbat-extras')}
          className="block max-w-2xl mx-auto text-center text-[#8D182C] font-black underline text-sm"
        >
          {t.extrasLink}
        </Link>
        <div className="bg-amber-100/50 border-2 border-amber-200 p-5 md:p-8 rounded-3xl md:rounded-[3rem] flex items-start gap-4 md:gap-6 shadow-sm">
          <Icon icon="ph:info-fill" className="text-amber-600 text-4xl shrink-0" />
          <div>
            <h5 className="font-black text-amber-900 text-xl mb-2">{t.infoTitle}</h5>
            <p className="text-amber-800 font-bold text-sm leading-relaxed">
              {t.infoBody(basePrice)}
              <br />
              {t.infoBody2}
            </p>
          </div>
        </div>

        <SectionHeader n={1} title={t.saladsTitle} hint={t.saladsHint} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 -mt-12">
          {saladOptions.map((s) => {
            const picked = salads.has(s.id)
            const soldOut = isOutOfStock(s.name)
            return (
              <button
                key={s.id}
                type="button"
                // A sold-out salad that is already picked stays clickable so it
                // can be removed — it just cannot be picked again.
                disabled={soldOut && !picked}
                onClick={() => toggleSalad(s.id)}
                className="group relative bg-white rounded-[2.5rem] overflow-hidden border-2 border-transparent transition-all text-start enabled:hover:shadow-xl disabled:cursor-not-allowed"
              >
                <div className="aspect-square overflow-hidden relative">
                  {s.img === '' ? (
                    <div className="w-full h-full bg-[#F7ECE6] flex items-center justify-center">
                      <Icon icon="ph:fork-knife" className="text-5xl text-[#3B151A]/20" />
                    </div>
                  ) : (
                    <Photo
                      src={s.img}
                      alt={displayDish(s.name, locale)}
                      className={`w-full h-full object-cover ${soldOut ? 'grayscale opacity-60' : ''}`}
                      real={s.realPhoto}
                    />
                  )}
                  {s.allergy && (
                    <span className="absolute top-2 start-2 bg-white/90 p-1.5 rounded-lg shadow-md">
                      <Icon icon={ALLERGY_ICON[s.allergy]} className="text-sm" />
                    </span>
                  )}
                  {soldOut && <OutOfStockBadge className="absolute bottom-3 end-3" />}
                  <span
                    className={`absolute bottom-3 start-3 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-all ${
                      picked ? 'bg-[#3B151A] text-white' : 'bg-white text-[#3B151A]'
                    }`}
                  >
                    <Icon icon={picked ? 'ph:check-bold' : 'ph:plus-bold'} className="text-xl" />
                  </span>
                </div>
                <div className="p-4">
                  <h4 className="text-sm font-black">{displayDish(s.name, locale)}</h4>
                  {s.description !== undefined && (
                    <p className="text-xs font-bold text-[#3B151A]/50 mt-1 leading-snug">{s.description}</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {saladExtra > 0 && (
          <p className="text-[#8D182C] font-black text-center -mt-12">{t.extraSalads(saladExtra.toFixed(2), salads.size - INCLUDED_SALADS)}</p>
        )}

        <SectionHeader n={2} title={t.firstsTitle} hint={t.firstsHint} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 -mt-12">
          {firstOptions.map((c) => (
            <QtyCard key={c.id} choice={c} displayName={displayDish(c.name, locale)} qty={firstQty[c.id] ?? 0} onBump={(d) => bumpFirst(c.id, d)} soldOut={isOutOfStock(c.name)} />
          ))}
        </div>
        {firstExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">{t.extraFirsts(firstExtra, firstCount - INCLUDED_FIRST)}</p>}

        <SectionHeader n={3} title={t.mainsTitle} hint={t.mainsHint} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 -mt-12">
          {mainOptions.map((c) => (
            <QtyCard key={c.id} choice={c} displayName={displayDish(c.name, locale)} qty={mainQty[c.id] ?? 0} onBump={(d) => bumpMain(c.id, d)} soldOut={isOutOfStock(c.name)} compact />
          ))}
        </div>
        {mainExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">{t.extraMains(mainExtra, mainCount - INCLUDED_MAIN)}</p>}

        <SectionHeader n={4} title={t.sidesTitle} hint={t.sidesHint} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 -mt-12">
          {sideOptions.map((s) => {
            const soldOut = isOutOfStock(s.name)
            return (
              <button
                key={s.id}
                type="button"
                disabled={soldOut && side !== s.id}
                onClick={() => setSide((prev) => (prev === s.id ? '' : s.id))}
                className={`flex flex-col items-center gap-2 p-6 rounded-3xl border-2 transition-all shadow-sm text-center font-black disabled:opacity-40 disabled:cursor-not-allowed ${
                  side === s.id ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-transparent bg-white'
                }`}
              >
                {s.img !== '' && (
                  <img src={s.img} alt={displayDish(s.name, locale)} loading="lazy" className="w-16 h-16 rounded-2xl object-cover shadow-md" />
                )}
                {displayDish(s.name, locale)}
                {s.description !== undefined && (
                  <span className="text-xs font-bold text-[#3B151A]/50 leading-snug">{s.description}</span>
                )}
                {soldOut && <OutOfStockBadge />}
              </button>
            )
          })}
        </div>

        <SectionHeader n={5} title={t.dessertsTitle} hint={t.dessertsHint} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 -mt-12">
          {dessertOptions.map((d) => {
            const soldOut = isOutOfStock(d.name)
            return (
              <button
                key={d.id}
                type="button"
                disabled={soldOut && dessert !== d.id}
                onClick={() => setDessert((prev) => (prev === d.id ? '' : d.id))}
                className={`group relative rounded-[3.5rem] overflow-hidden border-4 transition-all shadow-lg text-start disabled:cursor-not-allowed ${
                  dessert === d.id ? 'border-[#F5A83A]' : 'border-transparent'
                }`}
              >
                <div className="aspect-video overflow-hidden relative">
                  {d.img === '' ? (
                    <div className="w-full h-full bg-[#F7ECE6] flex items-center justify-center">
                      <Icon icon="ph:fork-knife" className="text-6xl text-[#3B151A]/20" />
                    </div>
                  ) : (
                    <Photo src={d.img} alt={displayDish(d.name, locale)} className={`w-full h-full object-cover ${soldOut ? 'grayscale opacity-60' : ''}`} real={d.realPhoto} />
                  )}
                  {soldOut && <OutOfStockBadge className="absolute top-4 end-4" />}
                  <div className="absolute bottom-4 start-4 max-w-[75%] px-8 py-3 rounded-2xl bg-white shadow-2xl text-start">
                    <span className="font-black block">{displayDish(d.name, locale)}</span>
                    {d.description !== undefined && (
                      <span className="text-xs font-bold text-[#3B151A]/60 block">{d.description}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-10 bg-[#F7ECE6]/95 backdrop-blur-3xl border-t-2 md:border-t-4 border-[#EDB2C1]/20 z-[200] shadow-[0_-30px_60px_rgba(0,0,0,0.15)]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 md:gap-10">
          <div className="flex items-center gap-4 md:gap-10 w-full sm:w-auto justify-center sm:justify-start">
            <div className="w-14 h-14 md:w-28 md:h-28 rounded-2xl md:rounded-[3rem] bg-[#3B151A] text-white flex flex-col items-center justify-center shadow-2xl border-2 md:border-4 border-[#F5A83A]/30 shrink-0">
              <span className="text-base md:text-4xl font-black">${total.toFixed(2).replace(/\.00$/, '')}</span>
              <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest opacity-40">USD</span>
            </div>
            <div className="flex flex-col">
              <span className={`text-[#F5A83A] text-xs font-black mb-1 ${locale === 'he' ? '' : 'uppercase tracking-[0.3em]'}`}>{t.packageName}</span>
              <span className="text-sm md:text-3xl font-black leading-snug">
                {soldOutPicks.length > 0
                  ? t.soldOutLabel(soldOutPicks.map((item) => displayDish(item.name, locale)).join(', '))
                  : canContinue
                    ? t.summaryReady
                    : t.missingLabel(missing.join(', '))}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="w-full sm:w-auto bg-[#3B151A] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 md:px-20 py-4 md:py-8 rounded-2xl md:rounded-[3rem] font-black text-lg md:text-3xl shadow-2xl transition-all flex items-center justify-center gap-4 md:gap-6 group"
          >
            {t.continueCta}{' '}
            <Icon
              icon={dir === 'rtl' ? 'ph:arrow-left-bold' : 'ph:arrow-right-bold'}
              className={`text-2xl md:text-4xl transition-transform ${dir === 'rtl' ? 'group-hover:-translate-x-3' : 'group-hover:translate-x-3'}`}
            />
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
      <p className="text-[#3B151A]/60 font-bold ms-0 md:ms-16 text-base md:text-lg italic mb-8">{hint}</p>
    </div>
  )
}

function QtyCard({
  choice,
  displayName,
  qty,
  onBump,
  soldOut = false,
  compact = false,
}: {
  choice: Option
  displayName: string
  qty: number
  onBump: (delta: number) => void
  soldOut?: boolean
  compact?: boolean
}) {
  return (
    <div className="group relative bg-white rounded-3xl md:rounded-[3.5rem] overflow-hidden border-4 border-transparent transition-all hover:shadow-xl">
      <div className={compact ? 'aspect-video overflow-hidden relative' : 'aspect-video overflow-hidden relative'}>
        {choice.img === '' ? (
          <div className="w-full h-full bg-[#F7ECE6] flex items-center justify-center">
            <Icon icon="ph:fork-knife" className="text-6xl text-[#3B151A]/20" />
          </div>
        ) : (
          <Photo src={choice.img} alt={displayName} className={`w-full h-full object-cover ${soldOut ? 'grayscale opacity-60' : ''}`} real={choice.realPhoto} />
        )}
        {choice.allergy && (
          <span className="absolute top-4 start-4 bg-white/90 p-2 rounded-xl shadow-lg">
            <Icon icon={ALLERGY_ICON[choice.allergy]} className="text-lg" />
          </span>
        )}
        {soldOut && <OutOfStockBadge className="absolute bottom-4 end-4" />}
        <div className="absolute bottom-4 start-4 flex items-center gap-2 bg-white rounded-2xl shadow-2xl p-1">
          <button
            type="button"
            disabled={soldOut}
            onClick={() => onBump(1)}
            className="w-10 h-10 rounded-xl bg-[#3B151A] text-white flex items-center justify-center font-black disabled:opacity-30 disabled:cursor-not-allowed"
          >
            +
          </button>
          <span className="w-8 text-center font-black">{qty}</span>
          <button type="button" onClick={() => onBump(-1)} className="w-10 h-10 rounded-xl bg-[#F7ECE6] flex items-center justify-center font-black">
            −
          </button>
        </div>
      </div>
      <div className={compact ? 'p-6' : 'p-8 text-center'}>
        <h4 className={compact ? 'text-lg font-black' : 'text-2xl font-black'}>{displayName}</h4>
        {choice.description !== undefined && (
          <p className="text-sm font-bold text-[#3B151A]/50 mt-2 leading-relaxed">{choice.description}</p>
        )}
      </div>
    </div>
  )
}
