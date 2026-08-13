'use strict';

// Wraps the state repository so ANY successful save (admin editor, site
// checkout, backup restore — every caller goes through repository.saveState)
// can trigger an invoice, without touching the tested state-repository /
// state-service / state-route files. Fires after the save has already
// succeeded and never blocks or fails the caller's response.

const { renderInvoicePdf, computeVatInclusiveBreakdown } = require('./invoice-pdf');
const { sendInvoiceEmail } = require('./send-invoice-email');
const { nextInvoiceNumber, recordInvoice, hasInvoiceForOrder } = require('./repository');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dubaiDateString(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(now);
}

async function issueInvoice({ pool, resendApiKey, order, orderId, businessName, trn, businessAddress, currency, email, logger }) {
  const totalNumber = Number(order.total);
  const totalMinor = Number.isFinite(totalNumber) && totalNumber >= 0 ? Math.round(totalNumber * 100) : 0;
  const { subtotalMinor, vatMinor } = computeVatInclusiveBreakdown(totalMinor, Boolean(trn));
  const invoiceNumber = await nextInvoiceNumber(pool);
  const description =
    order.source === 'site' && typeof order.notes === 'string' && order.notes.trim()
      ? order.notes.split('\n\n')[0].slice(0, 300)
      : `Order ${orderId}`;

  const pdfBytes = await renderInvoicePdf({
    invoiceNumber,
    issueDate: dubaiDateString(new Date()),
    businessName,
    trn,
    businessAddress,
    currency,
    customerName: order.name || 'Customer',
    customerEmail: email,
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
    customerName: order.name || '',
    customerEmail: email,
    subtotalMinor,
    vatMinor,
    totalMinor,
  };

  try {
    await sendInvoiceEmail({ apiKey: resendApiKey, toEmail: email, invoiceNumber, pdfBytes, businessName, customerName: order.name });
    await recordInvoice(pool, { ...base, status: 'sent' });
    logger.log(`invoice ${invoiceNumber} sent for order ${orderId}`);
  } catch (error) {
    await recordInvoice(pool, { ...base, status: 'failed', errorMessage: String(error?.message || error) });
    throw error;
  }
}

async function handlePotentialInvoices(previousData, newData, { pool, resendApiKey, logger }) {
  const settings = newData?.settings ?? {};
  const businessName = typeof settings.businessName === 'string' ? settings.businessName.trim() : '';
  const currency = settings.invoiceCurrency === 'USD' || settings.invoiceCurrency === 'AED' ? settings.invoiceCurrency : null;
  if (!businessName || !currency || !resendApiKey) return;
  const trn = typeof settings.trn === 'string' ? settings.trn.trim() : '';
  const businessAddress = typeof settings.businessAddress === 'string' ? settings.businessAddress.trim() : '';

  const previousById = new Map((previousData?.orders ?? []).map((order) => [String(order?.id), order]));

  for (const order of newData?.orders ?? []) {
    if (order?.id === undefined || order?.id === null) continue;
    const orderId = String(order.id);
    const wasPaid = previousById.get(orderId)?.paid === 'כן';
    const isPaid = order.paid === 'כן';
    if (wasPaid || !isPaid) continue;
    const email = typeof order.email === 'string' ? order.email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) continue;

    try {
      if (await hasInvoiceForOrder(pool, orderId)) continue;
      await issueInvoice({ pool, resendApiKey, order, orderId, businessName, trn, businessAddress, currency, email, logger });
    } catch (error) {
      logger.error('invoice issue failed', { orderId, error });
    }
  }
}

function wrapRepositoryWithInvoiceTrigger(repository, { pool, resendApiKey, logger = console }) {
  return Object.freeze({
    ...repository,
    async saveState(args) {
      const result = await repository.saveState(args);
      if (result.ok) {
        Promise.resolve()
          .then(() => handlePotentialInvoices(args.baseState, result.data, { pool, resendApiKey, logger }))
          .catch((error) => logger.error('invoice trigger crashed', error));
      }
      return result;
    },
  });
}

module.exports = { wrapRepositoryWithInvoiceTrigger, handlePotentialInvoices };
