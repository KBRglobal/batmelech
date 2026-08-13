'use strict';

// Renders a VAT invoice PDF. English-only: pdf-lib's standard fonts have no
// Hebrew glyphs, and a garbled Hebrew PDF is worse than a correct English
// one — English is also an accepted language for UAE FTA invoices.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const VAT_RATE = 0.05;

function money(minorUnits, currency) {
  return `${currency} ${(minorUnits / 100).toFixed(2)}`;
}

async function renderInvoicePdf({
  invoiceNumber,
  issueDate,
  businessName,
  trn,
  businessAddress,
  currency,
  customerName,
  customerEmail,
  lines,
  subtotalMinor,
  vatMinor,
  totalMinor,
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.23, 0.08, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);

  let y = PAGE_HEIGHT - MARGIN;
  const draw = (text, x, size, useFont, color) => {
    page.drawText(text, { x, y, size, font: useFont ?? font, color: color ?? dark });
  };
  const newline = (amount) => {
    y -= amount;
  };

  draw(trn ? 'TAX INVOICE' : 'INVOICE', MARGIN, 20, bold);
  newline(28);
  draw(businessName, MARGIN, 13, bold);
  newline(16);
  if (businessAddress) {
    draw(businessAddress, MARGIN, 10, font, muted);
    newline(14);
  }
  if (trn) {
    draw(`TRN: ${trn}`, MARGIN, 10, font, muted);
    newline(14);
  }

  newline(20);
  draw(`Invoice No: ${invoiceNumber}`, MARGIN, 11, bold);
  draw(`Date: ${issueDate}`, PAGE_WIDTH - MARGIN - 140, 11, bold);
  newline(24);

  draw('Bill To', MARGIN, 10, bold, muted);
  newline(14);
  draw(customerName, MARGIN, 11, font);
  newline(14);
  draw(customerEmail, MARGIN, 10, font, muted);
  newline(30);

  const colItem = MARGIN;
  const colQty = PAGE_WIDTH - MARGIN - 220;
  const colUnit = PAGE_WIDTH - MARGIN - 150;
  const colLineTotal = PAGE_WIDTH - MARGIN - 70;

  draw('Item', colItem, 10, bold, muted);
  draw('Qty', colQty, 10, bold, muted);
  draw('Unit', colUnit, 10, bold, muted);
  draw('Total', colLineTotal, 10, bold, muted);
  newline(6);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: muted,
  });
  newline(16);

  for (const line of lines) {
    const name = line.name.length > 48 ? `${line.name.slice(0, 45)}...` : line.name;
    draw(name, colItem, 10, font);
    draw(String(line.qty), colQty, 10, font);
    draw(money(line.unitPriceMinor, currency), colUnit, 10, font);
    draw(money(line.unitPriceMinor * line.qty, currency), colLineTotal, 10, font);
    newline(16);
  }

  newline(10);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: muted,
  });
  newline(20);

  const summaryLabelX = PAGE_WIDTH - MARGIN - 150;
  const summaryValueX = PAGE_WIDTH - MARGIN - 70;
  draw('Subtotal', summaryLabelX, 10, font, muted);
  draw(money(subtotalMinor, currency), summaryValueX, 10, font);
  newline(16);
  if (trn) {
    draw(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, summaryLabelX, 10, font, muted);
    draw(money(vatMinor, currency), summaryValueX, 10, font);
    newline(16);
  }
  draw('Total', summaryLabelX, 12, bold);
  draw(money(totalMinor, currency), summaryValueX, 12, bold);
  newline(40);

  draw('Bat Melech Kitchen — batmelech.ae', MARGIN, 8, font, muted);

  return doc.save();
}

function computeVatInclusiveBreakdown(totalMinor, vatRegistered) {
  if (!vatRegistered) {
    return { subtotalMinor: totalMinor, vatMinor: 0, totalMinor };
  }
  const vatMinor = Math.round(totalMinor - totalMinor / (1 + VAT_RATE));
  return { subtotalMinor: totalMinor - vatMinor, vatMinor, totalMinor };
}

module.exports = { renderInvoicePdf, computeVatInclusiveBreakdown, VAT_RATE };
