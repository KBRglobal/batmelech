'use strict';

// One knowledge base for every assistant that answers questions about the
// business: the public site concierge and Mey on Telegram. It projects the
// FULL customer-facing picture from live state — menu with descriptions,
// package rules, dish ingredients (names only, from the recipe book), delivery
// fees and windows, holiday menus, ordering status, kashrut, policies — so the
// assistants never have to say "I'm not sure" about anything the site or the
// panel knows.
//
// Customer-safe by construction: it whitelists field by field and NEVER emits
// admin bookkeeping — costs, supplier prices, ingredient quantities, customer
// or order data, audit logs, blocked phones, internal ids.

const { orderingStatus } = require('../business-actions');

const MAX_TEXT_LENGTH = 240;
const MAX_ITEMS = 500;
const MAX_INGREDIENTS_PER_DISH = 40;
const CATEGORY_LABELS = Object.freeze({
  salads: 'Salads',
  firsts: 'First courses',
  mains: 'Main courses',
  sides: 'Sides',
  desserts: 'Desserts',
});

// Fallbacks mirror the public site's hardcoded values
// (customer-site/src/pages/shabbat-order.tsx, cart-context.tsx). Live state
// overrides them wherever the panel carries a value.
const FALLBACK_COUPLE_PRICE_USD = 230;
const FALLBACK_CHALLAH_PRICE_USD = 10;
const FALLBACK_INCLUDED_CHALLOT = 2;
const SITE_EXTRA_SALAD_USD = 6.25;
const SITE_EXTRA_FIRST_USD = 25;
const SITE_EXTRA_MAIN_USD = 45;

// Facts that live in the site's copy, not in state. Every number here matches
// the deployed customer site — when the site changes, change this list too.
const BUSINESS_FACTS = [
  'Bat Melech Kitchen (מטעמי בת מלך) is a kosher home kitchen in Dubai — fresh homemade Israeli-Jewish cooking, established 2024.',
  'Founder and head chef: Lynn (לין), who runs the kitchen together with her husband. She started in Israel with knafeh and handmade beet kubbeh before moving to Dubai.',
  'Website: https://www.batmelech.ae — in Hebrew, English and French. Instagram: @bat_melech_kitchen.',
  'Ordering happens on the website or by WhatsApp at +971 58 628 8776. This chat cannot place, confirm, or change orders.',
  'No payment is taken on the website. Payment is on delivery: cash, bank transfer, Bit, or PayBox. All prices are in US dollars (USD).',
  'Delivery fee: Dubai $15, Abu Dhabi $55. Self-pickup is free. Delivery goes to any hotel or address anywhere in Dubai or Abu Dhabi (with room number for hotels), hot, in sealed tamper-evident thermal coolers. The fee depends only on the emirate, never on the specific hotel or neighborhood — every hotel in Dubai (Palm Jumeirah, Dubai Marina, Downtown, JBR and so on) is the Dubai fee, and every hotel in Abu Dhabi is the Abu Dhabi fee.',
  'Shabbat orders must be placed by Thursday at 6:00 PM. Cancellation is possible up to 24 hours before the delivery time.',
  'Kashrut: strictly kosher mehadrin. All cooking happens in a dedicated, separate kosher kitchen with complete separation of utensils, surfaces and ovens. Meat is glatt (chalak) with mehadrin certification; all ingredients come from certified suppliers only, under the supervision of leading rabbis. The kashrut certificate is shown on the site. For kashrut questions beyond this, ask on WhatsApp.',
  'The kitchen keeps Shabbat: the site closes automatically from candle lighting until havdalah (Dubai times) on Shabbat and holidays, and reopens right after.',
  'Allergy notice: dishes may contain traces of gluten, nuts, eggs and sesame. Customers with a severe allergy must write it in the order notes and confirm by phone.',
  'Private events (price by WhatsApp quote only — no fixed prices): private BBQ at your villa (private chef, professional grill, Wagyu & Prime cuts), yacht catering (kosher fish & sushi menu, waitstaff on deck), villa events (styled buffet, custom menu, service team), private fine dining in your hotel suite (dedicated chef), and desert feasts (open-fire kosher cooking, majlis hospitality).',
  'A Shabbat hotplate (plata) can be added to an order against a refundable deposit — it is collected after Shabbat and the deposit is returned when the equipment is back. Details and amounts on WhatsApp.',
  'The weekday menu is cooked fresh and delivered daily. The Tunisian baguette holds tuna, eggs, potato, preserved lemon, capers and harissa; the Israeli schnitzel roll comes in a baguette or (weekends only) a challah, with homemade matbucha, fried eggplant and chirshi; the beet kubbeh soup is 5 handmade kubbeh in a rich beet broth, served with white rice.',
  'Personal details are used only to process the order and delivery, are never shared without consent, and the site uses no tracking or advertising cookies. Terms are governed by the laws of the UAE.',
].join('\n- ');

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : '';
}

function usd(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function names(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_ITEMS)
    .map((name) => text(name))
    .filter((name) => name !== '');
}

function priced(name, priceUsd) {
  return priceUsd === null ? name : `${name} — $${priceUsd}`;
}

// itemMeta carries the public description / allergens / heating instructions
// the panel attached to a dish — exactly what the site itself shows.
function itemMetaFor(menu, category, name) {
  const ids = isRecord(menu.itemIds) && isRecord(menu.itemIds[category]) ? menu.itemIds[category] : {};
  const metaMap = isRecord(menu.itemMeta) ? menu.itemMeta : {};
  const id = typeof ids[name] === 'string' ? ids[name] : '';
  return id !== '' && isRecord(metaMap[id]) ? metaMap[id] : {};
}

function describeDish(menu, category, name) {
  const meta = itemMetaFor(menu, category, name);
  const parts = [];
  const description = text(meta.description);
  if (description !== '') parts.push(description);
  const allergens = text(meta.allergens);
  if (allergens !== '') parts.push(`allergens: ${allergens}`);
  const heating = text(meta.heatingInstructions);
  if (heating !== '') parts.push(`heating: ${heating}`);
  return parts.length > 0 ? `${name} (${parts.join('; ')})` : name;
}

// ---------------------------------------------------------------------------
// Dish ingredients from the recipe book. Recipes are keyed by stable catalog
// itemId; display names resolve through preparationCatalog and menu.itemIds
// (same join the seed scripts and the panel use). Public output is ingredient
// NAMES only — quantities, waste and yields stay in the panel.
// ---------------------------------------------------------------------------

function displayNamesByItemId(data) {
  const map = new Map();
  const menu = isRecord(data.menu) ? data.menu : {};
  const itemIds = isRecord(menu.itemIds) ? menu.itemIds : {};
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const ids = isRecord(itemIds[category]) ? itemIds[category] : {};
    for (const [name, id] of Object.entries(ids)) {
      if (typeof id === 'string' && text(name) !== '' && !map.has(id)) map.set(id, text(name));
    }
  }
  const extras = Array.isArray(menu.extras) ? menu.extras : [];
  for (const row of extras.slice(0, MAX_ITEMS)) {
    if (isRecord(row) && typeof row.id === 'string' && text(row.name) !== '' && !map.has(row.id)) {
      map.set(row.id, text(row.name));
    }
  }
  const catalog = isRecord(data.preparationCatalog) ? data.preparationCatalog : {};
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (isRecord(item) && typeof item.id === 'string' && text(item.name) !== '' && !map.has(item.id)) {
      map.set(item.id, text(item.name));
    }
  }
  return map;
}

function dishIngredients(data) {
  const recipes = Array.isArray(data.recipes) ? data.recipes : [];
  const nameById = displayNamesByItemId(data);
  const dishes = [];
  for (const recipe of recipes.slice(0, MAX_ITEMS)) {
    if (!isRecord(recipe) || typeof recipe.itemId !== 'string') continue;
    const dishName = nameById.get(recipe.itemId) || text(recipe.name);
    if (dishName === '') continue;
    const seen = new Set();
    const ingredients = [];
    const rows = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    for (const row of rows.slice(0, MAX_INGREDIENTS_PER_DISH)) {
      const ingredientName = isRecord(row) ? text(row.ingredientName) : '';
      if (ingredientName === '' || seen.has(ingredientName)) continue;
      seen.add(ingredientName);
      ingredients.push(ingredientName);
    }
    if (ingredients.length > 0) dishes.push({ name: dishName, ingredients });
  }
  return dishes;
}

// ---------------------------------------------------------------------------
// Live projections
// ---------------------------------------------------------------------------

function packageLines(menu) {
  const couplePrice = usd(menu.couplePrice) ?? FALLBACK_COUPLE_PRICE_USD;
  const challahPrice = usd(menu.challahPrice) ?? FALLBACK_CHALLAH_PRICE_USD;
  const includedChallot =
    typeof menu.includedChallot === 'number' && Number.isFinite(menu.includedChallot) && menu.includedChallot >= 0
      ? menu.includedChallot
      : FALLBACK_INCLUDED_CHALLOT;
  return [
    `The premium Shabbat package for two (מארז שבת זוגי יוקרתי) costs $${couplePrice}.`,
    'Each package includes: 4 salads of your choice, one first course, one main course, one side, one dessert (pareve), and ' +
      `${includedChallot} challot.`,
    'The first course of a package is a pair of fresh sea-bream fish fillets — 2 fillets, one per person — in chraime or Moroccan sauce, or a portion of Moroccan fish patties (קציצות דגים). So a package for two includes 2 fish fillets.',
    'The dessert portion of a package is two chocolate soufflés or one baklava portion.',
    `Beyond what is included, on the website: extra salad $${SITE_EXTRA_SALAD_USD} each, extra first course $${SITE_EXTRA_FIRST_USD}, extra main $${SITE_EXTRA_MAIN_USD}, extra challah $${challahPrice} each.`,
    'Shabbat extras (the à la carte page) can be ordered freely with no package required.',
  ];
}

function menuLines(menu) {
  const lines = [];
  lines.push('The Shabbat package is built from the categories below; the dishes listed are included in the package price:');
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const dishes = names(menu[category]).map((name) => describeDish(menu, category, name));
    if (dishes.length > 0) lines.push(`${label}: ${dishes.join(', ')}.`);
  }

  const extras = (Array.isArray(menu.extras) ? menu.extras : [])
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.name) !== '')
    .map((row) => {
      const description = text(row.description);
      const base = priced(text(row.name), usd(row.price));
      return description !== '' ? `${base} (${description})` : base;
    });
  if (extras.length > 0) lines.push(`Shabbat extras, a la carte: ${extras.join('; ')}.`);

  const lunch = (Array.isArray(menu.lunch) ? menu.lunch : [])
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.key) !== '')
    .map((row) => {
      const variants = (Array.isArray(row.variants) ? row.variants : [])
        .filter((variant) => isRecord(variant) && text(variant.k) !== '')
        .map((variant) => priced(text(variant.k), usd(variant.price)));
      const base = priced(text(row.key), usd(row.price));
      return variants.length > 0 ? `${base} (${variants.join(', ')})` : base;
    });
  if (lunch.length > 0) lines.push(`Weekday menu: ${lunch.join('; ')}.`);

  const lunchSides = names(menu.lunchSides);
  if (lunchSides.length > 0) lines.push(`Weekday sides: ${lunchSides.join(', ')}.`);

  return lines;
}

function statusLines(settings) {
  const lines = [];
  const ordering = orderingStatus(settings);
  if (ordering.open) {
    lines.push('Ordering is currently open.');
  } else {
    lines.push(
      ordering.reopensOn
        ? `Ordering is currently closed; it reopens on ${ordering.reopensOn}.`
        : 'Ordering is currently closed.'
    );
  }
  const banner = text(settings.siteBanner);
  if (banner !== '') lines.push(`Current site announcement: ${banner}`);
  const outOfStock = names(settings.out);
  if (outOfStock.length > 0) {
    lines.push(`Currently sold out (cannot be ordered): ${outOfStock.join(', ')}.`);
  }
  const closedDates = names(settings.closedDates);
  if (closedDates.length > 0) {
    lines.push(`Dates closed for orders: ${closedDates.join(', ')}.`);
  }
  const minAbuDhabi = settings.minOrderAbuDhabiMinorUnits;
  if (typeof minAbuDhabi === 'number' && Number.isFinite(minAbuDhabi) && minAbuDhabi > 0) {
    lines.push(`Minimum order for Abu Dhabi delivery: $${(minAbuDhabi / 100).toFixed(2)}.`);
  }
  const windows = Array.isArray(settings.deliveryWindows) ? settings.deliveryWindows : [];
  const windowTexts = windows
    .slice(0, 20)
    .filter((row) => isRecord(row) && text(row.start) !== '' && text(row.end) !== '')
    .map((row) => `${text(row.start)}–${text(row.end)}`);
  if (windowTexts.length > 0) {
    lines.push(
      `Delivery time slots: ${windowTexts.join(', ')}. Live availability per date is shown at checkout.`
    );
  }
  return lines;
}

function holidayLines(settings, todayIso) {
  const menus = Array.isArray(settings.holidayMenus) ? settings.holidayMenus : [];
  const lines = [];
  for (const menu of menus.slice(0, 20)) {
    if (!isRecord(menu)) continue;
    const from = text(menu.publishFrom);
    const until = text(menu.publishUntil);
    if (from === '' || until === '' || todayIso < from || todayIso > until) continue;
    const title = isRecord(menu.title) ? text(menu.title.he) || text(menu.title.en) : '';
    const dishes = (Array.isArray(menu.dishes) ? menu.dishes : [])
      .slice(0, 60)
      .filter((dish) => isRecord(dish) && text(dish.name) !== '')
      .map((dish) => priced(text(dish.name), usd(dish.priceUsd)));
    if (title === '' || dishes.length === 0) continue;
    const cutoff = text(menu.orderCutoff);
    const cutoffText = cutoff !== '' ? ` Order by ${cutoff}.` : '';
    lines.push(`Holiday menu "${title}": ${dishes.join('; ')}.${cutoffText}`);
  }
  return lines;
}

function ingredientLines(data) {
  return dishIngredients(data).map(
    (dish) => `${dish.name}: ${dish.ingredients.join(', ')}.`
  );
}

// The two lines that let the model answer "is there X anywhere in the food?"
// honestly: the full inventory of every ingredient the recorded recipes use,
// and the list of menu dishes whose recipe is not recorded yet (for those the
// model must not claim to know and should send the question to WhatsApp).
function allergenCoverageLines(data) {
  const dishes = dishIngredients(data);
  const lines = [];
  const inventory = [...new Set(dishes.flatMap((dish) => dish.ingredients))];
  if (inventory.length > 0) {
    lines.push(`Complete inventory of every ingredient used across the recorded recipes: ${inventory.join(', ')}.`);
  }
  const recorded = new Set(dishes.map((dish) => dish.name));
  const menu = isRecord(data.menu) ? data.menu : {};
  const missing = [];
  for (const category of Object.keys(CATEGORY_LABELS)) {
    for (const name of names(menu[category])) {
      if (!recorded.has(name) && !missing.includes(name)) missing.push(name);
    }
  }
  if (missing.length > 0) {
    lines.push(
      `Dishes whose detailed ingredient list is NOT recorded here yet (do not guess their contents; offer to confirm on WhatsApp): ${missing.join(', ')}.`
    );
  }
  return lines;
}

function dubaiTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

// The full knowledge block. `data` is the whole state (current.data); missing
// pieces degrade to the fixed business facts, never throw.
function buildSiteKnowledge(data, { today } = {}) {
  const safeData = isRecord(data) ? data : {};
  const menu = isRecord(safeData.menu) ? safeData.menu : {};
  const settings = isRecord(safeData.settings) ? safeData.settings : {};
  const todayIso = typeof today === 'string' && today !== '' ? today : dubaiTodayIso();

  const sections = [
    `Business facts:\n- ${BUSINESS_FACTS}`,
    `Shabbat package (current prices, USD):\n- ${packageLines(menu).join('\n- ')}`,
    `Live menu (current names and prices, USD):\n- ${menuLines(menu).join('\n- ')}`,
  ];

  const status = statusLines(settings);
  if (status.length > 0) sections.push(`Current status:\n- ${status.join('\n- ')}`);

  const holidays = holidayLines(settings, todayIso);
  if (holidays.length > 0) sections.push(`Holiday menus currently offered:\n- ${holidays.join('\n- ')}`);

  const ingredients = ingredientLines(safeData);
  if (ingredients.length > 0) {
    sections.push(
      'Dish ingredients (from the kitchen recipe book — ingredient names only). ' +
        'When answering allergy questions, list the ingredients but add that dishes may contain traces of allergens and severe allergies must be confirmed by phone:\n- ' +
        ingredients.join('\n- ')
    );
  }

  const coverage = allergenCoverageLines(safeData);
  if (coverage.length > 0) {
    sections.push(
      'Allergen coverage. Use this to answer "is there X in the food?" questions: if the ingredient does not appear in the inventory below, say that according to the kitchen recipes it is not used — while still giving the traces caveat. For dishes listed as not recorded, do not guess:\n- ' +
        coverage.join('\n- ')
    );
  }

  return sections.join('\n\n');
}

module.exports = {
  buildSiteKnowledge,
  dishIngredients,
  displayNamesByItemId,
};
