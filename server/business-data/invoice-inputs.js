'use strict';

// What an invoice needs out of the versioned state store: the business details
// from settings and the billable fields of an order. Shared by the automatic
// trigger and by manual issuing from the staff panel, so an invoice for the
// same order reads identically whichever path issued it.

// Returns null when the business is not ready to invoice at all — an invoice
// without a business name or a currency is not a document anyone can send.
function invoiceSettings(data) {
  const settings = data?.settings ?? {};
  const businessName = typeof settings.businessName === 'string' ? settings.businessName.trim() : '';
  const currency =
    settings.invoiceCurrency === 'USD' || settings.invoiceCurrency === 'AED' ? settings.invoiceCurrency : null;
  if (!businessName || !currency) return null;
  return {
    businessName,
    currency,
    trn: typeof settings.trn === 'string' ? settings.trn.trim() : '',
    businessAddress: typeof settings.businessAddress === 'string' ? settings.businessAddress.trim() : '',
  };
}

function orderInvoiceFields(order, orderId) {
  const totalNumber = Number(order?.total);
  const totalMinor = Number.isFinite(totalNumber) && totalNumber >= 0 ? Math.round(totalNumber * 100) : 0;
  // A site order's notes open with the itemised list the customer submitted,
  // which is a far better invoice line than a bare order id.
  const description =
    order?.source === 'site' && typeof order.notes === 'string' && order.notes.trim()
      ? order.notes.split('\n\n')[0].slice(0, 300)
      : `Order ${orderId}`;
  return {
    totalMinor,
    description,
    customerName: typeof order?.name === 'string' ? order.name : '',
    customerPhone: typeof order?.phone === 'string' ? order.phone : '',
    deliveryAddress: typeof order?.address === 'string' ? order.address : undefined,
  };
}

module.exports = { invoiceSettings, orderInvoiceFields };
