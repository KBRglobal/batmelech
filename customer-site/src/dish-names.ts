import type { Locale } from './locale-context'

// Menu display names for the English (American Jewish) and French (French
// Jewish) site. The HEBREW name is the canonical key everywhere — it is what
// the admin catalog, stock list, and order lines use — these are display
// names only. Written the way each community actually talks about this food
// (matbucha, chraime, kubbeh — not dictionary translations), per the
// localization rule: native copy, never word-by-word.
//
// A few keys are LEGACY spellings the site used before its Hebrew keys were
// unified with the panel's menu (e.g. 'סיר קובה סלק עבודת יד' alongside the
// canonical 'סיר קובה סלק בתוספת אורז (ל־4 אנשים)'). They are kept so an
// order placed under the old name still renders in English and French — new
// cards must use the canonical name, which
// src/canonical-dish-names.test.ts enforces.

interface DishTranslation {
  readonly en: string
  readonly fr: string
}

export const DISH_NAMES: Readonly<Record<string, DishTranslation>> = {
  // --- Shabbat salads ---
  'כרוב לבן קלאסי': { en: 'Classic White Cabbage Salad', fr: 'Salade de chou blanc classique' },
  'כרוב סגול במיונז': { en: 'Purple Cabbage in Mayo', fr: 'Chou rouge à la mayonnaise' },
  'קולסלאו': { en: 'Coleslaw', fr: 'Coleslaw' },
  'מטבוחה פיקנטית': { en: 'Spicy Matbucha', fr: 'Matboukha piquante' },
  "צ'ירשי טריפוליטאי": { en: 'Tripolitan Chirshi (Pumpkin Dip)', fr: 'Tchirchi tripolitain (courge épicée)' },
  'משוויה מרוקאית': { en: 'Moroccan Mechouia', fr: 'Méchouia marocaine' },
  'מסייר (חמוצים)': { en: 'Msayar Pickles', fr: 'Msayar (légumes en saumure)' },
  'טחינה': { en: 'Creamy Tahini', fr: 'Tehina maison' },
  'סלק מבושל': { en: 'Cooked Beet Salad', fr: 'Salade de betteraves' },
  'גזר מרוקאי מבושל': { en: 'Moroccan Cooked Carrots', fr: 'Carottes à la marocaine' },
  'חציל במיונז': { en: 'Eggplant in Mayo', fr: 'Aubergines à la mayonnaise' },
  'חציל מטוגן': { en: 'Fried Eggplant', fr: 'Aubergines frites' },
  'פלפלים קלויים': { en: 'Roasted Peppers', fr: 'Poivrons grillés' },
  'עגבניות שרי חריפות': { en: 'Spicy Cherry Tomatoes', fr: 'Tomates cerises relevées' },
  'פלפל חריף צלוי': { en: 'Charred Hot Peppers', fr: 'Piments grillés' },
  'סלט ביצים': { en: 'Egg Salad', fr: 'Salade d’œufs' },
  'סלט תפו"א': { en: 'Potato Salad', fr: 'Salade de pommes de terre' },
  'מטבוחה': { en: 'Matbucha', fr: 'Matboukha' },

  // --- First courses (fish) ---
  'פילה דג ברוטב מרוקאי': { en: 'Fish Fillet in Moroccan Sauce', fr: 'Filet de poisson sauce marocaine' },
  'פילה דג ברוטב חריימה': { en: 'Chraime — Fish Fillet in Spicy Sauce', fr: 'Chraïmé — filet de poisson sauce piquante' },
  'קציצות דגים ברוטב מרוקאי': { en: 'Moroccan Fish Patties', fr: 'Boulettes de poisson à la marocaine' },
  'זוג פילה דג בר-ים טרי': { en: 'Pair of Fresh Sea Bream Fillets', fr: 'Duo de filets de daurade fraîche' },

  // --- Mains ---
  'קציצות בשר ברוטב אדום עשיר': { en: 'Beef Meatballs in Rich Red Sauce', fr: 'Boulettes de bœuf sauce tomate' },
  'קציצות בשר עם אפונה וארטישוק': { en: 'Beef Meatballs with Peas & Artichoke', fr: 'Boulettes de bœuf, petits pois et artichauts' },
  'קציצות בשר בריבת בצל וערמונים': { en: 'Beef Meatballs in Onion-Chestnut Confit', fr: 'Boulettes de bœuf, confit d’oignons et marrons' },
  'טבחה עוף אדומה עם שעועית': { en: 'Red Chicken Tbecha with Beans', fr: 'Tbeha de poulet rouge aux haricots' },
  'תבשיל עוף מרוקאי עם חומוסים': { en: 'Moroccan Chicken Stew with Chickpeas', fr: 'Poulet mijoté à la marocaine aux pois chiches' },
  'טבחה עוף צהובה עם תפו"א': { en: 'Golden Chicken Tbecha with Potatoes', fr: 'Tbeha de poulet jaune aux pommes de terre' },
  'מגש שניצלים — במקום עיקרית': { en: 'Schnitzel Platter (instead of a main)', fr: 'Plateau de schnitzels (à la place d’un plat)' },
  'רולדת בשר — במקום עיקרית': { en: 'Beef Roulade (instead of a main)', fr: 'Roulade de bœuf (à la place d’un plat)' },

  // --- Sides ---
  'אורז לבן': { en: 'White Rice', fr: 'Riz blanc' },
  'אורז מתובל / פרסי עם עשבי תיבול': { en: 'Persian Herbed Rice', fr: 'Riz persan aux herbes' },
  'קוסקוס עננים': { en: 'Cloud-Light Couscous', fr: 'Couscous léger comme un nuage' },
  'פסטה נקיה': { en: 'Plain Pasta', fr: 'Pâtes nature' },
  'פסטה אדומה': { en: 'Pasta in Red Sauce', fr: 'Pâtes sauce tomate' },
  'מגש תפו"א': { en: 'Potato Tray', fr: 'Plateau de pommes de terre' },

  // --- Desserts ---
  'סופלה שוקולד': { en: 'Chocolate Soufflé (Pareve)', fr: 'Soufflé au chocolat (parvé)' },
  'סוכריות בקלוואה': { en: 'Baklava Bites', fr: 'Bouchées de baklawa' },
  'סוכריות בקלאווה מלכותיות': { en: 'Royal Baklava Bites', fr: 'Bouchées de baklawa royales' },
  'סופלה שוקולד פרימיום (פרווה)': { en: 'Premium Chocolate Soufflé (Pareve)', fr: 'Soufflé au chocolat premium (parvé)' },

  // --- Shabbat extras / royal upgrades ---
  'צלי בקר פרוס ברוטב פטריות וערמונים (ל־4 אנשים)': { en: 'Sliced Roast Beef in Mushroom-Chestnut Sauce (serves 4)', fr: 'Rôti de bœuf tranché, sauce champignons-marrons (4 pers.)' },
  'צלי בקר פרוס ברוטב פטריות וערמונים': { en: 'Sliced Roast Beef in Mushroom-Chestnut Sauce', fr: 'Rôti de bœuf tranché, sauce champignons-marrons' },
  'מפרום ביתי של אמא (זוגי)': { en: "Mom's Homemade Mafrum (for two)", fr: 'Mafroum maison de maman (pour deux)' },
  'טבחה בשר אדומה עם אפונה ותפו"א (ל־2־3 אנשים)': { en: 'Red Beef Tbecha with Peas & Potatoes (serves 2–3)', fr: 'Tbeha de bœuf, petits pois et pommes de terre (2–3 pers.)' },
  'טבחה בשר אדומה עם אפונה ותפו"א': { en: 'Red Beef Tbecha with Peas & Potatoes', fr: 'Tbeha de bœuf, petits pois et pommes de terre' },
  'רולדת בשר פריך ברוטב פטריות עשיר': { en: 'Crispy Beef Roulade in Rich Mushroom Sauce', fr: 'Roulade de bœuf croustillante, sauce champignons' },
  'רולדת בשר פריך לצד רוטב פטריות עשיר': { en: 'Crispy Beef Roulade in Rich Mushroom Sauce', fr: 'Roulade de bœuf croustillante, sauce champignons' },
  "מגש שניצלים (זוגי, כ־13–15 יח')": { en: 'Schnitzel Platter (13–15 pieces)', fr: 'Plateau de schnitzels (13–15 pièces)' },
  'מגש שניצלים של בית': { en: 'Homestyle Schnitzel Platter', fr: 'Plateau de schnitzels maison' },
  'מגש תפו"א קריספיים': { en: 'Crispy Potato Tray', fr: 'Plateau de pommes de terre croustillantes' },
  'אורז': { en: 'Rice', fr: 'Riz' },
  'קוסקוס': { en: 'Couscous', fr: 'Couscous' },
  'מגש אורז / קוסקוס / פסטה אדומה': { en: 'Rice / Couscous / Red Pasta Tray', fr: 'Plateau riz / couscous / pâtes sauce tomate' },
  'צלחת פתיחה (זיתים וחמוצים)': { en: 'Opening Plate (Olives & Pickles)', fr: 'Assiette d’ouverture (olives et pickles)' },
  'צלחת חריפים': { en: 'Hot Pepper Plate', fr: 'Assiette de piments' },
  'תוספת חומוס ישראלי לניגוב': { en: 'Israeli Hummus for Dipping', fr: 'Houmous israélien à tremper' },
  'מארז הבדלה': { en: 'Havdalah Set', fr: 'Coffret Havdala' },
  'סיר קובה סלק בתוספת אורז (ל־4 אנשים)': { en: 'Beet Kubbeh Soup Pot with Rice (serves 4)', fr: 'Marmite de soupe de kubés à la betterave avec riz (4 pers.)' },
  'סיר קובה סלק עבודת יד': { en: 'Handmade Beet Kubbeh Soup Pot', fr: 'Marmite de kubés à la betterave faits main' },
  'מנת ילדים — פסטה אדומה ושניצלונים': { en: 'Kids Meal — Pasta & Schnitzel Bites', fr: 'Menu enfant — pâtes et mini-schnitzels' },
  'מנת ילדים — פסטה ושניצלונים': { en: 'Kids Meal — Pasta & Schnitzel Bites', fr: 'Menu enfant — pâtes et mini-schnitzels' },
  'חלת שניצל (ספיישל סופ"ש)': { en: 'Schnitzel Challah (Weekend Special)', fr: 'Halla au schnitzel (spécial week-end)' },
  'מנת מפרום ביתי (תוספת)': { en: 'Homemade Mafrum (add-on)', fr: 'Mafroum maison (supplément)' },
  'מרק ירקות לקוסקוס ללא עוף': { en: 'Couscous Vegetable Soup (no chicken)', fr: 'Soupe de légumes pour couscous (sans poulet)' },
  'מרק ירקות לקוסקוס עם עוף': { en: 'Couscous Vegetable Soup with Chicken', fr: 'Soupe de légumes pour couscous avec poulet' },
  'תוספת חלה': { en: 'Extra Challah', fr: 'Halla supplémentaire' },
  'תוספת 4 סלטים לבחירה': { en: 'Add-On: 4 Salads of Your Choice', fr: 'Supplément : 4 salades au choix' },
  'תוספת יין': { en: 'Wine Add-On', fr: 'Supplément vin' },
  'סט עריכה': { en: 'Table-Setting Set', fr: 'Set de dressage' },

  // --- Core package items ---
  'ארוחה זוגית': { en: 'Shabbat Meal for Two', fr: 'Repas de Chabbat pour deux' },
  'חלות': { en: 'Challahs', fr: 'Hallot' },
  'חלה': { en: 'Challah', fr: 'Halla' },

  // --- Weekday lunch ---
  'בגט טוניסאי אותנטי': { en: 'Authentic Tunisian Fricassée Baguette', fr: 'Baguette tunisienne authentique (fricassé)' },
  'בגט/חלת שניצל ישראלי': { en: 'Israeli Schnitzel Baguette / Challah', fr: 'Baguette ou halla au schnitzel israélien' },
  'בגט / חלת שניצל ישראלי': { en: 'Israeli Schnitzel Baguette / Challah', fr: 'Baguette ou halla au schnitzel israélien' },
  'מנת קובה סלק ביתית': { en: 'Homemade Beet Kubbeh Soup', fr: 'Soupe de kubés à la betterave maison' },
  'קובה סלק ביתית': { en: 'Homemade Beet Kubbeh Soup', fr: 'Soupe de kubés à la betterave maison' },
  'שניצל בצלחת': { en: 'Schnitzel Plate', fr: 'Assiette de schnitzel' },
}

// Display name for the current locale. Unknown names (admin-added dishes
// that have no translation yet) fall back to the Hebrew original — an
// honest fallback, never an invented translation.
export function dishName(hebrewName: string, locale: Locale): string {
  if (locale === 'he') return hebrewName
  const translation = DISH_NAMES[hebrewName.trim()]
  return translation ? translation[locale] : hebrewName
}
