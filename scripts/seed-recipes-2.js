'use strict';

// Second recipe pass (2026-08-18): Lin cooks by eye, so Moshe directed using
// the closest standard recipe proportions for anything she listed without
// quantities. Ingredient SETS follow Lin's own lists exactly; quantities are
// standard internet proportions per 1kg finished product. Idempotent replace
// by itemId, same versioned pipeline as scripts/seed-recipes.js.
//   node scripts/seed-recipes-2.js   (inside the app container)

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createStateRepository } = require('../server/state/state-repository.js');
const { createStateSafetyService } = require('../server/state/state-service.js');

// [dish name, finishedYieldGrams, [ingredientName, quantity, unit][]]
const RECIPES = [
  // Updated: Lin's listed extras completed with standard pinch/seasoning amounts
  ['סלט ביצים', 1000, [
    ['ביצים גדולות', '20', 'יחידה'],
    ['בצל ירוק', '80', 'גרם'],
    ['מלח', '8', 'גרם'],
    ['פלפל לבן טחון', '2', 'גרם'],
  ]],
  ['טחינה', 1000, [
    ['טחינה גולמית', '500', 'גרם'],
    ['מים', '500', 'מ"ל'],
    ['מלח לימון', '5', 'גרם'],
    ['מלח', '5', 'גרם'],
  ]],
  ['סלק מבושל', 1000, [
    ['סלק', '1100', 'גרם'],
    ['חומץ לבן', '40', 'מ"ל'],
    ['שום טרי', '15', 'גרם'],
    ['כמון טחון', '5', 'גרם'],
    ['פפריקה מתוקה', '5', 'גרם'],
  ]],
  ['חציל מטוגן', 1000, [
    ['חציל', '1200', 'גרם'],
    ['מלפפון חמוץ', '150', 'גרם'],
    ['חומץ לבן', '100', 'מ"ל'],
    ['שום טרי', '20', 'גרם'],
    ['שמן חמניות', '150', 'מ"ל'],
    ['כמון טחון', '5', 'גרם'],
    ['סוכר', '10', 'גרם'],
    ['פפריקה מתוקה', '5', 'גרם'],
  ]],
  ['פלפל חריף צלוי', 1000, [
    ['פלפל ירוק חריף', '1350', 'גרם'],
    ['שמן חמניות', '170', 'מ"ל'],
    ['שום טרי', '30', 'גרם'],
    ['מלח', '5', 'גרם'],
  ]],
  // New: catalog dishes priced by standard proportions
  ["צ'ירשי טריפוליטאי", 1000, [
    ['דלעת רגילה', '1100', 'גרם'],
    ['פלפל ירוק חריף', '30', 'גרם'],
    ['שום טרי', '20', 'גרם'],
    ['מלח לימון', '8', 'גרם'],
    ['שמן חמניות', '40', 'מ"ל'],
    ['פפריקה מתוקה', '10', 'גרם'],
    ['כמון טחון', '5', 'גרם'],
  ]],
  ['משוויה מרוקאית', 1000, [
    ['פלפל אדום', '700', 'גרם'],
    ['עגבניות רומא', '400', 'גרם'],
    ['שום טרי', '20', 'גרם'],
    ['שמן חמניות', '40', 'מ"ל'],
    ['מלח', '8', 'גרם'],
  ]],
  ['חציל במיונז', 1000, [
    ['חציל', '1200', 'גרם'],
    ['מיונז', '180', 'מ"ל'],
    ['שום טרי', '15', 'גרם'],
    ['מלח', '8', 'גרם'],
  ]],
  ['פלפלים קלויים', 1000, [
    ['פלפל אדום', '1300', 'גרם'],
    ['שמן חמניות', '40', 'מ"ל'],
    ['שום טרי', '15', 'גרם'],
    ['מלח', '5', 'גרם'],
  ]],
  ['פסטה נקיה', 1000, [
    ['ספגטי', '400', 'גרם'],
    ['שמן חמניות', '20', 'מ"ל'],
    ['מלח', '5', 'גרם'],
  ]],
  ['פסטה אדומה', 1000, [
    ['ספגטי', '350', 'גרם'],
    ['עגבניות מרוסקות פומי', '250', 'גרם'],
    ['רסק עגבניות', '30', 'גרם'],
    ['שום טרי', '15', 'גרם'],
    ['שמן חמניות', '30', 'מ"ל'],
    ['מלח', '5', 'גרם'],
  ]],
  ['מגש תפו"א', 1100, [
    ['תפוח אדמה רגיל', '1500', 'גרם'],
    ['שמן חמניות', '100', 'מ"ל'],
    ['פפריקה מתוקה', '10', 'גרם'],
    ['מלח', '10', 'גרם'],
  ]],
  ['אורז לבן', 1000, [
    ['אורז', '350', 'גרם'],
    ['שמן חמניות', '20', 'מ"ל'],
    ['מלח', '5', 'גרם'],
  ]],
  ['קוסקוס עננים', 1000, [
    ['סולת', '400', 'גרם'],
    ['מים', '400', 'מ"ל'],
    ['שמן חמניות', '30', 'מ"ל'],
    ['מלח', '5', 'גרם'],
  ]],
];

function slugId(name) {
  return `ing-${crypto.createHash('sha256').update(name.normalize('NFKC')).digest('hex').slice(0, 12)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const commandSecret = process.env.BM_STATE_COMMAND_SECRET;
  if (!commandSecret) throw new Error('BM_STATE_COMMAND_SECRET missing');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const repository = createStateRepository({ pool, commandSecret });
    await repository.initialize();
    const service = createStateSafetyService({ repository });

    const envelope = await service.loadState();
    const data = envelope.data;

    const catalogItems = (data.preparationCatalog && Array.isArray(data.preparationCatalog.items))
      ? data.preparationCatalog.items
      : [];
    const idByName = new Map(catalogItems.map((item) => [String(item.name).trim(), String(item.id)]));

    const existing = Array.isArray(data.recipes) ? data.recipes : [];
    const byItemId = new Map(existing.map((recipe) => [recipe.itemId, recipe]));

    const saved = [];
    const skipped = [];
    for (const [dishName, finishedYieldGrams, rows] of RECIPES) {
      const itemId = idByName.get(dishName);
      if (itemId === undefined) {
        skipped.push({ dishName, reason: 'dish name not found in preparationCatalog' });
        continue;
      }
      byItemId.set(itemId, {
        itemId,
        yield: 1,
        finishedYieldGrams,
        ingredients: rows.map(([ingredientName, quantity, unit]) => ({
          ingredientId: slugId(ingredientName),
          ingredientName,
          quantity,
          unit,
        })),
      });
      saved.push(dishName);
    }

    const localState = { ...data, recipes: [...byItemId.values()] };
    const result = await service.mergeAndSave({
      baseState: data,
      localState,
      baseRevision: envelope.revision,
      baseHash: envelope.hash,
      requestId: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error(`save failed: ${JSON.stringify(result)}`);

    const after = await service.loadState();
    const savedRecipes = Array.isArray(after.data.recipes) ? after.data.recipes : [];
    console.log(JSON.stringify({
      savedCount: saved.length,
      totalRecipesInDb: savedRecipes.length,
      newRevision: after.revision,
      skipped,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
