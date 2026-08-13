'use strict';

const { Resend } = require('resend');

const FROM_ADDRESS = 'Bat Melech Kitchen <invoices@batmelech.ae>';

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const HERO_IMAGE_URL =
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/fbh1mGqHGeE.jpeg';
const LOGO_URL = 'https://www.batmelech.ae/site/assets/logo-cream.png';
const WA_URL = 'https://wa.me/971586288776';

// Table-based layout, every rule inline. Email clients (Gmail, Outlook,
// Apple Mail) run no JavaScript and only a narrow, inconsistent subset of
// CSS — no Tailwind CDN, no <style> blocks reliably applied, no custom
// elements like iconify-icon. A page built like a website renders as a
// broken wall of unstyled text and literal icon tags in a real inbox.
function invoiceEmailHtml({ businessName, invoiceNumber, customerName, deliveryAddress }) {
  const safeBusinessName = escapeHtml(businessName);
  const safeInvoiceNumber = escapeHtml(invoiceNumber);
  const safeCustomerName = escapeHtml(customerName || '');
  const safeAddress = deliveryAddress ? escapeHtml(deliveryAddress) : '';

  const addressBlock = safeAddress
    ? `<tr><td style="padding:0 0 16px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;border:1px solid #EDB2C1;">
           <tr><td style="padding:18px 20px;text-align:right;">
             <span style="display:block;color:#3B151A;font-size:17px;font-weight:900;">${safeAddress}</span>
           </td></tr>
         </table>
       </td></tr>`
    : '';

  return `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#F7ECE6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7ECE6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:28px;overflow:hidden;">

        <tr><td style="background:#3B151A;padding:32px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
            <tr><td width="72" height="72" style="background:#ffffff;border-radius:36px;text-align:center;vertical-align:middle;">
              <img src="${LOGO_URL}" width="44" height="44" alt="${safeBusinessName}" style="display:inline-block;vertical-align:middle;" />
            </td></tr>
          </table>
          <span style="color:#ffffff;font-size:12px;font-weight:900;letter-spacing:0.25em;text-transform:uppercase;opacity:0.7;">${safeBusinessName}</span>
        </td></tr>

        <tr><td>
          <img src="${HERO_IMAGE_URL}" width="560" alt="" style="display:block;width:100%;height:auto;" />
        </td></tr>

        <tr><td style="padding:32px 32px 8px;text-align:right;">
          <h1 style="margin:0 0 18px;font-size:26px;font-weight:900;color:#3B151A;line-height:1.3;">
            שלום ${safeCustomerName},<br /><span style="color:#F5A83A;">ותודה מכל הלב!</span>
          </h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.8;color:#3B151A;font-weight:600;">
            שמחנו להכין עבורכם ארוחה ביתית, טרייה וכשרה — בדיוק כמו בבית. מצורפת לכם החשבונית, מספר
            <strong>${safeInvoiceNumber}</strong>.
          </p>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDF5F2;border-radius:24px;">
            <tr><td style="padding:24px;text-align:right;">
              <p style="margin:0 0 14px;font-size:18px;font-weight:900;color:#F5A83A;">לתשומת לבכם</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${addressBlock}
                <tr><td style="padding:0 0 14px;font-size:15px;line-height:1.8;color:#3B151A;font-weight:600;">
                  המשלוח יוצא במיוחד עבורכם. נשמח שתהיו זמינים במקום בשעה שנקבעה, כדי שנוכל להגיש לכם הכל טרי וחם בדיוק בזמן.
                </td></tr>
                <tr><td style="padding:14px 16px;background:#FDECEC;border-radius:14px;border:1px solid #F7CACA;font-size:13px;line-height:1.7;color:#B42318;font-weight:700;">
                  שימו לב: במידה ולא יהיה מענה לקבלת המשלוח במועד ובמקום שנקבעו, המשלוח יוחזר לבית העסק והלקוח יחויב בתשלום משלוח נוסף עבור אספקה מחודשת.
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#3B151A0D;border-radius:24px;">
            <tr><td style="padding:20px 24px;text-align:right;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:900;color:#3B151A;">הזמנת פלטת שבת?</p>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#3B151A;opacity:0.8;font-weight:600;">
                לתשומת לבכם, הציוד כפוף לתשלום פיקדון. הכנסת הפלטה למלון כפופה לנהלי המלון וייתכן שהמלון יערים קשיים. האחריות על תיאום וקבלת אישור מול המלון הינה באחריות המזמין בלבד.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px;text-align:center;">
          <p style="margin:0;font-size:18px;font-weight:900;font-style:italic;color:#3B151A;">בתיאבון, ושבת שלום ומבורך!</p>
        </td></tr>

        <tr><td style="padding:0 32px 32px;text-align:center;">
          <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#3B151A99;">שאלה כלשהי? אנחנו כאן בוואטסאפ, תמיד.</p>
          <a href="${WA_URL}" style="display:inline-block;background:#25D366;color:#ffffff;font-size:16px;font-weight:900;padding:16px 32px;border-radius:999px;text-decoration:none;">דברו איתנו בוואטסאפ</a>
        </td></tr>

        <tr><td style="padding:20px 32px;background:#F7ECE6;text-align:center;">
          <span style="font-size:11px;color:#3B151A99;">${safeBusinessName} · batmelech.ae</span>
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
