'use strict';

// Supplier invoices: scanned purchase documents with their extracted line
// items. Plain Postgres tables, deliberately outside the bm_state versioned
// JSON store — every state save copies the whole document into history, and
// an ever-growing invoice archive would bloat it (see
// server/state/state-repository.js and business-data/repository.js).

const crypto = require('node:crypto');

const MIGRATION_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS public.supplier_invoices (
    id TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    merchant TEXT,
    purchased_at DATE,
    currency TEXT,
    total_minor BIGINT,
    items JSONB,
    scan_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT supplier_invoices_status_check CHECK (status IN ('pending', 'scanned', 'failed'))
  )`,
  `CREATE INDEX IF NOT EXISTS supplier_invoices_purchased_at_idx
    ON public.supplier_invoices (purchased_at)`,
]);

async function initializeSupplierInvoices(pool) {
  for (const statement of MIGRATION_SQL) {
    await pool.query(statement);
  }
}

function rowToRecord(row) {
  return {
    id: row.id,
    r2Key: row.r2_key,
    fileName: row.file_name,
    status: row.status,
    merchant: row.merchant,
    purchasedAt: row.purchased_at ? row.purchased_at.toISOString().slice(0, 10) : null,
    currency: row.currency,
    totalMinor: row.total_minor === null ? null : Number(row.total_minor),
    items: row.items || [],
    scanError: row.scan_error,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

async function createSupplierInvoice(pool, { r2Key, fileName }) {
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO public.supplier_invoices (id, r2_key, file_name)
     VALUES ($1, $2, $3) RETURNING *`,
    [id, r2Key, fileName]
  );
  return rowToRecord(result.rows[0]);
}

async function saveScanResult(pool, id, { merchant, purchasedAt, currency, totalMinor, items }) {
  const result = await pool.query(
    `UPDATE public.supplier_invoices
     SET status = 'scanned', merchant = $2, purchased_at = $3, currency = $4,
         total_minor = $5, items = $6, scan_error = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, merchant, purchasedAt, currency, totalMinor, JSON.stringify(items)]
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

async function saveScanFailure(pool, id, message) {
  const result = await pool.query(
    `UPDATE public.supplier_invoices
     SET status = 'failed', scan_error = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, String(message).slice(0, 400)]
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

async function setPurchasedAt(pool, id, purchasedAt) {
  const result = await pool.query(
    `UPDATE public.supplier_invoices
     SET purchased_at = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, purchasedAt]
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

async function setPurchasedAt(pool, id, purchasedAt) {
  const result = await pool.query(
    `UPDATE public.supplier_invoices
     SET purchased_at = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, purchasedAt]
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

async function listSupplierInvoices(pool) {
  const result = await pool.query(
    `SELECT * FROM public.supplier_invoices
     ORDER BY purchased_at DESC NULLS LAST, created_at DESC`
  );
  return result.rows.map(rowToRecord);
}

async function getSupplierInvoice(pool, id) {
  const result = await pool.query(`SELECT * FROM public.supplier_invoices WHERE id = $1`, [id]);
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

async function deleteSupplierInvoice(pool, id) {
  const result = await pool.query(
    `DELETE FROM public.supplier_invoices WHERE id = $1 RETURNING r2_key`,
    [id]
  );
  return result.rows[0] ? result.rows[0].r2_key : null;
}

module.exports = {
  initializeSupplierInvoices,
  createSupplierInvoice,
  saveScanResult,
  saveScanFailure,
  setPurchasedAt,
  setPurchasedAt,
  listSupplierInvoices,
  getSupplierInvoice,
  deleteSupplierInvoice,
};
