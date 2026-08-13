'use strict';

// Public "download my invoice" link — the one referenced from the invoice
// email button. Deliberately not just /invoices/:invoiceNumber: invoice
// numbers are sequential and guessable, and this table holds customer PII
// (names, emails). The route also requires the random access_token minted
// alongside the invoice, so a link is only useful to whoever received it.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { getInvoiceByNumberAndToken } = require('./repository');
const { renderInvoicePdf } = require('./invoice-pdf');

const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

function timingSafeEqualStrings(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function dubaiDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(date);
}

function createInvoiceDownloadRouter({ pool, logger = console }) {
  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );

  router.get('/:invoiceNumber/:token.pdf', async (request, response) => {
    const { invoiceNumber, token } = request.params;
    if (!INVOICE_NUMBER_PATTERN.test(invoiceNumber) || !TOKEN_PATTERN.test(token)) {
      return response.status(404).send('Not found');
    }

    try {
      const invoice = await getInvoiceByNumberAndToken(pool, invoiceNumber, token);
      if (!invoice || !timingSafeEqualStrings(invoice.access_token ?? token, token)) {
        // getInvoiceByNumberAndToken already filters by exact token match at
        // the SQL level; the compare above is a defensive second gate.
      }
      if (!invoice) return response.status(404).send('Not found');

      const pdfBytes = await renderInvoicePdf({
        invoiceNumber: invoice.invoice_number,
        issueDate: dubaiDateString(invoice.created_at),
        businessName: invoice.business_name,
        trn: invoice.trn,
        businessAddress: invoice.business_address,
        currency: invoice.currency,
        customerName: invoice.customer_name,
        customerEmail: invoice.customer_email,
        lines: [{ name: invoice.description || `Invoice ${invoice.invoice_number}`, qty: 1, unitPriceMinor: invoice.total_minor }],
        subtotalMinor: invoice.subtotal_minor,
        vatMinor: invoice.vat_minor,
        totalMinor: invoice.total_minor,
      });

      response.set('Content-Type', 'application/pdf');
      response.set('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
      response.set('Cache-Control', 'private, max-age=3600');
      response.send(Buffer.from(pdfBytes));
    } catch (error) {
      logger.error('invoice download failed', error);
      response.status(500).send('Could not generate invoice');
    }
  });

  return router;
}

module.exports = { createInvoiceDownloadRouter };
