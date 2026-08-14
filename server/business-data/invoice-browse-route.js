'use strict';

// Staff-only invoice history: browse what was already issued and re-send one
// by email. Mounted after the decoy gate, so it is only reachable with a valid
// staff session — unlike invoice-download-route.js, which is public and
// therefore token-gated. Invoices themselves are never created here; they are
// still issued automatically by invoice-trigger.js when an order turns paid.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { listInvoices, getInvoiceByNumber, markInvoiceResent } = require('./repository');
const { renderInvoicePdf } = require('./invoice-pdf');
const { sendInvoiceEmail: defaultSendInvoiceEmail } = require('./send-invoice-email');

const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_QUERY_LENGTH = 120;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Mirrors invoice-trigger.js: the email button must point at the same public
// download host the customer originally received.
const DOWNLOAD_BASE_URL = 'https://www.batmelech.ae/invoices';

function dubaiDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(date);
}

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, MAX_LIMIT);
}

function parseQuery(raw) {
  if (raw === undefined) return '';
  if (typeof raw !== 'string' || raw.length > MAX_QUERY_LENGTH) return null;
  return raw.trim();
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return new Date(value).toISOString();
  return null;
}

function presentInvoice(row) {
  const createdAt = toIso(row.created_at);
  const resentAt = toIso(row.resent_at);
  return {
    invoiceNumber: row.invoice_number,
    orderId: row.order_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    currency: row.currency,
    totalMinor: Number(row.total_minor),
    status: row.status,
    createdAt,
    sentAt: resentAt ?? (row.status === 'sent' ? createdAt : null),
    downloadPath: row.access_token ? `/invoices/${row.invoice_number}/${row.access_token}.pdf` : null,
  };
}

function createInvoiceBrowseRouter({
  pool,
  resendApiKey,
  sendInvoiceEmail = defaultSendInvoiceEmail,
  logger = console,
}) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (request, response) => {
    const query = parseQuery(request.query.query);
    const limit = parseLimit(request.query.limit);
    if (query === null || limit === null) {
      return response.status(400).json({ error: 'invalid invoice search' });
    }
    try {
      const rows = await listInvoices(pool, { query, limit });
      return response.json({ invoices: rows.map(presentInvoice) });
    } catch (error) {
      logger.error('invoice list failed', error);
      return response.status(500).json({ error: 'invoices unavailable' });
    }
  });

  // Re-sending mails a real customer, so it gets a much tighter budget than
  // browsing: a stuck button must never turn into an inbox flood.
  router.post(
    '/:invoiceNumber/resend',
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (request, response) => {
      const { invoiceNumber } = request.params;
      if (!INVOICE_NUMBER_PATTERN.test(invoiceNumber)) {
        return response.status(404).json({ error: 'invoice not found' });
      }
      if (typeof resendApiKey !== 'string' || resendApiKey.length === 0) {
        return response.status(503).json({ error: 'email sending is not configured' });
      }

      let invoice;
      try {
        invoice = await getInvoiceByNumber(pool, invoiceNumber);
      } catch (error) {
        logger.error('invoice lookup failed', error);
        return response.status(500).json({ error: 'invoices unavailable' });
      }
      if (!invoice) return response.status(404).json({ error: 'invoice not found' });

      const accessToken = invoice.access_token || crypto.randomBytes(24).toString('hex');
      try {
        const pdfBytes = await renderInvoicePdf({
          invoiceNumber: invoice.invoice_number,
          issueDate: dubaiDateString(new Date(invoice.created_at)),
          businessName: invoice.business_name,
          trn: invoice.trn,
          businessAddress: invoice.business_address,
          currency: invoice.currency,
          customerName: invoice.customer_name,
          customerEmail: invoice.customer_email,
          lines: [
            {
              name: invoice.description || `Invoice ${invoice.invoice_number}`,
              qty: 1,
              unitPriceMinor: Number(invoice.total_minor),
            },
          ],
          subtotalMinor: Number(invoice.subtotal_minor),
          vatMinor: Number(invoice.vat_minor),
          totalMinor: Number(invoice.total_minor),
        });

        await sendInvoiceEmail({
          apiKey: resendApiKey,
          toEmail: invoice.customer_email,
          invoiceNumber: invoice.invoice_number,
          pdfBytes,
          businessName: invoice.business_name,
          customerName: invoice.customer_name,
          downloadUrl: `${DOWNLOAD_BASE_URL}/${invoice.invoice_number}/${accessToken}.pdf`,
        });
      } catch (error) {
        logger.error('invoice resend failed', { invoiceNumber, error });
        return response.status(502).json({ error: 'could not send the invoice' });
      }

      try {
        await markInvoiceResent(pool, invoice.invoice_number, accessToken);
      } catch (error) {
        // The customer already has the mail; failing the request now would
        // invite a second send. Report success and keep the write failure in
        // the log instead.
        logger.error('invoice resend bookkeeping failed', { invoiceNumber, error });
      }
      return response.json({ ok: true });
    }
  );

  return router;
}

module.exports = { createInvoiceBrowseRouter, presentInvoice };
