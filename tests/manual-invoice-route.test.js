'use strict';

// Issuing an invoice by hand from the staff panel. The point under test is the
// number: BM-<year>-<six digits>, allocated only by the shared
// repository.nextInvoiceNumber sequence, so a manual invoice always lands
// exactly one after the last one issued — automatic or manual. No real
// Postgres and no real Resend: a fake pool answers the four queries the
// pipeline issues and the email sender is injected.

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createInvoiceBrowseRouter } = require('../server/business-data/invoice-browse-route');
const { handlePotentialInvoices } = require('../server/business-data/invoice-trigger');

const YEAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(new Date());

function invoiceNumber(sequence) {
  return `BM-${YEAR}-${String(sequence).padStart(6, '0')}`;
}

const SETTINGS = Object.freeze({
  businessName: 'Bat Melech Kitchen',
  invoiceCurrency: 'AED',
  trn: '',
  businessAddress: 'Dubai, UAE',
});

const ORDERS = Object.freeze([
  { id: 'order-1', name: 'Lin Cohen', date: '2026-08-10', total: 300, email: 'lin@example.com', phone: '0501234567', address: 'Dubai Marina' },
  { id: 'order-2', name: 'Dana Levi', date: '2026-08-12', total: 125.5, address: 'Downtown' },
  { id: 'order-3', name: 'Yossi Bar', date: '2026-08-01', total: 0 },
]);

// Column order of the INSERT in repository.recordInvoice.
const COLUMN = Object.freeze({
  invoiceNumber: 0,
  orderId: 1,
  currency: 5,
  customerName: 6,
  customerEmail: 7,
  description: 8,
  subtotalMinor: 9,
  vatMinor: 10,
  totalMinor: 11,
  status: 12,
  errorMessage: 13,
  accessToken: 14,
  createdAt: 15,
  customerPhone: 16,
});

// The invoices table plus its number sequence. `lastSequence` stands for
// whatever the last invoice ever issued consumed, so a test can assert the
// next one is exactly that plus one.
function fakePool({ lastSequence = 0, invoiced = [] } = {}) {
  const state = {
    sequence: lastSequence,
    rows: invoiced.map((entry) =>
      typeof entry === 'string' ? { order_id: entry, status: 'sent' } : entry
    ),
    inserts: [],
  };
  return {
    state,
    async query(text, params) {
      if (text.includes("nextval('public.invoice_number_seq')")) {
        state.sequence += 1;
        return { rows: [{ n: String(state.sequence) }] };
      }
      if (text.includes('SELECT DISTINCT order_id')) {
        return { rows: state.rows.map((row) => ({ order_id: row.order_id })) };
      }
      if (text.includes("SELECT 1 FROM public.invoices WHERE order_id = $1 AND status = 'sent'")) {
        return { rows: state.rows.filter((row) => row.order_id === params[0] && row.status === 'sent') };
      }
      if (text.includes('SELECT 1 FROM public.invoices')) {
        return { rows: state.rows.filter((row) => row.order_id === params[0]) };
      }
      if (text.startsWith('INSERT INTO public.invoices')) {
        state.inserts.push(params);
        state.rows.push({ order_id: params[COLUMN.orderId], status: params[COLUMN.status] });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

function fakeStateRepository(data) {
  return { async loadState() { return { revision: 1, ts: 1, hash: 'h', data }; } };
}

async function startTestServer({
  lastSequence = 0,
  invoiced = [],
  orders = ORDERS,
  settings = SETTINGS,
  stateRepository,
  resendApiKey = 'test-key',
  sendInvoiceEmail,
} = {}) {
  const pool = fakePool({ lastSequence, invoiced });
  const sends = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api/invoices',
    createInvoiceBrowseRouter({
      pool,
      resendApiKey,
      stateRepository:
        stateRepository === undefined
          ? fakeStateRepository({ orders: [...orders], ...(settings ? { settings } : {}) })
          : stateRepository,
      sendInvoiceEmail: sendInvoiceEmail ?? (async (payload) => { sends.push(payload); }),
      logger: { log() {}, error() {} },
    })
  );
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return { server, pool, sends, origin: `http://127.0.0.1:${server.address().port}` };
}

function postManual(origin, body) {
  return fetch(`${origin}/api/invoices/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('issues an invoice for an existing order with exactly the next number in the series', async () => {
  const { server, origin, pool, sends } = await startTestServer({ lastSequence: 41 });
  try {
    const response = await postManual(origin, { orderId: 'order-1' });

    assert.equal(response.status, 201);
    const { invoice, emailed } = await response.json();
    assert.equal(invoice.invoiceNumber, invoiceNumber(42));
    assert.equal(invoice.orderId, 'order-1');
    assert.equal(invoice.customerName, 'Lin Cohen');
    assert.equal(invoice.totalMinor, 30_000);
    assert.equal(invoice.currency, 'AED');
    assert.equal(invoice.status, 'sent');
    assert.match(invoice.downloadPath, new RegExp(`^/invoices/${invoiceNumber(42)}/[0-9a-f]{48}\\.pdf$`));
    assert.equal(emailed, true);

    // The order's own email is what it went to, with the order's address in it.
    assert.equal(sends.length, 1);
    assert.equal(sends[0].toEmail, 'lin@example.com');
    assert.equal(sends[0].deliveryAddress, 'Dubai Marina');
    assert.ok(sends[0].pdfBytes.length > 0);

    assert.equal(pool.state.inserts.length, 1);
    assert.equal(pool.state.inserts[0][COLUMN.invoiceNumber], invoiceNumber(42));
    assert.equal(pool.state.inserts[0][COLUMN.status], 'sent');
    assert.equal(pool.state.inserts[0][COLUMN.description], 'Order order-1');
    // No date was asked for, so the row keeps the database's own NOW().
    assert.equal(pool.state.inserts[0][COLUMN.createdAt], null);
  } finally {
    server.close();
  }
});

test('two manual invoices in a row take consecutive numbers', async () => {
  const { server, origin, pool } = await startTestServer({ lastSequence: 7 });
  try {
    const first = await postManual(origin, { orderId: 'order-1' });
    const second = await postManual(origin, {
      customerName: 'Walk-in',
      amount: 80,
      description: 'Challah order',
    });

    assert.equal((await first.json()).invoice.invoiceNumber, invoiceNumber(8));
    assert.equal((await second.json()).invoice.invoiceNumber, invoiceNumber(9));
    assert.deepEqual(
      pool.state.inserts.map((insert) => insert[COLUMN.invoiceNumber]),
      [invoiceNumber(8), invoiceNumber(9)]
    );
  } finally {
    server.close();
  }
});

test('automatic and manual issuing share one unbroken series', async () => {
  const { server, origin, pool, sends } = await startTestServer({ lastSequence: 100 });
  try {
    const manualFirst = await postManual(origin, { orderId: 'order-2' });

    // The automatic trigger fires for a different order turning paid.
    await handlePotentialInvoices(
      { orders: [{ id: 'order-9', paid: 'לא', email: 'auto@example.com' }] },
      {
        settings: SETTINGS,
        orders: [{ id: 'order-9', name: 'Auto Buyer', total: 50, paid: 'כן', email: 'auto@example.com' }],
      },
      {
        pool,
        resendApiKey: 'test-key',
        sendInvoiceEmail: async (payload) => { sends.push(payload); },
        logger: { log() {}, error() {} },
      }
    );

    const manualSecond = await postManual(origin, { orderId: 'order-1' });

    assert.equal((await manualFirst.json()).invoice.invoiceNumber, invoiceNumber(101));
    assert.equal((await manualSecond.json()).invoice.invoiceNumber, invoiceNumber(103));
    assert.deepEqual(
      pool.state.inserts.map((insert) => insert[COLUMN.invoiceNumber]),
      [invoiceNumber(101), invoiceNumber(102), invoiceNumber(103)]
    );
    // The middle one is the automatic invoice, issued by the trigger.
    assert.equal(pool.state.inserts[1][COLUMN.orderId], 'order-9');
  } finally {
    server.close();
  }
});

test('refuses to issue a second invoice for an order that already has one', async () => {
  const { server, origin, pool } = await startTestServer({ lastSequence: 5, invoiced: ['order-1'] });
  try {
    const response = await postManual(origin, { orderId: 'order-1' });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'this order already has an invoice' });
    // Nothing was written and, just as importantly, no number was spent.
    assert.equal(pool.state.inserts.length, 0);
    assert.equal(pool.state.sequence, 5);
  } finally {
    server.close();
  }
});

test('never numbers a second invoice for an order whose first one failed to send', async () => {
  const { server, origin, pool } = await startTestServer({
    lastSequence: 9,
    invoiced: [{ order_id: 'order-1', status: 'failed' }],
  });
  try {
    // The recovery path for a failed send is resending the invoice that
    // already exists, so the order is neither offered nor issuable again.
    const list = await fetch(`${origin}/api/invoices/manual/orders`);
    assert.deepEqual((await list.json()).orders.map((order) => order.id), ['order-2', 'order-3']);

    const response = await postManual(origin, { orderId: 'order-1' });
    assert.equal(response.status, 409);
    assert.equal(pool.state.sequence, 9);
  } finally {
    server.close();
  }
});

test('rejects an unknown order and an order with nothing to bill', async () => {
  const { server, origin, pool } = await startTestServer();
  try {
    const missing = await postManual(origin, { orderId: 'order-404' });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'order not found' });

    const empty = await postManual(origin, { orderId: 'order-3' });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: 'the order has no amount to invoice' });

    assert.equal(pool.state.sequence, 0);
  } finally {
    server.close();
  }
});

test('issues a free-form invoice and mails it when an address was given', async () => {
  const { server, origin, pool, sends } = await startTestServer({ lastSequence: 12 });
  try {
    const response = await postManual(origin, {
      customerName: 'Rivka Adler',
      email: 'rivka@example.com',
      phone: '0509876543',
      amount: 249.9,
      description: 'Catering deposit',
    });

    assert.equal(response.status, 201);
    const { invoice, emailed } = await response.json();
    assert.equal(invoice.invoiceNumber, invoiceNumber(13));
    assert.equal(invoice.totalMinor, 24_990);
    assert.equal(invoice.customerName, 'Rivka Adler');
    assert.equal(emailed, true);
    assert.equal(sends[0].toEmail, 'rivka@example.com');

    const insert = pool.state.inserts[0];
    assert.equal(insert[COLUMN.description], 'Catering deposit');
    assert.equal(insert[COLUMN.customerPhone], '0509876543');
    assert.equal(insert[COLUMN.totalMinor], 24_990);
    // Tied to no order, and to an id no real order could ever have.
    assert.match(insert[COLUMN.orderId], /^manual-[0-9a-f]{12}$/);
  } finally {
    server.close();
  }
});

test('issues without sending when no email address is on file', async () => {
  const { server, origin, pool, sends } = await startTestServer({ lastSequence: 0 });
  try {
    const response = await postManual(origin, {
      customerName: 'Walk-in customer',
      phone: '0521111111',
      amount: 60,
      description: 'Shabbat platter',
    });

    assert.equal(response.status, 201);
    const { invoice, emailed } = await response.json();
    assert.equal(invoice.invoiceNumber, invoiceNumber(1));
    assert.equal(invoice.customerEmail, '');
    assert.equal(emailed, false);
    assert.equal(sends.length, 0);
    // Issued, not failed: nothing was attempted, so nothing failed.
    assert.equal(pool.state.inserts[0][COLUMN.status], 'sent');
  } finally {
    server.close();
  }
});

test('reports an issued invoice whose email failed instead of pretending nothing happened', async () => {
  const { server, origin, pool } = await startTestServer({
    lastSequence: 3,
    sendInvoiceEmail: async () => { throw new Error('Resend send failed'); },
  });
  try {
    const response = await postManual(origin, { orderId: 'order-1' });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'the invoice was issued but the email could not be sent',
      invoiceNumber: invoiceNumber(4),
    });
    // The number was spent, so the row exists and is marked failed — a resend
    // from the list is the recovery path.
    assert.equal(pool.state.inserts[0][COLUMN.invoiceNumber], invoiceNumber(4));
    assert.equal(pool.state.inserts[0][COLUMN.status], 'failed');
    assert.equal(pool.state.inserts[0][COLUMN.errorMessage], 'Resend send failed');
  } finally {
    server.close();
  }
});

test('rejects free-form details that could not make a valid invoice', async () => {
  const { server, origin, pool } = await startTestServer();
  try {
    const cases = [
      {},
      { customerName: '', amount: 100, description: 'x' },
      { customerName: 'A', amount: 0, description: 'x' },
      { customerName: 'A', amount: -5, description: 'x' },
      { customerName: 'A', amount: '100', description: 'x' },
      { customerName: 'A', amount: 100, description: '' },
      { customerName: 'A', amount: 100, description: 'x', email: 'not-an-address' },
      { customerName: 'A', amount: 100, description: 'x', date: '10/08/2026' },
      { orderId: 'order-1', amount: 100 },
      { orderId: '' },
    ];
    for (const body of cases) {
      const response = await postManual(origin, body);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      assert.deepEqual(await response.json(), { error: 'invalid invoice details' });
    }
    assert.equal(pool.state.sequence, 0);
  } finally {
    server.close();
  }
});

test('dates an invoice inside the current year and refuses anything the number cannot carry', async () => {
  const { server, origin, pool } = await startTestServer({ lastSequence: 20 });
  try {
    const future = await postManual(origin, {
      customerName: 'A', amount: 10, description: 'x', date: `${Number(YEAR) + 1}-01-05`,
    });
    assert.equal(future.status, 400);
    assert.deepEqual(await future.json(), { error: 'an invoice cannot be dated in the future' });

    const lastYear = await postManual(origin, {
      customerName: 'A', amount: 10, description: 'x', date: `${Number(YEAR) - 1}-12-30`,
    });
    assert.equal(lastYear.status, 400);
    assert.deepEqual(await lastYear.json(), { error: 'an invoice can only be dated inside the current year' });

    assert.equal(pool.state.sequence, 20);

    const dated = await postManual(origin, {
      customerName: 'A', amount: 10, description: 'x', date: `${YEAR}-01-02`,
    });
    assert.equal(dated.status, 201);
    const { invoice } = await dated.json();
    assert.equal(invoice.invoiceNumber, invoiceNumber(21));
    // The date is stored, not only printed, so a re-downloaded PDF and the
    // invoice list can never disagree about when it was issued.
    assert.equal(pool.state.inserts[0][COLUMN.createdAt].toISOString(), `${YEAR}-01-02T12:00:00.000Z`);
    assert.equal(invoice.createdAt, `${YEAR}-01-02T12:00:00.000Z`);
  } finally {
    server.close();
  }
});

test('offers only the orders that have no invoice yet, newest first', async () => {
  const { server, origin } = await startTestServer({ invoiced: ['order-1'] });
  try {
    const response = await fetch(`${origin}/api/invoices/manual/orders`);

    assert.equal(response.status, 200);
    const { orders, currency } = await response.json();
    assert.equal(currency, 'AED');
    assert.deepEqual(orders.map((order) => order.id), ['order-2', 'order-3']);
    assert.deepEqual(orders[0], {
      id: 'order-2',
      name: 'Dana Levi',
      date: '2026-08-12',
      totalMinor: 12_550,
      email: '',
    });
  } finally {
    server.close();
  }
});

test('says what is missing when the business cannot invoice yet', async () => {
  const { server, origin, pool } = await startTestServer({ settings: null });
  try {
    const list = await fetch(`${origin}/api/invoices/manual/orders`);
    assert.equal(list.status, 409);
    assert.deepEqual(await list.json(), { error: 'business name and invoice currency must be set first' });

    const issue = await postManual(origin, { orderId: 'order-1' });
    assert.equal(issue.status, 409);
    assert.equal(pool.state.sequence, 0);
  } finally {
    server.close();
  }
});

test('reports manual issuing as unavailable when there is no state to read', async () => {
  const { server, origin } = await startTestServer({ stateRepository: null });
  try {
    const list = await fetch(`${origin}/api/invoices/manual/orders`);
    assert.equal(list.status, 503);
    assert.deepEqual(await list.json(), { error: 'manual invoicing is not available' });

    const issue = await postManual(origin, { orderId: 'order-1' });
    assert.equal(issue.status, 503);
  } finally {
    server.close();
  }
});

test('never issues an invoice it already knows it cannot email', async () => {
  const { server, origin, pool, sends } = await startTestServer({ resendApiKey: '' });
  try {
    const response = await postManual(origin, {
      customerName: 'A', email: 'a@example.com', amount: 10, description: 'x',
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'email sending is not configured' });
    assert.equal(sends.length, 0);
    // No number burned on an invoice that was always going to fail.
    assert.equal(pool.state.sequence, 0);

    // The same invoice without an email address is still issuable.
    const withoutEmail = await postManual(origin, { customerName: 'A', amount: 10, description: 'x' });
    assert.equal(withoutEmail.status, 201);
    assert.equal(pool.state.inserts[0][COLUMN.invoiceNumber], invoiceNumber(1));
  } finally {
    server.close();
  }
});
