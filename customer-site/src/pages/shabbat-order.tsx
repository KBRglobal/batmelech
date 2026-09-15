import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useNavigate } from 'react-router'
import { PageHero } from '../components/page-hero'
import { CurrencyNote } from '../components/currency-note'
import { Photo } from '../components/photo'
import { OutOfStockBadge } from '../components/out-of-stock-badge'
import {
  ADDON_DINER_LINE_ID,
  ADDON_DINER_NAME_HE,
  FALLBACK_ADDON_DINER_PRICE_USD,
  FALLBACK_SOLO_DINER_PRICE_USD,
  SHABBAT_PACKAGE_LINE_ID,
  SOLO_DINER_LINE_ID,
  SOLO_DINER_NAME_HE,
  useCart,
} from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { useSiteCatalog, type CatalogDish } from '../catalog-context'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

const BASE_PRICE = 299
const FIRST_EXTRA_PRICE = 25
const MAIN_EXTRA_PRICE = 45
/** Fish fillets in one couple package; an add-on or solo diner gets one. */
const FISH_PER_COUPLE = 2
const CHALLOT_PER_COUPLE = 2
const CHALLOT_PER_ADDON = 1
const CHALLOT_PER_SOLO = 2
const SALADS_PER_ADDON = 6
const MAX_DINER_QTY = 20

/** The canonical Hebrew name of the whole package — the cart/order key. */
const PACKAGE_NAME_HE = 'מארז שבת זוגי יוקרתי'
/** Extra first/main courses beyond the included slots — one priced cart line. */
const PACKAGE_EXTRAS_LINE_ID = 'shabbat-package-extras'
const PACKAGE_EXTRAS_NAME_HE = 'מנות נוספות במארז'
/** The kitchen's name for a couple package in notes and breakdowns. */
const COUPLE_MEAL_NAME_HE = 'ארוחה זוגית'
/** The fixed salad box every couple package includes — the kitchen's catalog name. */
const SALAD_BOX_NAME_HE = 'מארז 12 סלטים'

/** Who is eating: couples (with optional add-on diners) or solo diners. */
type DinerMode = 'couple' | 'solo'

type Diners = { couples: number; addons: number; solos: number }

/**
 * How many first-course / main picks the diners are entitled to. A couple
 * is one whole pick (a pair of fillets, a full main); an add-on or solo
 * diner is half a pick (one fillet, half a main). An odd number of halves
 * rounds up to a whole pick — the last one is served as a half portion.
 */
function includedSlots({ couples, addons, solos }: Diners): { slots: number; lastIsHalf: boolean } {
  const halves = addons + solos
  return { slots: couples + Math.ceil(halves / 2), lastIsHalf: halves % 2 === 1 }
}

function includedFish({ couples, addons, solos }: Diners): number {
  return couples * FISH_PER_COUPLE + addons + solos
}

function includedChallot({ couples, addons, solos }: Diners): number {
  return couples * CHALLOT_PER_COUPLE + addons * CHALLOT_PER_ADDON + solos * CHALLOT_PER_SOLO
}

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

// The 12 salads of the fixed box, in the kitchen's order. Not chosen by the
// customer — rendered as a read-only showcase.
const SALADS: Option[] = [
  { id: 'salad-matbucha', name: 'מטבוחה פיקנטית', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/cVEz0yFtGoP.jpeg', allergy: 'spicy' },
  { id: 'salad-tahini', name: 'טחינה', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/7GjgJuaYjlq.jpeg' },
  { id: 'salad-carrot', name: 'גזר מרוקאי מבושל', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ktV7lQAiCxj.jpeg', allergy: 'spicy' },
  { id: 'salad-chirshi', name: "צ'ירשי טריפוליטאי", img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/LkkkAnY1xCn.jpeg' },
  { id: 'salad-beet', name: 'סלק מבושל', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/twpm8363MgJ.jpeg' },
  { id: 'salad-msir', name: 'מסייר (חמוצים)', img: '/site/assets/pickles-real.jpg', realPhoto: true },
  { id: 'salad-coleslaw', name: 'קולסלאו', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/FV0qotWV27P.jpeg', allergy: 'egg' },
  { id: 'salad-cabbage-purple', name: 'כרוב סגול במיונז', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-381-bR993g9VsLN.jpeg', allergy: 'egg' },
  { id: 'salad-cabbage-white', name: 'כרוב לבן קלאסי', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-38-tn6OonVbOX3.jpeg', allergy: 'gluten-free' },
  // No photo yet — reuses the white-cabbage image for now.
  { id: 'salad-cabbage-corn', name: 'כרוב לבן עם תירס', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/WhatsAppImage2026-08-13at17-58-38-tn6OonVbOX3.jpeg', allergy: 'gluten-free' },
  { id: 'salad-potato', name: 'סלט תפו"א', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/yt88LuvAVmz.jpeg', allergy: 'egg' },
  { id: 'salad-egg', name: 'סלט ביצים', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Vz9NyTP6CaJ.jpeg', allergy: 'egg' },
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
  { id: 'side-rice-persian', name: 'אורז מתובל / פרסי עם עשבי תיבול', img: '' },
  { id: 'side-couscous', name: 'קוסקוס עננים', img: '' },
]

const DESSERTS: Option[] = [
  { id: 'dessert-baklava', name: 'סוכריות בקלוואה', img: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/JCOJo8pP96p.jpeg' },
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
  intro: 'ארוחת שבת כשרה בדובאי, מבושלת טרי ומגיעה עד אליכם — מארז 12 סלטים, מנה ראשונה, עיקרית, תוספת וקינוח למארז זוגי מלא. המשלוח בדובאי כלול במחיר.',
  extrasLink: 'לא רוצים חבילה שלמה? לחיזוקים לסופ״ש — מנות בודדות בלי התחייבות',
  infoTitle: 'שיטת הבחירה במארז',
  infoBody: (basePrice: number, addonPrice: number, soloPrice: number) =>
    `ארוחה זוגית ($${basePrice} USD) כוללת: מארז 12 סלטים, 2 פילה דג, עיקרית, תוספת, קינוח ו-2 חלות — והמשלוח בדובאי כלול. סועד נוסף שמצטרף לזוג ($${addonPrice}) מקבל חצי מכל דבר: פילה דג, חצי עיקרית, חצי תוספת, חצי קינוח, חלה ו-6 סלטים. סועד בודד ($${soloPrice}) מקבל פילה דג, חצי עיקרית, חצי תוספת, חצי קינוח, 2 חלות ומארז 12 סלטים מלא — כולל משלוח בדובאי.`,
  infoBody2: 'כל בחירה מעבר למכסה מתווספת אוטומטית למחיר למטה. משלוח לאבו דאבי: $55.',
  dinersTitle: 'מי סועד בשבת',
  dinersHint: 'בוחרים ארוחה זוגית ומוסיפים סועדים, או ארוחה לסועד בודד. המשלוח בדובאי כלול בשני המקרים.',
  modeCouple: 'ארוחה זוגית',
  modeSolo: 'סועד בודד',
  coupleCardTitle: 'ארוחה זוגית',
  coupleCardBody: (price: number) => `$${price} לזוג · משלוח בדובאי כלול`,
  addonCardTitle: 'סועד נוסף',
  addonCardBody: (price: number) => `+$${price} לסועד · חצי מכל דבר: פילה דג, חצי עיקרית, חצי תוספת, חצי קינוח, חלה ו-6 סלטים`,
  soloCardTitle: 'סועד בודד',
  soloCardBody: (price: number) => `$${price} לסועד · פילה דג, חצי עיקרית, חצי תוספת, חצי קינוח, 2 חלות ומארז 12 סלטים מלא · משלוח בדובאי כלול`,
  includedTitle: 'כלול בהזמנה שלכם',
  includedFish: (n: number) => `${n} פילה דג`,
  includedChallot: (n: number) => (n === 1 ? 'חלה אחת' : `${n} חלות`),
  includedSaladsCouple: (n: number) => (n === 1 ? 'מארז 12 סלטים' : `${n} × מארז 12 סלטים`),
  includedSaladsAddon: (n: number) => `+${n * SALADS_PER_ADDON} סלטים`,
  includedSaladsSolo: (n: number) => (n === 1 ? 'מארז 12 סלטים מלא' : `${n} × מארז 12 סלטים מלא`),
  halfPortion: 'חצי מנה',
  saladsTitle: 'מארז 12 סלטים',
  saladsHint: 'כל 12 הסלטים מגיעים עם כל ארוחה זוגית וגם עם סועד בודד, בלי צורך לבחור. סועד נוסף מקבל 6 סלטים. מארז נוסף — 60$ (בעמוד החיזוקים).',
  firstsTitle: 'מנות ראשונות',
  firstsHint: (slots: number, lastIsHalf: boolean) =>
    `כלול: ${slots === 1 ? 'בחירה אחת' : `${slots} בחירות`}${lastIsHalf ? ' (האחרונה חצי מנה — פילה אחד)' : ''}. מעבר לכך: $${FIRST_EXTRA_PRICE} ליחידה`,
  mainsTitle: 'עיקריות לשבת',
  mainsHint: (slots: number, lastIsHalf: boolean) =>
    `כלול: ${slots === 1 ? 'עיקרית אחת' : `${slots} עיקריות`}${lastIsHalf ? ' (האחרונה חצי מנה)' : ''}. מעבר לכך: $${MAIN_EXTRA_PRICE} ליחידה`,
  sidesTitle: 'תוספות לעיקריות',
  sidesHint: 'יש לבחור תוספת אחת',
  sidesHintHalf: 'יש לבחור תוספת אחת · סועד נוסף או בודד מקבל חצי מנה',
  dessertsTitle: 'סיום מתוק (פרווה)',
  dessertsHint: 'יש לבחור מנה אחת',
  dessertsHintHalf: 'יש לבחור מנה אחת · סועד נוסף או בודד מקבל חצי מנה',
  extraFirsts: (amount: number, count: number) => `+$${amount} עבור ${count} מנות נוספות`,
  extraMains: (amount: number, count: number) => `+$${amount} עבור ${count} מנות נוספות`,
  missingFirst: 'מנה ראשונה',
  missingMain: 'מנה עיקרית',
  missingSide: 'תוספת',
  missingDessert: 'קינוח',
  soldOutLabel: (names: string) => `אזל מהמלאי: ${names}`,
  missingLabel: (list: string) => `חסר: ${list}`,
  summaryReady: 'סיכום הזמנה',
  packageName: 'מארז שבת זוגי יוקרתי',
  soloPackageName: 'ארוחת שבת לסועד בודד',
  extrasLineName: 'מנות נוספות במארז',
  continueCta: 'המשך להזמנה',
  noteLabels: {
    diners: 'סועדים',
    salads: 'סלטים',
    first: 'ראשונה',
    main: 'עיקרית',
    side: 'תוספת',
    dessert: 'קינוח',
    challot: 'חלות',
    extras: 'מנות נוספות',
  },
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    heroBadge: 'The Shabbat Experience',
    heroTitle: ['Premium Shabbat', 'Box for Two'],
    heroSubtitle: 'Build your perfect Shabbat table — kosher, freshly cooked, and delivered to your door.',
    heroImageAlt: 'Premium kosher Shabbat box for two in Dubai — Bat Melech Delights',
    intro: 'A complete kosher Shabbat dinner in Dubai, cooked fresh and delivered to you — a box of 12 salads, a first course, a main, a side, and dessert in one full box for two. Delivery in Dubai is included in the price.',
    extrasLink: 'Not looking for the full box? Weekend Boosters — individual dishes, no commitment',
    infoTitle: 'How the Box Works',
    infoBody: (basePrice: number, addonPrice: number, soloPrice: number) =>
      `The box for two ($${basePrice} USD) includes: the box of 12 salads, 2 fish fillets, a main, a side, a dessert, and 2 challahs — with delivery in Dubai included. An additional diner joining a couple ($${addonPrice}) gets half of everything: a fish fillet, half a main, half a side, half a dessert, 1 challah, and 6 salads. A solo diner ($${soloPrice}) gets a fish fillet, half a main, half a side, half a dessert, 2 challahs, and the full box of 12 salads — delivery in Dubai included.`,
    infoBody2: 'Anything you choose beyond the included quota is automatically added to the total below. Delivery to Abu Dhabi: $55.',
    dinersTitle: 'Who Is at the Table',
    dinersHint: 'Pick a box for two and add diners, or order a meal for one. Delivery in Dubai is included either way.',
    modeCouple: 'Box for Two',
    modeSolo: 'Solo Diner',
    coupleCardTitle: 'Box for Two',
    coupleCardBody: (price: number) => `$${price} per couple · delivery in Dubai included`,
    addonCardTitle: 'Additional Diner',
    addonCardBody: (price: number) => `+$${price} per diner · half of everything: a fish fillet, half a main, half a side, half a dessert, 1 challah, and 6 salads`,
    soloCardTitle: 'Solo Diner',
    soloCardBody: (price: number) => `$${price} per diner · a fish fillet, half a main, half a side, half a dessert, 2 challahs, and the full box of 12 salads · delivery in Dubai included`,
    includedTitle: 'Included in your order',
    includedFish: (n: number) => (n === 1 ? '1 fish fillet' : `${n} fish fillets`),
    includedChallot: (n: number) => (n === 1 ? '1 challah' : `${n} challahs`),
    includedSaladsCouple: (n: number) => (n === 1 ? 'the box of 12 salads' : `${n} × box of 12 salads`),
    includedSaladsAddon: (n: number) => `+${n * SALADS_PER_ADDON} salads`,
    includedSaladsSolo: (n: number) => (n === 1 ? 'the full box of 12 salads' : `${n} × full box of 12 salads`),
    halfPortion: 'half portion',
    saladsTitle: 'The Box of 12 Salads',
    saladsHint: 'All 12 salads come with every box for two and with every solo diner. Nothing to choose. An additional diner gets 6 salads. An extra box is $60 (on the Weekend Boosters page).',
    firstsTitle: 'First Courses',
    firstsHint: (slots: number, lastIsHalf: boolean) =>
      `Included: ${slots === 1 ? '1 pick' : `${slots} picks`}${lastIsHalf ? ' (the last one is a half portion — one fillet)' : ''}. Beyond that: $${FIRST_EXTRA_PRICE} each`,
    mainsTitle: 'Shabbat Mains',
    mainsHint: (slots: number, lastIsHalf: boolean) =>
      `Included: ${slots === 1 ? '1 main' : `${slots} mains`}${lastIsHalf ? ' (the last one is a half portion)' : ''}. Beyond that: $${MAIN_EXTRA_PRICE} each`,
    sidesTitle: 'Sides for the Mains',
    sidesHint: 'Choose one side',
    sidesHintHalf: 'Choose one side · an additional or solo diner gets a half portion',
    dessertsTitle: 'A Sweet Finish (Pareve)',
    dessertsHint: 'Choose one dessert',
    dessertsHintHalf: 'Choose one dessert · an additional or solo diner gets a half portion',
    extraFirsts: (amount: number, count: number) =>
      `+$${amount} for ${count} extra course${count === 1 ? '' : 's'}`,
    extraMains: (amount: number, count: number) =>
      `+$${amount} for ${count} extra main${count === 1 ? '' : 's'}`,
    missingFirst: 'a first course',
    missingMain: 'a main course',
    missingSide: 'a side',
    missingDessert: 'a dessert',
    soldOutLabel: (names: string) => `Sold out: ${names}`,
    missingLabel: (list: string) => `Still needed: ${list}`,
    summaryReady: 'Order Summary',
    packageName: 'Premium Shabbat Box for Two',
    soloPackageName: 'Shabbat Meal for One',
    extrasLineName: 'Extra Courses in the Box',
    continueCta: 'Continue to Order',
    noteLabels: {
      diners: 'Diners',
      salads: 'Salads',
      first: 'First course',
      main: 'Main',
      side: 'Side',
      dessert: 'Dessert',
      challot: 'Challahs',
      extras: 'Extra courses',
    },
  },
  fr: {
    heroBadge: "L'expérience Chabbat",
    heroTitle: ['Coffret Chabbat', 'Prestige pour deux'],
    heroSubtitle: 'Composez votre table de Chabbat idéale — casher, cuisinée le jour même et livrée jusque chez vous.',
    heroImageAlt: 'Coffret Chabbat prestige casher pour deux à Dubaï — Bat Melech',
    intro: "Un dîner de Chabbat casher complet à Dubaï, cuisiné frais et livré chez vous — un coffret de 12 salades, une entrée, un plat, un accompagnement et un dessert dans un coffret pour deux. La livraison à Dubaï est incluse dans le prix.",
    extrasLink: "Vous ne souhaitez pas le coffret complet ? Nos extras du week-end — plats à l'unité, sans engagement",
    infoTitle: 'Comment composer votre coffret',
    infoBody: (basePrice: number, addonPrice: number, soloPrice: number) =>
      `Le coffret pour deux ($${basePrice} USD) comprend : le coffret de 12 salades, 2 filets de poisson, un plat, un accompagnement, un dessert et 2 hallot — livraison à Dubaï incluse. Un convive supplémentaire qui rejoint un couple ($${addonPrice}) reçoit la moitié de tout : un filet de poisson, un demi-plat, un demi-accompagnement, un demi-dessert, 1 halla et 6 salades. Un convive solo ($${soloPrice}) reçoit un filet de poisson, un demi-plat, un demi-accompagnement, un demi-dessert, 2 hallot et le coffret complet de 12 salades — livraison à Dubaï incluse.`,
    infoBody2: "Toute sélection au-delà du quota inclus s'ajoute automatiquement au total ci-dessous. Livraison à Abou Dhabi : $55.",
    dinersTitle: 'Qui est à table',
    dinersHint: 'Choisissez un coffret pour deux et ajoutez des convives, ou commandez un repas pour une personne. La livraison à Dubaï est incluse dans les deux cas.',
    modeCouple: 'Coffret pour deux',
    modeSolo: 'Convive solo',
    coupleCardTitle: 'Coffret pour deux',
    coupleCardBody: (price: number) => `$${price} par couple · livraison à Dubaï incluse`,
    addonCardTitle: 'Convive supplémentaire',
    addonCardBody: (price: number) => `+$${price} par convive · la moitié de tout : un filet de poisson, un demi-plat, un demi-accompagnement, un demi-dessert, 1 halla et 6 salades`,
    soloCardTitle: 'Convive solo',
    soloCardBody: (price: number) => `$${price} par convive · un filet de poisson, un demi-plat, un demi-accompagnement, un demi-dessert, 2 hallot et le coffret complet de 12 salades · livraison à Dubaï incluse`,
    includedTitle: 'Inclus dans votre commande',
    includedFish: (n: number) => (n === 1 ? '1 filet de poisson' : `${n} filets de poisson`),
    includedChallot: (n: number) => (n === 1 ? '1 halla' : `${n} hallot`),
    includedSaladsCouple: (n: number) => (n === 1 ? 'le coffret de 12 salades' : `${n} × coffret de 12 salades`),
    includedSaladsAddon: (n: number) => `+${n * SALADS_PER_ADDON} salades`,
    includedSaladsSolo: (n: number) => (n === 1 ? 'le coffret complet de 12 salades' : `${n} × coffret complet de 12 salades`),
    halfPortion: 'demi-portion',
    saladsTitle: 'Le coffret de 12 salades',
    saladsHint: 'Les 12 salades accompagnent chaque coffret pour deux et chaque convive solo. Rien à choisir. Un convive supplémentaire reçoit 6 salades. Un coffret supplémentaire coûte 60 $ (sur la page des extras du week-end).',
    firstsTitle: 'Entrées',
    firstsHint: (slots: number, lastIsHalf: boolean) =>
      `Inclus : ${slots === 1 ? '1 choix' : `${slots} choix`}${lastIsHalf ? ' (le dernier en demi-portion — un filet)' : ''}. Au-delà : $${FIRST_EXTRA_PRICE} l'unité`,
    mainsTitle: 'Plats de Chabbat',
    mainsHint: (slots: number, lastIsHalf: boolean) =>
      `Inclus : ${slots === 1 ? '1 plat' : `${slots} plats`}${lastIsHalf ? ' (le dernier en demi-portion)' : ''}. Au-delà : $${MAIN_EXTRA_PRICE} l'unité`,
    sidesTitle: 'Accompagnements',
    sidesHint: 'Choisissez un accompagnement',
    sidesHintHalf: 'Choisissez un accompagnement · un convive supplémentaire ou solo reçoit une demi-portion',
    dessertsTitle: 'Douceur finale (parvé)',
    dessertsHint: 'Choisissez un dessert',
    dessertsHintHalf: 'Choisissez un dessert · un convive supplémentaire ou solo reçoit une demi-portion',
    extraFirsts: (amount: number, count: number) =>
      `+$${amount} pour ${count === 1 ? '1 entrée supplémentaire' : `${count} entrées supplémentaires`}`,
    extraMains: (amount: number, count: number) =>
      `+$${amount} pour ${count === 1 ? '1 plat supplémentaire' : `${count} plats supplémentaires`}`,
    missingFirst: 'une entrée',
    missingMain: 'un plat',
    missingSide: 'un accompagnement',
    missingDessert: 'un dessert',
    soldOutLabel: (names: string) => `Épuisé : ${names}`,
    missingLabel: (list: string) => `Il manque : ${list}`,
    summaryReady: 'Récapitulatif',
    packageName: 'Coffret Chabbat Prestige pour deux',
    soloPackageName: 'Repas de Chabbat pour une personne',
    extrasLineName: 'Plats supplémentaires du coffret',
    continueCta: 'Continuer la commande',
    noteLabels: {
      diners: 'Convives',
      salads: 'Salades',
      first: 'Entrée',
      main: 'Plat',
      side: 'Accompagnement',
      dessert: 'Dessert',
      challot: 'Hallot',
      extras: 'Plats supplémentaires',
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
  const addonPrice = catalog?.addonDinerPriceUsd ?? FALLBACK_ADDON_DINER_PRICE_USD
  const soloPrice = catalog?.soloDinerPriceUsd ?? FALLBACK_SOLO_DINER_PRICE_USD
  // The box is fixed: the live catalog only supplies photos/descriptions,
  // never the list itself.
  const saladOptions = useMemo(() => mergeOptions(SALADS, undefined, dishByName, 'catalog-salad'), [dishByName])
  const firstOptions = useMemo(() => mergeOptions(FIRST_COURSES, catalog?.categories.firsts, dishByName, 'catalog-first'), [catalog, dishByName])
  const mainOptions = useMemo(() => mergeOptions(MAIN_COURSES, catalog?.categories.mains, dishByName, 'catalog-main'), [catalog, dishByName])
  const sideOptions = useMemo(() => mergeOptions(SIDES, catalog?.categories.sides, dishByName, 'catalog-side'), [catalog, dishByName])
  const dessertOptions = useMemo(() => mergeOptions(DESSERTS, catalog?.categories.desserts, dishByName, 'catalog-dessert'), [catalog, dishByName])

  // Who is eating. Couple mode keeps at least one couple package and lets
  // extra diners join it; solo mode is one (or more) people with no package.
  // Each mode remembers its own counts so switching back loses nothing.
  const [mode, setMode] = useState<DinerMode>('couple')
  const [coupleQty, setCoupleQty] = useState(1)
  const [addonQty, setAddonQty] = useState(0)
  const [soloQty, setSoloQty] = useState(1)
  const diners: Diners =
    mode === 'couple'
      ? { couples: coupleQty, addons: addonQty, solos: 0 }
      : { couples: 0, addons: 0, solos: soloQty }
  const clampQty = (value: number, min: number) => Math.min(MAX_DINER_QTY, Math.max(min, value))
  const bumpCouples = (delta: number) => setCoupleQty((prev) => clampQty(prev + delta, 1))
  const bumpAddons = (delta: number) => setAddonQty((prev) => clampQty(prev + delta, 0))
  const bumpSolos = (delta: number) => setSoloQty((prev) => clampQty(prev + delta, 1))

  const [firstQty, setFirstQty] = useState<Record<string, number>>({})
  const [mainQty, setMainQty] = useState<Record<string, number>>({})
  const [side, setSide] = useState<string>('')
  const [dessert, setDessert] = useState<string>('')

  const bumpFirst = (id: string, delta: number) =>
    setFirstQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  const bumpMain = (id: string, delta: number) =>
    setMainQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))

  const firstCount = Object.values(firstQty).reduce((a, b) => a + b, 0)
  const mainCount = Object.values(mainQty).reduce((a, b) => a + b, 0)

  const { slots: includedPicks, lastIsHalf } = includedSlots(diners)
  const halfDiners = diners.addons + diners.solos
  const fishIncluded = includedFish(diners)
  const challotIncluded = includedChallot(diners)

  const { total, firstExtra, mainExtra } = useMemo(() => {
    const firstExtraN = Math.max(0, firstCount - includedPicks) * FIRST_EXTRA_PRICE
    const mainExtraN = Math.max(0, mainCount - includedPicks) * MAIN_EXTRA_PRICE
    const dinersN = diners.couples * basePrice + diners.addons * addonPrice + diners.solos * soloPrice
    return {
      firstExtra: firstExtraN,
      mainExtra: mainExtraN,
      total: dinersN + firstExtraN + mainExtraN,
    }
  }, [firstCount, mainCount, includedPicks, diners.couples, diners.addons, diners.solos, basePrice, addonPrice, soloPrice])

  const missing: string[] = []
  if (firstCount < includedPicks) missing.push(t.missingFirst)
  if (mainCount < includedPicks) missing.push(t.missingMain)
  if (!side) missing.push(t.missingSide)
  if (!dessert) missing.push(t.missingDessert)

  // An item can sell out after it was picked (the status call lands late, or a
  // second tab marks it). The picks stay put — the builder just refuses to
  // continue until they are swapped out.
  const soldOutPicks = [
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
    const firstNames = firstOptions.filter((c) => (firstQty[c.id] ?? 0) > 0).map((c) => `${noteDish(c.name)} x${firstQty[c.id]}`)
    const mainNames = mainOptions.filter((c) => (mainQty[c.id] ?? 0) > 0).map((c) => `${noteDish(c.name)} x${mainQty[c.id]}`)
    const sideName = sideOptions.find((s) => s.id === side)?.name
    const dessertName = dessertOptions.find((d) => d.id === dessert)?.name
    // Diners line, e.g. "ארוחה זוגית ×1 + סועד נוסף ×1" — the kitchen counts
    // portions from this, so the Hebrew names are always present.
    const dinerParts = [
      diners.couples > 0 ? `${noteDish(COUPLE_MEAL_NAME_HE)} ×${diners.couples}` : undefined,
      diners.addons > 0 ? `${noteDish(ADDON_DINER_NAME_HE)} ×${diners.addons}` : undefined,
      diners.solos > 0 ? `${noteDish(SOLO_DINER_NAME_HE)} ×${diners.solos}` : undefined,
    ].filter(Boolean)
    // Full boxes (one per couple, one per solo diner) under the kitchen's
    // catalog name, plus the 6-salad share of every add-on diner.
    const saladBoxes = diners.couples + diners.solos
    const saladParts = [
      saladBoxes > 0 ? `${noteDish(SALAD_BOX_NAME_HE)} ×${saladBoxes}` : undefined,
      diners.addons > 0 ? t.includedSaladsAddon(diners.addons) : undefined,
    ].filter(Boolean)
    const halfNote = halfDiners > 0 ? ` (${halfDiners} × ${t.halfPortion})` : ''
    const note = [
      `${t.noteLabels.diners}: ${dinerParts.join(' + ')}`,
      `${t.noteLabels.salads}: ${saladParts.join(', ')}`,
      `${t.noteLabels.first}: ${firstNames.join(', ')} (${t.includedFish(fishIncluded)})`,
      `${t.noteLabels.main}: ${mainNames.join(', ')}${halfNote}`,
      `${t.noteLabels.side}: ${sideName !== undefined ? noteDish(sideName) : sideName}${halfNote}`,
      `${t.noteLabels.dessert}: ${dessertName !== undefined ? noteDish(dessertName) : dessertName}${halfNote}`,
      `${t.noteLabels.challot}: ${t.includedChallot(challotIncluded)}`,
    ]
      .filter(Boolean)
      .join(' | ')
    // One cart line per diner kind, each at its own unit price, so the order
    // the kitchen receives names "סועד נוסף" / "סועד בודד" with quantities.
    // The full dish note rides on the first line present.
    if (diners.couples > 0) {
      addLine({ id: SHABBAT_PACKAGE_LINE_ID, name: PACKAGE_NAME_HE, displayName: t.packageName, unitPrice: basePrice, qty: diners.couples, note })
    }
    if (diners.addons > 0) {
      addLine({ id: ADDON_DINER_LINE_ID, name: ADDON_DINER_NAME_HE, displayName: dishName(ADDON_DINER_NAME_HE, locale), unitPrice: addonPrice, qty: diners.addons })
    }
    if (diners.solos > 0) {
      addLine({ id: SOLO_DINER_LINE_ID, name: SOLO_DINER_NAME_HE, displayName: dishName(SOLO_DINER_NAME_HE, locale), unitPrice: soloPrice, qty: diners.solos, note })
    }
    const extrasTotal = firstExtra + mainExtra
    if (extrasTotal > 0) {
      const extrasNote = [
        firstExtra > 0 ? t.extraFirsts(firstExtra, firstCount - includedPicks) : undefined,
        mainExtra > 0 ? t.extraMains(mainExtra, mainCount - includedPicks) : undefined,
      ]
        .filter(Boolean)
        .join(' | ')
      addLine({ id: PACKAGE_EXTRAS_LINE_ID, name: PACKAGE_EXTRAS_NAME_HE, displayName: t.extrasLineName, unitPrice: extrasTotal, note: extrasNote })
    }
    navigate(href('/checkout'))
  }

  const summaryName = mode === 'solo' ? t.soloPackageName : t.packageName
  const includedSummary = [
    t.includedFish(fishIncluded),
    ...(diners.couples > 0 ? [t.includedSaladsCouple(diners.couples)] : []),
    ...(diners.addons > 0 ? [t.includedSaladsAddon(diners.addons)] : []),
    ...(diners.solos > 0 ? [t.includedSaladsSolo(diners.solos)] : []),
    t.includedChallot(challotIncluded),
  ]

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
              {t.infoBody(basePrice, addonPrice, soloPrice)}
              <br />
              {t.infoBody2}
            </p>
          </div>
        </div>

        <SectionHeader n={1} title={t.dinersTitle} hint={t.dinersHint} />
        <div className="-mt-12 space-y-6">
          <div className="grid grid-cols-2 gap-4 max-w-xl">
            {(['couple', 'solo'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`p-5 rounded-3xl border-2 transition-all shadow-sm text-center font-black ${
                  mode === option ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-transparent bg-white'
                }`}
              >
                {option === 'couple' ? t.modeCouple : t.modeSolo}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mode === 'couple' ? (
              <>
                <DinerCard title={t.coupleCardTitle} body={t.coupleCardBody(basePrice)} qty={diners.couples} onBump={bumpCouples} min={1} />
                <DinerCard title={t.addonCardTitle} body={t.addonCardBody(addonPrice)} qty={diners.addons} onBump={bumpAddons} min={0} />
              </>
            ) : (
              <DinerCard title={t.soloCardTitle} body={t.soloCardBody(soloPrice)} qty={diners.solos} onBump={bumpSolos} min={1} />
            )}
          </div>
          <div className="bg-white rounded-3xl p-5 md:p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-[#F5A83A] mb-2">{t.includedTitle}</p>
            <p className="font-bold text-[#3B151A]/70 leading-relaxed">{includedSummary.join(' · ')}</p>
          </div>
        </div>

        <SectionHeader n={2} title={t.saladsTitle} hint={t.saladsHint} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 -mt-12">
          {saladOptions.map((s) => {
            const soldOut = isOutOfStock(s.name)
            return (
              <div
                key={s.id}
                className="group relative bg-white rounded-[2.5rem] overflow-hidden border-2 border-transparent transition-all text-start hover:shadow-xl"
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
                  <span className="absolute bottom-3 start-3 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg bg-[#3B151A] text-white">
                    <Icon icon="ph:check-bold" className="text-xl" />
                  </span>
                </div>
                <div className="p-4">
                  <h4 className="text-sm font-black">{displayDish(s.name, locale)}</h4>
                  {s.description !== undefined && (
                    <p className="text-xs font-bold text-[#3B151A]/50 mt-1 leading-snug">{s.description}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <SectionHeader n={3} title={t.firstsTitle} hint={t.firstsHint(includedPicks, lastIsHalf)} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 -mt-12">
          {firstOptions.map((c) => (
            <QtyCard key={c.id} choice={c} displayName={displayDish(c.name, locale)} qty={firstQty[c.id] ?? 0} onBump={(d) => bumpFirst(c.id, d)} soldOut={isOutOfStock(c.name)} />
          ))}
        </div>
        {firstExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">{t.extraFirsts(firstExtra, firstCount - includedPicks)}</p>}

        <SectionHeader n={4} title={t.mainsTitle} hint={t.mainsHint(includedPicks, lastIsHalf)} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 -mt-12">
          {mainOptions.map((c) => (
            <QtyCard key={c.id} choice={c} displayName={displayDish(c.name, locale)} qty={mainQty[c.id] ?? 0} onBump={(d) => bumpMain(c.id, d)} soldOut={isOutOfStock(c.name)} compact />
          ))}
        </div>
        {mainExtra > 0 && <p className="text-[#8D182C] font-black text-center -mt-12">{t.extraMains(mainExtra, mainCount - includedPicks)}</p>}

        <SectionHeader n={5} title={t.sidesTitle} hint={halfDiners > 0 ? t.sidesHintHalf : t.sidesHint} />
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

        <SectionHeader n={6} title={t.dessertsTitle} hint={halfDiners > 0 ? t.dessertsHintHalf : t.dessertsHint} />
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
              <span className={`text-[#F5A83A] text-xs font-black mb-1 ${locale === 'he' ? '' : 'uppercase tracking-[0.3em]'}`}>{summaryName}</span>
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

/** One diner-kind card of the diners step — same stepper as the dish cards. */
function DinerCard({
  title,
  body,
  qty,
  onBump,
  min,
}: {
  title: string
  body: string
  qty: number
  onBump: (delta: number) => void
  min: number
}) {
  return (
    <div className="bg-white rounded-3xl md:rounded-[2.5rem] p-6 md:p-8 border-4 border-transparent transition-all hover:shadow-xl flex flex-col gap-4">
      <div>
        <h4 className="text-xl md:text-2xl font-black">{title}</h4>
        <p className="text-sm font-bold text-[#3B151A]/50 mt-2 leading-relaxed">{body}</p>
      </div>
      <div className="flex items-center gap-2 bg-[#F7ECE6] rounded-2xl p-1 w-fit">
        <button
          type="button"
          disabled={qty >= MAX_DINER_QTY}
          onClick={() => onBump(1)}
          className="w-10 h-10 rounded-xl bg-[#3B151A] text-white flex items-center justify-center font-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          +
        </button>
        <span className="w-8 text-center font-black">{qty}</span>
        <button
          type="button"
          disabled={qty <= min}
          onClick={() => onBump(-1)}
          className="w-10 h-10 rounded-xl bg-white flex items-center justify-center font-black disabled:opacity-30 disabled:cursor-not-allowed"
        >
          −
        </button>
      </div>
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
