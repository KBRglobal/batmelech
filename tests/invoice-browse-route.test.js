'use strict';

// The staff-only invoice history screen. No real Postgres and no real Resend
// here: a fake pool answers the three queries the route issues, and the email
// sender is injected so a "resend" never leaves the test process.

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createInvoiceBrowseRouter } = require('../server/business-data/invoice-browse-route');

const TOKEN = 'a'.repeat(48);

function invoiceRow(overrides = {}) {
  return {
    invoice_number: 'BM-2026-000001',
    order_id: 'order-1',
    business_name: 'Bat Melech Kitchen',
    trn: '',
    business_address: 'Dubai, UAE',
    currency: 'AED',
    customer_name: 'Lin Cohen',
    customer_email: 'lin@example.com',
    description: 'Shabbat platter',
    subtotal_minor: 30_000,
    vat_minor: 0,
    total_minor: 30_000,
    status: 'sent',
    access_token: TOKEN,
    created_at: new Date('2026-08-07T09:00:00Z'),
    resent_at: null,
    ...overrides,
  };
}

// Stands in for the invoices table: SELECT ... LIMIT is the list query,
// SELECT without LIMIT is the single-invoice lookup, UPDATE is the bookkeeping.
function fakePool(rows) {
  const calls = { list: [], updated: [] };
  return {
    calls,
    async query(text, params) {
      if (text.startsWith('SELECT') && text.includes('LIMIT')) {
        const [pattern, limit] = params;
        calls.list.push({ pattern, limit });
        const matching = pattern === null
          ? rows
          : rows.filter((row) => {
              const needle = pattern.replaceAll('%', '').toLowerCase();
              return row.invoice_number.toLowerCase().includes(needle)
                || row.customer_name.toLowerCase().includes(needle);
            });
        return { rows: matching };
      }
      if (text.startsWith('SELECT')) {
        return { rows: rows.filter((row) => row.invoice_number === params[0]) };
      }
      if (text.startsWith('UPDATE')) {
        calls.updated.push({ invoiceNumber: params[0], accessToken: params[1] });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

async function startTestServer({ rows = [invoiceRow()], resendApiKey = 'test-key', sendInvoiceEmail } = {}) {
  const pool = fakePool(rows);
  const sends = [];
  const app = express();
  app.use(
    '/api/invoices',
    createInvoiceBrowseRouter({
      pool,
      resendApiKey,
      sendInvoiceEmail: sendInvoiceEmail ?? (async (payload) => { sends.push(payload); }),
      logger: { log() {}, error() {} },
    })
  );
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return { server, pool, sends, origin: `http://127.0.0.1:${server.address().port}` };
}

test('lists invoices newest first with a token-gated download path', async () => {
  const { server, origin, pool } = await startTestServer({
    rows: [
      invoiceRow(),
      invoiceRow({ invoice_number: 'BM-2026-000002', customer_name: 'Dana Levi', access_token: null, status: 'failed' }),
    ],
  });
  try {
    const response = await fetch(`${origin}/api/invoices`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { invoices } = await response.json();

    assert.equal(invoices.length, 2);
    assert.deepEqual(invoices[0], {
      invoiceNumber: 'BM-2026-000001',
      orderId: 'order-1',
      customerName: 'Lin Cohen',
      customerEmail: 'lin@example.com',
      currency: 'AED',
      totalMinor: 30_000,
      status: 'sent',
      createdAt: '2026-08-07T09:00:00.000Z',
      sentAt: '2026-08-07T09:00:00.000Z',
      downloadPath: `/invoices/BM-2026-000001/${TOKEN}.pdf`,
    });
    // A failed invoice has no send time and no downloadable link yet.
    assert.equal(invoices[1].status, 'failed');
    assert.equal(invoices[1].sentAt, null);
    assert.equal(invoices[1].downloadPath, null);
    assert.deepEqual(pool.calls.list, [{ pattern: null, limit: 50 }]);
  } finally {
    server.close();
  }
});

test('searches by invoice number or customer name and rejects an unusable limit', async () => {
  const { server, origin, pool } = await startTestServer({
    rows: [invoiceRow(), invoiceRow({ invoice_number: 'BM-2026-000002', customer_name: 'Dana Levi' })],
  });
  try {
    const byName = await fetch(`${origin}/api/invoices?query=dana&limit=10`);
    const { invoices } = await byName.json();
    assert.deepEqual(invoices.map((invoice) => invoice.invoiceNumber), ['BM-2026-000002']);
    assert.deepEqual(pool.calls.list.at(-1), { pattern: '%dana%', limit: 10 });

    const byNumber = await fetch(`${origin}/api/invoices?query=000001`);
    assert.deepEqual((await byNumber.json()).invoices.map((invoice) => invoice.invoiceNumber), ['BM-2026-000001']);

    const capped = await fetch(`${origin}/api/invoices?limit=5000`);
    assert.equal(capped.status, 200);
    assert.equal(pool.calls.list.at(-1).limit, 200);

    const invalid = await fetch(`${origin}/api/invoices?limit=zero`);
    assert.equal(invalid.status, 400);
  } finally {
    server.close();
  }
});

test('resends an existing invoice through the shared email sender and records it', async () => {
  const { server, origin, pool, sends } = await startTestServer();
  try {
    const response = await fetch(`${origin}/api/invoices/BM-2026-000001/resend`, { method: 'POST' });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].toEmail, 'lin@example.com');
    assert.equal(sends[0].invoiceNumber, 'BM-2026-000001');
    assert.equal(sends[0].businessName, 'Bat Melech Kitchen');
    assert.equal(sends[0].downloadUrl, `https://www.batmelech.ae/invoices/BM-2026-000001/${TOKEN}.pdf`);
    assert.ok(sends[0].pdfBytes.length > 0);
    assert.deepEqual(pool.calls.updated, [{ invoiceNumber: 'BM-2026-000001', accessToken: TOKEN }]);
  } finally {
    server.close();
  }
});

test('mints a download token for an invoice issued before tokens existed', async () => {
  const { server, origin, pool, sends } = await startTestServer({
    rows: [invoiceRow({ access_token: null, status: 'failed' })],
  });
  try {
    const response = await fetch(`${origin}/api/invoices/BM-2026-000001/resend`, { method: 'POST' });

    assert.equal(response.status, 200);
    const minted = pool.calls.updated[0].accessToken;
    assert.match(minted, /^[0-9a-f]{48}$/);
    assert.equal(sends[0].downloadUrl, `https://www.batmelech.ae/invoices/BM-2026-000001/${minted}.pdf`);
  } finally {
    server.close();
  }
});

test('never sends for an unknown invoice number', async () => {
  const { server, origin, pool, sends } = await startTestServer();
  try {
    const missing = await fetch(`${origin}/api/invoices/BM-2026-999999/resend`, { method: 'POST' });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'invoice not found' });

    // A path that could never be an invoice number is rejected before any query.
    const malformed = await fetch(`${origin}/api/invoices/${encodeURIComponent('../secret')}/resend`, { method: 'POST' });
    assert.equal(malformed.status, 404);

    assert.equal(sends.length, 0);
    assert.equal(pool.calls.updated.length, 0);
  } finally {
    server.close();
  }
});

test('reports a failed send without marking the invoice as sent', async () => {
  const { server, origin, pool } = await startTestServer({
    sendInvoiceEmail: async () => { throw new Error('Resend send failed'); },
  });
  try {
    const response = await fetch(`${origin}/api/invoices/BM-2026-000001/resend`, { method: 'POST' });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'could not send the invoice' });
    assert.equal(pool.calls.updated.length, 0);
  } finally {
    server.close();
  }
});

test('refuses to resend when no email provider key is configured', async () => {
  const { server, origin, sends } = await startTestServer({ resendApiKey: '' });
  try {
    const response = await fetch(`${origin}/api/invoices/BM-2026-000001/resend`, { method: 'POST' });

    assert.equal(response.status, 503);
    assert.equal(sends.length, 0);
  } finally {
    server.close();
  }
});
