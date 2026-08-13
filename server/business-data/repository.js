'use strict';

// Plain, independent Postgres tables for payment credentials and invoice
// records. Deliberately NOT part of the bm_state versioned JSON store (see
// server/state/state-repository.js) — that store is schema-drift-validated
// against an exact table list and is the wrong place for a secret or for a
// legally sequential invoice number. Table names avoid any "bm_state" prefix
// so they never collide with that validator's relation scan.

const MIGRATION_SQL = Object.freeze([
  `CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1`,
  `CREATE TABLE IF NOT EXISTS public.payment_credentials (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    ziina_api_key_ciphertext TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payment_credentials_singleton_check CHECK (id = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS public.invoices (
    id BIGSERIAL PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    business_name TEXT NOT NULL,
    trn TEXT NOT NULL DEFAULT '',
    business_address TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subtotal_minor BIGINT NOT NULL,
    vat_minor BIGINT NOT NULL,
    total_minor BIGINT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    access_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT invoices_currency_check CHECK (currency IN ('AED', 'USD')),
    CONSTRAINT invoices_status_check CHECK (status IN ('sent', 'failed')),
    CONSTRAINT invoices_amounts_check CHECK (subtotal_minor >= 0 AND vat_minor >= 0 AND total_minor >= 0)
  )`,
  `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS access_token TEXT`,
  `CREATE INDEX IF NOT EXISTS invoices_order_id_idx ON public.invoices (order_id)`,
  // Partial unique index (not a plain UNIQUE column) so this stays idempotent
  // regardless of any pre-existing rows with a null token.
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_access_token_idx ON public.invoices (access_token) WHERE access_token IS NOT NULL`,
]);

async function initializeBusinessData(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of MIGRATION_SQL) await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function setZiinaApiKeyCiphertext(pool, ciphertext) {
  await pool.query(
    `INSERT INTO public.payment_credentials (id, ziina_api_key_ciphertext, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET ziina_api_key_ciphertext = $1, updated_at = NOW()`,
    [ciphertext]
  );
}

async function getZiinaApiKeyCiphertext(pool) {
  const result = await pool.query(
    'SELECT ziina_api_key_ciphertext FROM public.payment_credentials WHERE id = 1'
  );
  return result.rows[0]?.ziina_api_key_ciphertext ?? null;
}

async function nextInvoiceNumber(pool, now = new Date()) {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(now);
  const result = await pool.query("SELECT nextval('public.invoice_number_seq') AS n");
  const sequenceNumber = String(result.rows[0].n).padStart(6, '0');
  return `BM-${year}-${sequenceNumber}`;
}

async function recordInvoice(pool, record) {
  await pool.query(
    `INSERT INTO public.invoices (
      invoice_number, order_id, business_name, trn, business_address, currency,
      customer_name, customer_email, description, subtotal_minor, vat_minor, total_minor,
      status, error_message, access_token
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      record.invoiceNumber,
      record.orderId,
      record.businessName,
      record.trn,
      record.businessAddress,
      record.currency,
      record.customerName,
      record.customerEmail,
      record.description ?? '',
      record.subtotalMinor,
      record.vatMinor,
      record.totalMinor,
      record.status,
      record.errorMessage ?? null,
      record.accessToken ?? null,
    ]
  );
}

async function hasInvoiceForOrder(pool, orderId) {
  const result = await pool.query(
    "SELECT 1 FROM public.invoices WHERE order_id = $1 AND status = 'sent' LIMIT 1",
    [orderId]
  );
  return result.rows.length > 0;
}

async function getInvoiceByNumberAndToken(pool, invoiceNumber, accessToken) {
  const result = await pool.query(
    `SELECT invoice_number, business_name, trn, business_address, currency, customer_name,
       customer_email, description, subtotal_minor, vat_minor, total_minor, created_at
     FROM public.invoices
     WHERE invoice_number = $1 AND access_token = $2 AND status = 'sent'`,
    [invoiceNumber, accessToken]
  );
  return result.rows[0] ?? null;
}

module.exports = {
  initializeBusinessData,
  setZiinaApiKeyCiphertext,
  getZiinaApiKeyCiphertext,
  nextInvoiceNumber,
  recordInvoice,
  hasInvoiceForOrder,
  getInvoiceByNumberAndToken,
};
