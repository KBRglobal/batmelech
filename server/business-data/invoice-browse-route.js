'use strict';

// Staff-only invoice history: browse what was already issued, re-send one by
// email, and issue one by hand. Mounted after the decoy gate, so it is only
// reachable with a valid staff session — unlike invoice-download-route.js,
// which is public and therefore token-gated. Manual issuing here and the
// automatic trigger both run the same issue-invoice.js pipeline, so every
// invoice number in the series comes from the same allocator.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const {
  listInvoices,
  getInvoiceByNumber,
  markInvoiceResent,
  hasInvoiceForOrder,
  listInvoicedOrderIds,
} = require('./repository');
const { renderInvoicePdf } = require('./invoice-pdf');
const { sendInvoiceEmail: defaultSendInvoiceEmail } = require('./send-invoice-email');
const { issueInvoice, dubaiDateString, DOWNLOAD_BASE_URL } = require('./issue-invoice');
const { orderInvoiceFields } = require('./order-invoice-fields');

const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_QUERY_LENGTH = 120;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ORDER_INVOICE_SCHEMA = z.object({ orderId: z.string().trim().min(1).max(200) }).strict();

const FREE_INVOICE_SCHEMA = z
  .object({
    customerName: z.string().trim().min(1).max(200),
    email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
    phone: z.string().trim().max(60).optional(),
    amount: z.number().finite().positive().max(1_000_000),
    description: z.string().trim().min(1).max(300),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  })
  .strict();

const MANUAL_INVOICE_SCHEMA = z.union([ORDER_INVOICE_SCHEMA, FREE_INVOICE_SCHEMA]);

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

// A free-form invoice belongs to no order, but the invoices table keys every
// row by one. A minted id keeps those rows apart from each other and from any
// real order, so the "does this order already have an invoice?" check can
// never be confused by them.
function freeFormOrderId() {
  return `manual-${crypto.randomBytes(6).toString('hex')}`;
}

// The invoice number carries the year it was issued in and the sequence behind
// it never restarts, so an invoice cannot be dated into a year its own number
// contradicts, nor into the future. Today resolves to null — the database
// clock — which keeps same-day invoices listed in the order they were issued.
function resolveIssuedAt(dateText) {
  if (!dateText) return { issuedAt: null };
  const today = dubaiDateString(new Date());
  if (dateText > today) return { error: 'an invoice cannot be dated in the future' };
  if (dateText === today) return { issuedAt: null };
  if (dateText.slice(0, 4) !== today.slice(0, 4)) {
    return { error: 'an invoice can only be dated inside the current year' };
  }
  // Midday UTC is the same calendar day everywhere in the Gulf, so the stored
  // timestamp and the printed date can never disagree.
  const issuedAt = new Date(`${dateText}T12:00:00Z`);
  if (Number.isNaN(issuedAt.getTime())) return { error: 'invalid invoice date' };
  return { issuedAt };
}

function presentIssuedInvoice(issued, issuedAt) {
  const createdAt = (issuedAt ?? new Date()).toISOString();
  return {
    invoiceNumber: issued.invoiceNumber,
    orderId: issued.orderId,
    customerName: issued.customerName,
    customerEmail: issued.customerEmail,
    currency: issued.currency,
    totalMinor: issued.totalMinor,
    status: issued.status,
    createdAt,
    sentAt: issued.status === 'sent' ? createdAt : null,
    downloadPath: `/invoices/${issued.invoiceNumber}/${issued.accessToken}.pdf`,
  };
}

function createInvoiceBrowseRouter({
  pool,
  resendApiKey,
  // Manual issuing reads orders and business settings out of the versioned
  // state store. Without it the panel can still browse and resend; only
  // issuing by hand is unavailable.
  stateRepository = null,
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

  // Orders and business settings both live in the versioned state store, and
  // manual issuing needs them together — one read serves both endpoints.
  async function loadInvoicingContext() {
    if (!stateRepository || typeof stateRepository.loadState !== 'function') {
      return { status: 503, error: 'manual invoicing is not available' };
    }
    let current;
    try {
      current = await stateRepository.loadState();
    } catch (error) {
      logger.error('manual invoice state load failed', error);
      return { status: 500, error: 'invoices unavailable' };
    }
    const settings = invoiceSettings(current?.data);
    if (!settings) {
      return { status: 409, error: 'business name and invoice currency must be set first' };
    }
    return { settings, orders: Array.isArray(current?.data?.orders) ? current.data.orders : [] };
  }

  // The pick list for issuing by hand: every order that has no invoice yet.
  router.get('/manual/orders', async (_request, response) => {
    const context = await loadInvoicingContext();
    if (context.error) return response.status(context.status).json({ error: context.error });

    let invoiced;
    try {
      invoiced = new Set(await listInvoicedOrderIds(pool));
    } catch (error) {
      logger.error('invoiced order lookup failed', error);
      return response.status(500).json({ error: 'invoices unavailable' });
    }

    const orders = context.orders
      .filter((order) => order?.id !== undefined && order?.id !== null && !invoiced.has(String(order.id)))
      .map((order) => {
        const orderId = String(order.id);
        const fields = orderInvoiceFields(order, orderId);
        return {
          id: orderId,
          name: fields.customerName,
          date: typeof order.date === 'string' ? order.date : '',
          totalMinor: fields.totalMinor,
          email: typeof order.email === 'string' ? order.email.trim() : '',
        };
      })
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, MAX_LIMIT);

    return response.json({ currency: context.settings.currency, orders });
  });

  // Issuing by hand spends a number from the same legally sequential series as
  // the automatic trigger, so it runs the same pipeline and gets a budget as
  // tight as the resend button's.
  router.post(
    '/manual',
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (request, response) => {
      const parsed = MANUAL_INVOICE_SCHEMA.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: 'invalid invoice details' });
      const payload = parsed.data;

      const context = await loadInvoicingContext();
      if (context.error) return response.status(context.status).json({ error: context.error });

      let issuedAt = null;
      let invoiceInput;

      if ('orderId' in payload) {
        const { orderId } = payload;
        const order = context.orders.find(
          (candidate) =>
            candidate?.id !== undefined && candidate?.id !== null && String(candidate.id) === orderId
        );
        if (!order) return response.status(404).json({ error: 'order not found' });

        try {
          if (await hasInvoiceForOrder(pool, orderId)) {
            return response.status(409).json({ error: 'this order already has an invoice' });
          }
        } catch (error) {
          logger.error('invoice lookup failed', error);
          return response.status(500).json({ error: 'invoices unavailable' });
        }

        const fields = orderInvoiceFields(order, orderId);
        if (fields.totalMinor <= 0) {
          return response.status(400).json({ error: 'the order has no amount to invoice' });
        }
        invoiceInput = {
          orderId,
          email: typeof order.email === 'string' ? order.email.trim() : '',
          ...fields,
        };
      } else {
        const { issuedAt: resolved, error } = resolveIssuedAt(payload.date);
        if (error) return response.status(400).json({ error });
        issuedAt = resolved;
        invoiceInput = {
          orderId: freeFormOrderId(),
          customerName: payload.customerName,
          customerPhone: payload.phone ?? '',
          email: payload.email ?? '',
          description: payload.description,
          totalMinor: Math.round(payload.amount * 100),
        };
      }

      // Checked before a number is allocated: a spent number can never be
      // handed back, so nothing is issued that is bound to fail its send.
      if (invoiceInput.email && (typeof resendApiKey !== 'string' || resendApiKey.length === 0)) {
        return response.status(503).json({ error: 'email sending is not configured' });
      }

      let issued;
      try {
        issued = await issueInvoice({
          pool,
          resendApiKey,
          sendInvoiceEmail,
          logger,
          issuedAt,
          ...context.settings,
          ...invoiceInput,
        });
      } catch (error) {
        if (error?.invoiceIssued) {
          logger.error('manual invoice email failed', { invoiceNumber: error.invoiceNumber, error });
          return response.status(502).json({
            error: 'the invoice was issued but the email could not be sent',
            invoiceNumber: error.invoiceNumber,
          });
        }
        logger.error('manual invoice failed', error);
        return response.status(500).json({ error: 'the invoice could not be issued' });
      }

      return response
        .status(201)
        .json({ invoice: presentIssuedInvoice(issued, issuedAt), emailed: issued.emailed });
    }
  );

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
          customerPhone: invoice.customer_phone,
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
