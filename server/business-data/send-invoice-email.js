'use strict';

const { Resend } = require('resend');

const FROM_ADDRESS = 'Bat Melech Kitchen <invoices@batmelech.ae>';

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function invoiceEmailHtml({ businessName, invoiceNumber, customerName }) {
  const safeBusinessName = escapeHtml(businessName);
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safeCustomerName = escapeHtml(customerName || '');
  return `<!doctype html>
<html dir="rtl" lang="he">
<body style="margin:0;padding:0;background:#F7ECE6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7ECE6;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(59,21,26,0.08);">
        <tr><td style="background:#3B151A;padding:28px 32px;text-align:center;">
          <span style="color:#F5A83A;font-size:20px;font-weight:900;">${safeBusinessName}</span>
        </td></tr>
        <tr><td style="padding:32px;text-align:right;color:#3B151A;">
          <p style="font-size:16px;font-weight:700;margin:0 0 16px;">שלום ${safeCustomerName},</p>
          <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">תודה על ההזמנה! מצורפת החשבונית שלכם (${safeInvoiceNumber}).</p>
          <p style="font-size:13px;color:#8D182C;line-height:1.6;margin:0;">בכל שאלה אפשר לפנות אלינו בוואטסאפ.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#F7ECE6;text-align:center;">
          <span style="font-size:11px;color:#3B151A99;">${safeBusinessName}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendInvoiceEmail({ apiKey, toEmail, invoiceNumber, pdfBytes, businessName, customerName }) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `חשבונית ${invoiceNumber} — ${businessName}`,
    html: invoiceEmailHtml({ businessName, invoiceNumber, customerName }),
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: Buffer.from(pdfBytes).toString('base64'),
      },
    ],
  });
  if (error) {
    throw new Error(typeof error === 'string' ? error : error.message || 'Resend send failed');
  }
}

module.exports = { sendInvoiceEmail, invoiceEmailHtml };
