'use strict';

// Dish photo upload for the menu editor. Sits behind the admin decoy gate
// (mounted under /api/settings, already in PROTECTED_PREFIXES) — never
// reachable without a valid staff session.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+=*)$/u;

const UploadSchema = z.object({
  imageBase64: z.string().min(1).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100),
});

function createMenuImageRouter({ storage, quota = null, logger = console }) {
  if (!storage || typeof storage.putMenuItemImage !== 'function') {
    throw new TypeError('An R2 storage instance with putMenuItemImage is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '7mb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/', async (request, response) => {
    const parsed = UploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalid upload' });
    }

    const match = DATA_URL_PATTERN.exec(parsed.data.imageBase64);
    if (!match) {
      return response.status(400).json({ error: 'expected a base64 JPEG, PNG, or WebP data URL' });
    }
    const [, contentType, base64Body] = match;
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return response.status(400).json({ error: 'unsupported image type' });
    }

    const buffer = Buffer.from(base64Body, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return response.status(400).json({ error: 'image must be non-empty and under 5MB' });
    }

    // The storage plan is metered and enforced server-side.
    if (quota && (await quota.isOverQuota(buffer.byteLength))) {
      return response.status(413).json({
        error: 'storage limit reached',
        code: 'STORAGE_LIMIT',
        message: 'חבילת האחסון מלאה. יש לרכוש הרחבת אחסון כדי להעלות תמונות נוספות.',
      });
    }

    const uploaded = await storage.putMenuItemImage({ buffer, contentType });
    if (!uploaded) {
      logger.error('menu image upload failed');
      return response.status(503).json({ error: 'upload failed, please try again' });
    }

    if (quota) quota.invalidateCache();
    return response.status(201).json({ url: uploaded.url });
  });

  return router;
}

module.exports = { createMenuImageRouter };
