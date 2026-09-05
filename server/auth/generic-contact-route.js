'use strict';

// The "contact us" form on every generic 404 site-wide (decoy-page.html).
// Unlike decoy-login-route.js (mounted at /api/site/access), this endpoint
// has NO login capability whatsoever — it only ever emails the message
// (when CONTACT_NOTIFY_EMAIL and CONTACT_FROM_EMAIL are set) and always
// responds the same way. A random broken link can never be used to reach
// or guess the real staff login through this endpoint.

const express = require('express');
const { Resend } = require('resend');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

const MessageSchema = z.object({ message: z.string().trim().min(1).max(500) });

function envAddress(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function notifyEmailHtml({ message, path }) {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8" /></head>
<body dir="rtl" style="direction:rtl;font-family:Arial,Helvetica,sans-serif;background:#F7ECE6;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;padding:24px;">
    <p style="font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#F5A83A;margin:0 0 12px;">הודעה חדשה מהאתר</p>
    <p style="font-size:16px;font-weight:700;color:#3B151A;white-space:pre-wrap;margin:0 0 16px;">${escapeHtml(message)}</p>
    <p style="font-size:12px;font-weight:700;color:#3B151A99;margin:0;">נשלח מדף שלא נמצא: ${escapeHtml(path)}</p>
  </div>
</body>
</html>`;
}

async function sendNotification({ apiKey, message, path, logger, sendEmail }) {
  const notifyTo = envAddress('CONTACT_NOTIFY_EMAIL');
  const fromAddress = envAddress('CONTACT_FROM_EMAIL');
  if (!notifyTo || !fromAddress) return;
  if (typeof apiKey !== 'string' || apiKey.length === 0) return;
  const payload = {
    from: fromAddress,
    to: notifyTo,
    subject: 'הודעה חדשה מהאתר (404)',
    html: notifyEmailHtml({ message, path }),
  };
  try {
    if (typeof sendEmail === 'function') {
      await sendEmail(payload);
      return;
    }
    const resend = new Resend(apiKey);
    await resend.emails.send(payload);
  } catch (error) {
    logger.error('generic contact notification email failed', error);
  }
}

function createGenericContactRouter({ resendApiKey, logger = console, sendEmail }) {
  const router = express.Router();

  router.use(express.json({ limit: '2kb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/', (request, response) => {
    const parsed = MessageSchema.safeParse(request.body);
    if (parsed.success) {
      const path = typeof request.headers.referer === 'string' ? request.headers.referer : 'unknown';
      void sendNotification({ apiKey: resendApiKey, message: parsed.data.message, path, logger, sendEmail });
    }
    response.status(200).json({ status: 'received' });
  });

  return router;
}

module.exports = { createGenericContactRouter };
