'use strict';

// Renders a VAT invoice PDF. English-only: pdf-lib's standard fonts have no
// Hebrew glyphs, and a garbled Hebrew PDF is worse than a correct English
// one — English is also an accepted language for UAE FTA invoices.

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const VAT_RATE = 0.05;

const HEADER_HEIGHT = 118;
const LOGO_PATH = path.join(__dirname, '..', '..', 'site', 'assets', 'logo-cream.png');

const DARK = rgb(0.231, 0.082, 0.102); // #3B151A
const GOLD = rgb(0.961, 0.659, 0.227); // #F5A83A
const BURGUNDY = rgb(0.553, 0.094, 0.173); // #8D182C
const CREAM = rgb(0.969, 0.925, 0.902); // #F7ECE6
const WHITE = rgb(1, 1, 1);
const MUTED = rgb(0.42, 0.4, 0.4);

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
  customerPhone,
  lines,
  subtotalMinor,
  vatMinor,
  totalMinor,
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const draw = (text, x, y, size, useFont, color) => {
    page.drawText(text, { x, y, size, font: useFont ?? font, color: color ?? DARK });
  };
  const rect = (x, y, width, height, color, opacity) => {
    page.drawRectangle({ x, y, width, height, color, opacity });
  };

  // --- Header band ---
  rect(0, PAGE_HEIGHT - HEADER_HEIGHT, PAGE_WIDTH, HEADER_HEIGHT, DARK);
  let logoWidth = 0;
  try {
    const logoBytes = fs.readFileSync(LOGO_PATH);
    const logoImage = await doc.embedPng(logoBytes);
    const scale = 56 / logoImage.height;
    logoWidth = logoImage.width * scale;
    page.drawImage(logoImage, {
      x: MARGIN,
      y: PAGE_HEIGHT - HEADER_HEIGHT + (HEADER_HEIGHT - 56) / 2,
      width: logoWidth,
      height: 56,
    });
  } catch {
    // Logo optional — invoice still renders correctly without it.
  }
  const nameX = MARGIN + (logoWidth ? logoWidth + 16 : 0);
  draw(businessName, nameX, PAGE_HEIGHT - HEADER_HEIGHT / 2 + 6, 15, bold, WHITE);
  draw('KOSHER HOME KITCHEN — DUBAI, UAE', nameX, PAGE_HEIGHT - HEADER_HEIGHT / 2 - 10, 8, bold, GOLD);

  const labelText = trn ? 'TAX INVOICE' : 'INVOICE';
  const labelWidth = bold.widthOfTextAtSize(labelText, 16);
  draw(labelText, PAGE_WIDTH - MARGIN - labelWidth, PAGE_HEIGHT - HEADER_HEIGHT / 2 + 6, 16, bold, GOLD);
  const metaText = `${invoiceNumber}  ·  ${issueDate}`;
  const metaWidth = font.widthOfTextAtSize(metaText, 9);
  draw(metaText, PAGE_WIDTH - MARGIN - metaWidth, PAGE_HEIGHT - HEADER_HEIGHT / 2 - 10, 9, font, CREAM);

  // --- Business / Bill To two-column strip ---
  let y = PAGE_HEIGHT - HEADER_HEIGHT - 34;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - 24) / 2;

  draw('FROM', MARGIN, y, 8, bold, BURGUNDY);
  draw('BILL TO', MARGIN + colWidth + 24, y, 8, bold, BURGUNDY);
  y -= 16;
  draw(businessAddress || '—', MARGIN, y, 10, font);
  draw(customerName || '—', MARGIN + colWidth + 24, y, 10, bold);
  y -= 14;
  if (trn) draw(`TRN: ${trn}`, MARGIN, y, 9, font, MUTED);
  draw(customerEmail || '—', MARGIN + colWidth + 24, y, 9, font, MUTED);
  // A walk-in invoice may carry a phone instead of an email; it belongs on the
  // document, under whichever contact line came first.
  if (customerPhone) {
    y -= 13;
    draw(customerPhone, MARGIN + colWidth + 24, y, 9, font, MUTED);
  }

  // --- Line items table ---
  y -= 34;
  const tableTop = y;
  const colItem = MARGIN + 12;
  const colQty = PAGE_WIDTH - MARGIN - 210;
  const colUnit = PAGE_WIDTH - MARGIN - 140;
  const colLineTotal = PAGE_WIDTH - MARGIN - 12;

  rect(MARGIN, tableTop - 26, PAGE_WIDTH - MARGIN * 2, 26, DARK);
  draw('DESCRIPTION', colItem, tableTop - 17, 8, bold, CREAM);
  draw('QTY', colQty, tableTop - 17, 8, bold, CREAM);
  draw('UNIT PRICE', colUnit, tableTop - 17, 8, bold, CREAM);
  const totalHeaderWidth = bold.widthOfTextAtSize('LINE TOTAL', 8);
  draw('LINE TOTAL', colLineTotal - totalHeaderWidth, tableTop - 17, 8, bold, CREAM);

  let rowY = tableTop - 26;
  lines.forEach((line, index) => {
    const rowHeight = 28;
    if (index % 2 === 1) rect(MARGIN, rowY - rowHeight, PAGE_WIDTH - MARGIN * 2, rowHeight, CREAM);
    const name = line.name.length > 56 ? `${line.name.slice(0, 53)}...` : line.name;
    draw(name, colItem, rowY - 18, 10, font);
    draw(String(line.qty), colQty, rowY - 18, 10, font);
    draw(money(line.unitPriceMinor, currency), colUnit, rowY - 18, 10, font);
    const lineTotalText = money(line.unitPriceMinor * line.qty, currency);
    const lineTotalWidth = font.widthOfTextAtSize(lineTotalText, 10);
    draw(lineTotalText, colLineTotal - lineTotalWidth, rowY - 18, 10, font);
    rowY -= rowHeight;
  });
  page.drawRectangle({
    x: MARGIN,
    y: rowY,
    width: PAGE_WIDTH - MARGIN * 2,
    height: tableTop - rowY,
    borderColor: DARK,
    borderWidth: 0.75,
  });

  // --- Totals ---
  y = rowY - 24;
  const summaryLabelX = PAGE_WIDTH - MARGIN - 190;
  const summaryValueRight = PAGE_WIDTH - MARGIN - 12;

  const drawSummaryRow = (label, valueText, size, useFont, color) => {
    draw(label, summaryLabelX, y, size, useFont, color);
    const width = useFont.widthOfTextAtSize(valueText, size);
    draw(valueText, summaryValueRight - width, y, size, useFont, color);
  };

  drawSummaryRow('Subtotal', money(subtotalMinor, currency), 10, font, MUTED);
  y -= 18;
  if (trn) {
    drawSummaryRow(`VAT (${(VAT_RATE * 100).toFixed(0)}%)`, money(vatMinor, currency), 10, font, MUTED);
    y -= 18;
  }
  y -= 6;
  rect(summaryLabelX - 12, y - 10, summaryValueRight - summaryLabelX + 24, 30, GOLD);
  draw('TOTAL', summaryLabelX, y, 11, bold, DARK);
  const totalText = money(totalMinor, currency);
  const totalWidth = bold.widthOfTextAtSize(totalText, 13);
  draw(totalText, summaryValueRight - totalWidth, y - 1, 13, bold, DARK);

  // --- Footer band ---
  const footerHeight = 32;
  rect(0, 0, PAGE_WIDTH, footerHeight, DARK);
  const footerText = `${businessName}  ·  batmelech.ae  ·  Thank you for your order`;
  const footerWidth = font.widthOfTextAtSize(footerText, 8);
  draw(footerText, (PAGE_WIDTH - footerWidth) / 2, 12, 8, font, CREAM);

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
