'use strict';

// The "contact us" form on every generic 404 site-wide (decoy-page.html).
// Unlike decoy-login-route.js (mounted at /api/site/access), this endpoint
// has NO login capability whatsoever — it only ever emails the message to
// Moshe and always responds the same way. A random broken link can never be
// used to reach or guess the real staff login through this endpoint.

const express = require('express');
const { Resend } = require('resend');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

const NOTIFY_TO = 'traviquackson@gmail.com';
const FROM_ADDRESS = 'Bat Melech Website <noreply@batmelech.ae>';

const MessageSchema = z.object({ message: z.string().trim().min(1).max(500) });

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function notifyEmailHtml({ message, path, ip }) {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8" /></head>
<body dir="rtl" style="direction:rtl;font-family:Arial,Helvetica,sans-serif;background:#F7ECE6;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;padding:24px;">
    <p style="font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#F5A83A;margin:0 0 12px;">הודעה חדשה מהאתר</p>
    <p style="font-size:16px;font-weight:700;color:#3B151A;white-space:pre-wrap;margin:0 0 16px;">${escapeHtml(message)}</p>
    <p style="font-size:12px;font-weight:700;color:#3B151A99;margin:0;">נשלח מדף שלא נמצא: ${escapeHtml(path)}<br/>כתובת IP: ${escapeHtml(ip)}</p>
  </div>
</body>
</html>`;
}

async function sendNotification({ apiKey, message, path, ip, logger }) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: NOTIFY_TO,
      subject: 'הודעה חדשה מהאתר (404)',
      html: notifyEmailHtml({ message, path, ip }),
    });
  } catch (error) {
    logger.error('generic contact notification email failed', error);
  }
}

function createGenericContactRouter({ resendApiKey, logger = console }) {
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
      void sendNotification({ apiKey: resendApiKey, message: parsed.data.message, path, ip: request.ip, logger });
    }
    response.status(200).json({ status: 'received' });
  });

  return router;
}

module.exports = { createGenericContactRouter };
