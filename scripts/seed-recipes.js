'use strict';

// Idempotent recipe seed for the food-costing module. Runs against the SAME
// versioned state pipeline as the panel (three-way merge, history, hash chain):
//   railway run node scripts/seed-recipes.js
// Re-running replaces the same recipes by itemId — never duplicates, never
// touches other recipes, orders, or settings. Ingredient names are the product
// library's names so costing joins; every field stays editable in the panel.

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createStateRepository } = require('../server/state/state-repository.js');
const { createStateSafetyService } = require('../server/state/state-service.js');

// [dish name in the catalog, finishedYieldGrams, [ingredientName, quantity, unit][]]
// yield is always 1 (one finished kilogram / batch as specified).
const RECIPES = [
  ['כרוב לבן קלאסי', 1000, [
    ['כרוב לבן', '940', 'גרם'],
    ['שמן חמניות', '45', 'מ"ל'],
    ['סוכר', '10', 'גרם'],
    ['מלח לימון', '5', 'גרם'],
  ]],
  ['כרוב סגול במיונז', 1000, [
    ['כרוב אדום', '830', 'גרם'],
    ['מיונז', '150', 'מ"ל'],
    ['סוכר', '15', 'גרם'],
    ['מלח לימון', '5', 'גרם'],
  ]],
  ['קולסלאו', 1000, [
    ['כרוב לבן', '670', 'גרם'],
    ['גזר', '170', 'גרם'],
    ['מיונז', '150', 'מ"ל'],
    ['סוכר', '7', 'גרם'],
    ['מלח לימון', '3', 'גרם'],
  ]],
  ['מטבוחה פיקנטית', 650, [
    ['עגבניות מרוסקות פומי', '1000', 'גרם'],
    ['שום טרי', '50', 'גרם'],
    ['פלפל ירוק חריף', '45', 'גרם'],
    ['פפריקה מתוקה', '15', 'גרם'],
    ['מלח', '10', 'גרם'],
  ]],
  ['מסייר (חמוצים)', 1000, [
    ['גזר', '350', 'גרם'],
    ['כרוב לבן', '350', 'גרם'],
    ['פלפל אדום', '250', 'גרם'],
    ['שמן חמניות', '30', 'מ"ל'],
    ['מלח לימון', '10', 'גרם'],
    ['מלח', '10', 'גרם'],
  ]],
  ['טחינה', 1000, [
    ['טחינה גולמית', '500', 'גרם'],
    ['מים', '500', 'מ"ל'],
  ]],
  ['סלק מבושל', 1000, [
    ['סלק', '1100', 'גרם'],
    ['חומץ לבן', '40', 'מ"ל'],
    ['שום טרי', '15', 'גרם'],
  ]],
  ['חציל מטוגן', 1000, [
    ['חציל', '1200', 'גרם'],
    ['מלפפון חמוץ', '150', 'גרם'],
    ['חומץ לבן', '100', 'מ"ל'],
    ['שום טרי', '20', 'גרם'],
    ['שמן חמניות', '150', 'מ"ל'],
  ]],
  ['עגבניות שרי חריפות', 1000, [
    ['עגבניות שרי', '930', 'גרם'],
    ['שום טרי', '25', 'גרם'],
    ['פלפל ירוק חריף', '45', 'גרם'],
  ]],
  ['פלפל חריף צלוי', 1000, [
    ['פלפל ירוק חריף', '1350', 'גרם'],
    ['שמן חמניות', '170', 'מ"ל'],
    ['שום טרי', '30', 'גרם'],
  ]],
  ['סלט ביצים', 1000, [
    ['ביצים גדולות', '20', 'יחידה'],
    ['בצל ירוק', '80', 'גרם'],
  ]],
  ['סלט תפו"א', 1000, [
    ['תפוח אדמה רגיל', '650', 'גרם'],
    ['גזר', '100', 'גרם'],
    ['ביצים גדולות', '2', 'יחידה'],
    ['מיונז', '100', 'מ"ל'],
    ['מלפפון חמוץ', '50', 'גרם'],
  ]],
];

function slugId(name) {
  return `ing-${crypto.createHash('sha256').update(name.normalize('NFKC')).digest('hex').slice(0, 12)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing — run via: railway run node scripts/seed-recipes.js');
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

    // Verify straight from the database after the save.
    const after = await service.loadState();
    const savedRecipes = Array.isArray(after.data.recipes) ? after.data.recipes : [];
    const verified = saved.filter((dishName) => {
      const itemId = idByName.get(dishName);
      const recipe = savedRecipes.find((entry) => entry.itemId === itemId);
      return recipe !== undefined && recipe.ingredients.length > 0;
    });

    console.log(JSON.stringify({
      savedCount: saved.length,
      verifiedInDb: verified.length,
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
