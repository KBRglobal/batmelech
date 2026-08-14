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
  `CREATE TABLE IF NOT EXISTS public.staff_credentials (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    username_ciphertext TEXT NOT NULL,
    password_ciphertext TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT staff_credentials_singleton_check CHECK (id = 1)
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
  `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS resent_at TIMESTAMPTZ`,
  // A manually issued invoice may be for a walk-in customer who left a phone
  // number and no email, so the phone is part of who the invoice is billed to.
  `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT ''`,
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

async function setStaffCredentialCiphertexts(pool, { usernameCiphertext, passwordCiphertext }) {
  await pool.query(
    `INSERT INTO public.staff_credentials (id, username_ciphertext, password_ciphertext, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET username_ciphertext = $1, password_ciphertext = $2, updated_at = NOW()`,
    [usernameCiphertext, passwordCiphertext]
  );
}

async function getStaffCredentialCiphertexts(pool) {
  const result = await pool.query(
    'SELECT username_ciphertext, password_ciphertext FROM public.staff_credentials WHERE id = 1'
  );
  const row = result.rows[0];
  if (!row) return null;
  return { usernameCiphertext: row.username_ciphertext, passwordCiphertext: row.password_ciphertext };
}

async function nextInvoiceNumber(pool, now = new Date()) {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(now);
  const result = await pool.query("SELECT nextval('public.invoice_number_seq') AS n");
  const sequenceNumber = String(result.rows[0].n).padStart(6, '0');
  return `BM-${year}-${sequenceNumber}`;
}

// issuedAt is normally left null so the row takes the database's own NOW().
// Only the staff panel passes one, when Lin dates an invoice herself; the
// stored value is what the PDF re-render and the invoice list both read, so a
// dated invoice cannot end up printing one date and filing under another.
async function recordInvoice(pool, record) {
  await pool.query(
    `INSERT INTO public.invoices (
      invoice_number, order_id, business_name, trn, business_address, currency,
      customer_name, customer_email, description, subtotal_minor, vat_minor, total_minor,
      status, error_message, access_token, created_at, customer_phone
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz, NOW()),$17)`,
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
      record.issuedAt ?? null,
      record.customerPhone ?? '',
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

// Any invoice at all, including one whose email failed. Manual issuing uses
// this rather than hasInvoiceForOrder: a failed send is recovered by resending
// the invoice that already exists, never by numbering a second one for the
// same order. (The automatic trigger keeps the looser check so a genuinely
// failed automatic attempt can still be retried.)
async function hasAnyInvoiceForOrder(pool, orderId) {
  const result = await pool.query(
    'SELECT 1 FROM public.invoices WHERE order_id = $1 LIMIT 1',
    [orderId]
  );
  return result.rows.length > 0;
}

// Which orders already carry an invoice — one query instead of asking per
// order, so the staff panel can offer only the orders still missing one.
async function listInvoicedOrderIds(pool) {
  const result = await pool.query('SELECT DISTINCT order_id FROM public.invoices');
  return result.rows.map((row) => row.order_id);
}

async function getInvoiceByNumberAndToken(pool, invoiceNumber, accessToken) {
  const result = await pool.query(
    `SELECT invoice_number, business_name, trn, business_address, currency, customer_name,
       customer_email, customer_phone, description, subtotal_minor, vat_minor, total_minor, created_at
     FROM public.invoices
     WHERE invoice_number = $1 AND access_token = $2 AND status = 'sent'`,
    [invoiceNumber, accessToken]
  );
  return result.rows[0] ?? null;
}

function likePattern(term) {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// Staff-facing listing: the access token comes along so the panel can build
// the same token-gated download link the customer received.
async function listInvoices(pool, { query = '', limit = 50 } = {}) {
  const term = typeof query === 'string' ? query.trim() : '';
  const result = await pool.query(
    `SELECT invoice_number, order_id, customer_name, customer_email, currency,
       total_minor, status, access_token, created_at, resent_at
     FROM public.invoices
     WHERE $1::text IS NULL
        OR invoice_number ILIKE $1 ESCAPE '\\'
        OR customer_name ILIKE $1 ESCAPE '\\'
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [term ? likePattern(term) : null, limit]
  );
  return result.rows;
}

async function getInvoiceByNumber(pool, invoiceNumber) {
  const result = await pool.query(
    `SELECT invoice_number, order_id, business_name, trn, business_address, currency,
       customer_name, customer_email, customer_phone, description, subtotal_minor, vat_minor, total_minor,
       status, access_token, created_at
     FROM public.invoices
     WHERE invoice_number = $1`,
    [invoiceNumber]
  );
  return result.rows[0] ?? null;
}

// A resend is also the recovery path for a row stuck at status 'failed', so it
// clears the stored error and keeps the original access token when there is one.
async function markInvoiceResent(pool, invoiceNumber, accessToken) {
  await pool.query(
    `UPDATE public.invoices
     SET status = 'sent', error_message = NULL, resent_at = NOW(),
         access_token = COALESCE(access_token, $2)
     WHERE invoice_number = $1`,
    [invoiceNumber, accessToken ?? null]
  );
}

module.exports = {
  initializeBusinessData,
  setZiinaApiKeyCiphertext,
  getZiinaApiKeyCiphertext,
  setStaffCredentialCiphertexts,
  getStaffCredentialCiphertexts,
  nextInvoiceNumber,
  recordInvoice,
  hasInvoiceForOrder,
  hasAnyInvoiceForOrder,
  listInvoicedOrderIds,
  getInvoiceByNumberAndToken,
  listInvoices,
  getInvoiceByNumber,
  markInvoiceResent,
};
