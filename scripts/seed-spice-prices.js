'use strict';

// Idempotent spice-price seed from Rimon Kosher's own store listing
// (https://rimon.ae/he/collections/spices, fetched 2026-08-18). Adds a rimon
// listing to each spice product: an existing product with the same name gets
// the rimon listing merged in (an existing receipt/manual price is NEVER
// overwritten — receipts beat internet prices); a missing product is created.
//   railway-less run: DATABASE_URL=... BM_STATE_COMMAND_SECRET=... node scripts/seed-spice-prices.js

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createStateRepository } = require('../server/state/state-repository.js');
const { createStateSafetyService } = require('../server/state/state-service.js');

// [name, packSize, packUnit, priceMinorUnits]
const SPICES = [
  ['שום גבישי', '150', 'גרם', 2590],
  ['מלח לימון', '200', 'גרם', 2590], // rimon listing on the existing product; Nesto invoice price stays cheaper
  ['עלי דפנה ופלפל אנגלי', '40', 'גרם', 2590],
  ['פלפל שחור טחון', '100', 'גרם', 2590],
  ['קינמון טחון', '120', 'גרם', 2000],
  ['אורגנו', '40', 'גרם', 2590],
  ['פטרוזיליה יבשה', '20', 'גרם', 2590],
  ['תערובת תבלינים פילדלפיה', '120', 'גרם', 2590],
  ['פלפלים מתוקים בשקית', '120', 'גרם', 2590],
  ['תערובת תבלינים טוסקנה', '1', 'יחידה', 2590], // no pack weight published
  ["חוואיג' לקפה", '100', 'גרם', 2590],
  ['קינמון טחון (ביטון)', '120', 'גרם', 2590],
  ['פפריקה בשמן', '400', 'גרם', 3990],
  ['תבלין בהרט לקובה', '100', 'גרם', 2790],
  ['זנגביל טחון', '100', 'גרם', 2590],
  ["צ'ילי מקסיקני", '100', 'גרם', 2590],
  ['פלפל לבן טחון', '80', 'גרם', 2590],
  ['תבלין סטייק', '120', 'גרם', 2590],
  ['מלח בטעם חמאה לפופקורן', '250', 'גרם', 2590],
  ['תבלין לפוטטו', '120', 'גרם', 2590],
  ['תערובת תבלינים לקציצות ומפרום', '100', 'גרם', 2590],
  ['זעתר בלאדי', '150', 'גרם', 2590],
  ['תבלין עוף בגריל', '100', 'גרם', 1590],
  ['כמון טחון', '90', 'גרם', 1990],
  ['כורכום טחון', '100', 'גרם', 1590],
  ['תבלין לדגים', '100', 'גרם', 1990],
  ['פפריקה מתוקה', '90', 'גרם', 1590],
  ['תבלין שווארמה', '100', 'גרם', 2590],
];

function productId(name) {
  return `product-spice-${crypto.createHash('sha256').update(name.normalize('NFKC')).digest('hex').slice(0, 12)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const commandSecret = process.env.BM_STATE_COMMAND_SECRET;
  if (!commandSecret) throw new Error('BM_STATE_COMMAND_SECRET missing');

  const useTls = /sslmode=require/.test(process.env.DATABASE_URL) || process.env.PGSSL === '1';
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...(useTls ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    const repository = createStateRepository({ pool, commandSecret });
    await repository.initialize();
    const service = createStateSafetyService({ repository });

    const envelope = await service.loadState();
    const data = envelope.data;
    const now = Date.now();

    const entries = Array.isArray(data.productLibrary) ? [...data.productLibrary] : [];
    const indexByName = new Map(entries.map((entry, index) => [String(entry.name).trim(), index]));

    let created = 0;
    let listingAdded = 0;
    let untouchedManual = 0;
    for (const [name, packSize, packUnit, priceMinorUnits] of SPICES) {
      const listing = { packSize, packUnit, packPriceMinorUnits: priceMinorUnits, updatedAt: now, manualPrice: null };
      const existingIndex = indexByName.get(name);
      if (existingIndex === undefined) {
        const entry = {
          id: productId(name),
          name,
          category: 'תבלינים',
          kosherOnly: false,
          supplierOverride: null,
          insignificant: false,
          listings: { rimon: listing },
        };
        indexByName.set(name, entries.length);
        entries.push(entry);
        created += 1;
        continue;
      }
      const existing = entries[existingIndex];
      const existingRimon = existing.listings && existing.listings.rimon;
      if (existingRimon && existingRimon.manualPrice) {
        // A receipt price lives here — the internet price must never replace it.
        untouchedManual += 1;
        continue;
      }
      entries[existingIndex] = {
        ...existing,
        listings: { ...existing.listings, rimon: listing },
      };
      listingAdded += 1;
    }

    const localState = { ...data, productLibrary: entries };
    const result = await service.mergeAndSave({
      baseState: data,
      localState,
      baseRevision: envelope.revision,
      baseHash: envelope.hash,
      requestId: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error(`save failed: ${JSON.stringify(result)}`);

    const after = await service.loadState();
    console.log(JSON.stringify({
      created,
      listingAdded,
      skippedManualPriceProtected: untouchedManual,
      totalProductsInDb: (after.data.productLibrary || []).length,
      newRevision: after.revision,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
