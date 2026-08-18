'use strict';

const { Resend } = require('resend');

const FROM_ADDRESS = 'Bat Melech Kitchen <invoices@batmelech.ae>';

function backupEmailHtml(dateString) {
  const safeDate = String(dateString).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8" /></head>
<body dir="rtl" style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;direction:rtl;background:#F7ECE6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:28px;padding:32px;text-align:right;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#3B151A;">גיבוי שבועי — Bat Melech</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3B151A;font-weight:600;">
            מצורף קובץ הגיבוי השבועי של המערכת מתאריך ${safeDate}.
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#3B151A99;font-weight:600;">
            זהו מייל אוטומטי — אין להשיב עליו.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendBackupEmail({ apiKey, toEmail, artifact }) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  if (typeof toEmail !== 'string' || toEmail.trim() === '') {
    throw new Error('toEmail is required');
  }
  if (!artifact || typeof artifact.content !== 'string' || typeof artifact.filename !== 'string') {
    throw new Error('artifact must have filename and content');
  }
  const resend = new Resend(apiKey);
  const dateString = artifact.filename.replace(/^batmelech-orders-/, '').replace(/\.json$/, '');
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail.trim(),
    subject: `Bat Melech weekly backup — ${dateString}`,
    html: backupEmailHtml(dateString),
    attachments: [
      {
        filename: artifact.filename,
        content: Buffer.from(artifact.content, 'utf8').toString('base64'),
      },
    ],
  });
  if (error) {
    throw new Error(typeof error === 'string' ? error : error.message || 'Resend send failed');
  }
}

module.exports = { sendBackupEmail, backupEmailHtml };
