'use strict';

// Wraps the state repository so ANY successful save (admin editor, site
// checkout, backup restore — every caller goes through repository.saveState)
// can trigger an invoice, without touching the tested state-repository /
// state-service / state-route files. Fires after the save has already
// succeeded and never blocks or fails the caller's response.

const { hasInvoiceForOrder } = require('./repository');
const { issueInvoice } = require('./issue-invoice');
const { invoiceSettings, orderInvoiceFields } = require('./invoice-inputs');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handlePotentialInvoices(previousData, newData, { pool, resendApiKey, sendInvoiceEmail, logger }) {
  const settings = invoiceSettings(newData);
  if (!settings || !resendApiKey) return;

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
      await issueInvoice({
        pool,
        resendApiKey,
        // Left undefined in production so issue-invoice.js uses the real
        // sender; injected by tests so no invoice mail leaves the process.
        ...(sendInvoiceEmail ? { sendInvoiceEmail } : {}),
        orderId,
        email,
        logger,
        ...settings,
        ...orderInvoiceFields(order, orderId),
      });
    } catch (error) {
      logger.error('invoice issue failed', { orderId, error });
    }
  }
}

function wrapRepositoryWithInvoiceTrigger(repository, { pool, resendApiKey, sendInvoiceEmail, logger = console }) {
  return Object.freeze({
    ...repository,
    async saveState(args) {
      const result = await repository.saveState(args);
      if (result.ok) {
        Promise.resolve()
          .then(() =>
            handlePotentialInvoices(args.baseState, result.data, { pool, resendApiKey, sendInvoiceEmail, logger })
          )
          .catch((error) => logger.error('invoice trigger crashed', error));
      }
      return result;
    },
  });
}

module.exports = { wrapRepositoryWithInvoiceTrigger, handlePotentialInvoices };
