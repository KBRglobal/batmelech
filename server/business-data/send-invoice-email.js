'use strict';

const { Resend } = require('resend');

const FROM_ADDRESS = 'Bat Melech Kitchen <invoices@batmelech.ae>';

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function invoiceEmailHtml({ businessName, invoiceNumber, customerName, deliveryAddress }) {
  const safeBusinessName = escapeHtml(businessName);
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safeCustomerName = escapeHtml(customerName || '');
  const safeAddress = deliveryAddress ? escapeHtml(deliveryAddress) : ''
  const addressLine = safeAddress
    ? `המשלוח יוצא במיוחד עבורכם אל: <strong>${safeAddress}</strong>.`
    : 'המשלוח יוצא במיוחד עבורכם, בהתאם לפרטים שסוכמו.'
  return `<!doctype html>
<html dir="rtl" lang="he">
<body style="margin:0;padding:0;background:#F7ECE6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7ECE6;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:28px;overflow:hidden;box-shadow:0 8px 32px rgba(59,21,26,0.12);">
        <tr><td style="background:#3B151A;padding:36px 32px;text-align:center;">
          <img src="https://www.batmelech.ae/site/assets/logo-cream.png" width="72" height="72" alt="${safeBusinessName}" style="display:block;margin:0 auto 12px;" />
          <span style="color:#F5A83A;font-size:13px;font-weight:900;letter-spacing:0.15em;text-transform:uppercase;">${safeBusinessName}</span>
        </td></tr>
        <tr><td style="padding:36px 32px 8px;text-align:right;color:#3B151A;">
          <p style="font-size:20px;font-weight:900;margin:0 0 20px;">שלום ${safeCustomerName}, ותודה מכל הלב!</p>
          <p style="font-size:15px;line-height:1.8;margin:0 0 20px;">שמחנו להכין עבורכם ארוחה ביתית, טרייה וכשרה — בדיוק כמו בבית. מצורפת לכם החשבונית, מספר <strong>${safeInvoiceNumber}</strong>.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7ECE6;border-radius:18px;">
            <tr><td style="padding:20px 24px;text-align:right;">
              <p style="font-size:12px;font-weight:900;color:#8D182C;letter-spacing:0.05em;margin:0 0 8px;text-transform:uppercase;">לתשומת לבכם</p>
              <p style="font-size:14px;line-height:1.7;color:#3B151A;margin:0;">${addressLine} נשמח שתהיו זמינים במקום בשעה שנקבעה, כדי שנוכל להגיש לכם הכל טרי וחם בדיוק בזמן.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 32px;text-align:right;color:#3B151A;">
          <p style="font-size:15px;line-height:1.7;margin:0 0 6px;">בתיאבון, ושבת שלום ומבורך!</p>
          <p style="font-size:13px;color:#3B151A99;margin:0;">שאלה כלשהי? אנחנו כאן בוואטסאפ, תמיד.</p>
        </td></tr>
        <tr><td style="padding:22px 32px;background:#F7ECE6;text-align:center;">
          <span style="font-size:11px;color:#3B151A99;">${safeBusinessName}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendInvoiceEmail({ apiKey, toEmail, invoiceNumber, pdfBytes, businessName, customerName, deliveryAddress }) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `חשבונית ${invoiceNumber} — ${businessName}`,
    html: invoiceEmailHtml({ businessName, invoiceNumber, customerName, deliveryAddress }),
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
