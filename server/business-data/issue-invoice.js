'use strict';

// The single place an invoice is issued. Both callers go through here — the
// automatic trigger (invoice-trigger.js, when an order flips to paid) and the
// staff panel issuing one by hand (invoice-browse-route.js) — so the legally
// sequential number is allocated exactly once, in exactly one way, by
// repository.nextInvoiceNumber. A second issuing path would be a second way
// to number an invoice, which is the one thing this series cannot survive.

const crypto = require('node:crypto');
const { renderInvoicePdf, computeVatInclusiveBreakdown } = require('./invoice-pdf');
const { sendInvoiceEmail: defaultSendInvoiceEmail } = require('./send-invoice-email');
const { nextInvoiceNumber, recordInvoice } = require('./repository');

const DOWNLOAD_BASE_URL = 'https://www.batmelech.ae/invoices';

function dubaiDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(date);
}

async function issueInvoice({
  pool,
  resendApiKey,
  sendInvoiceEmail = defaultSendInvoiceEmail,
  orderId,
  customerName,
  customerPhone = '',
  email = '',
  description,
  totalMinor,
  businessName,
  trn,
  businessAddress,
  currency,
  deliveryAddress,
  // null means "right now": the row then takes the database's own NOW(), which
  // is what every automatically issued invoice has always used. A caller only
  // passes a date when the staff panel deliberately dates the invoice.
  issuedAt = null,
  logger = console,
}) {
  const issueMoment = issuedAt ?? new Date();
  const { subtotalMinor, vatMinor } = computeVatInclusiveBreakdown(totalMinor, Boolean(trn));
  // Allocated as late as possible and never before the PDF inputs are known:
  // a number handed out and then abandoned leaves a permanent hole in a series
  // that has to stay unbroken.
  const invoiceNumber = await nextInvoiceNumber(pool, issueMoment);
  const accessToken = crypto.randomBytes(24).toString('hex');
  const downloadUrl = `${DOWNLOAD_BASE_URL}/${invoiceNumber}/${accessToken}.pdf`;

  const pdfBytes = await renderInvoicePdf({
    invoiceNumber,
    issueDate: dubaiDateString(issueMoment),
    businessName,
    trn,
    businessAddress,
    currency,
    customerName: customerName || 'Customer',
    customerEmail: email,
    customerPhone,
    lines: [{ name: description, qty: 1, unitPriceMinor: totalMinor }],
    subtotalMinor,
    vatMinor,
    totalMinor,
  });

  const base = {
    invoiceNumber,
    orderId,
    businessName,
    trn,
    businessAddress,
    currency,
    customerName: customerName || '',
    customerEmail: email,
    customerPhone,
    description,
    subtotalMinor,
    vatMinor,
    totalMinor,
    accessToken,
  };

  // No address on file is not a failure. The invoice is issued, numbered and
  // downloadable from the panel; 'sent' here means "issued successfully", and
  // the empty customer email is what tells the panel it was never mailed.
  // Only an attempted send can end up as 'failed'.
  if (!email) {
    await recordInvoice(pool, { ...base, status: 'sent', issuedAt });
    logger.log(`invoice ${invoiceNumber} issued for ${orderId} without an email address`);
    return { ...base, status: 'sent', emailed: false, downloadUrl, pdfBytes };
  }

  try {
    await sendInvoiceEmail({
      apiKey: resendApiKey,
      toEmail: email,
      invoiceNumber,
      pdfBytes,
      businessName,
      customerName,
      deliveryAddress,
      downloadUrl,
    });
    await recordInvoice(pool, { ...base, status: 'sent', issuedAt });
    logger.log(`invoice ${invoiceNumber} sent for order ${orderId}`);
    return { ...base, status: 'sent', emailed: true, downloadUrl, pdfBytes };
  } catch (error) {
    await recordInvoice(pool, {
      ...base,
      status: 'failed',
      errorMessage: String(error?.message || error),
      issuedAt,
    });
    // The number is spent and the row is filed: whoever asked for this invoice
    // has to be told it exists, not that nothing happened.
    const failure = new Error(`invoice ${invoiceNumber} was issued but the email failed`, { cause: error });
    failure.invoiceIssued = true;
    failure.invoiceNumber = invoiceNumber;
    throw failure;
  }
}

module.exports = { issueInvoice, dubaiDateString, DOWNLOAD_BASE_URL };
