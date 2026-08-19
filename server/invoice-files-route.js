'use strict';

// Supplier invoice archive: upload, list, view and delete scanned invoices
// (PDF or photo). Files live in R2 under invoices/<yyyy-mm>/ and count
// toward the client's metered storage plan. They are sensitive business
// documents, so nothing is served from the public bucket URL — reads are
// streamed back through this authenticated route only.
//
// Sits behind the admin decoy gate (mounted under /api/settings, already in
// PROTECTED_PREFIXES) — never reachable without a valid staff session.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+=*)$/u;

const UploadSchema = z.object({
  fileBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 100),
  fileName: z.string().min(1).max(120),
});

const DeleteSchema = z.object({
  key: z.string().min(1).max(300),
});

// The declared content type is never trusted — the first bytes must match.
function sniffMatchesDeclared(buffer, contentType) {
  if (contentType === 'application/pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (contentType === 'image/webp') {
    return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  return false;
}

function createInvoiceFilesRouter({ storage, quota = null, logger = console }) {
  if (!storage || typeof storage.putInvoiceFile !== 'function') {
    throw new TypeError('An R2 storage instance with putInvoiceFile is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '14mb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (_request, response) => {
    const files = await storage.listInvoiceFiles();
    if (files === null) {
      return response.status(502).json({ error: 'invoice archive unavailable' });
    }
    response.json({ files });
  });

  router.post('/', async (request, response) => {
    const parsed = UploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalid upload' });
    }

    const match = DATA_URL_PATTERN.exec(parsed.data.fileBase64);
    if (!match) {
      return response.status(400).json({ error: 'expected a base64 PDF, JPEG, PNG, or WebP data URL' });
    }
    const [, contentType, base64Body] = match;

    const buffer = Buffer.from(base64Body, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_BYTES) {
      return response.status(400).json({ error: 'file must be non-empty and under 10MB' });
    }
    if (!sniffMatchesDeclared(buffer, contentType)) {
      return response.status(400).json({ error: 'file content does not match its declared type' });
    }

    // The storage plan is metered and enforced server-side.
    if (quota && (await quota.isOverQuota(buffer.byteLength))) {
      return response.status(413).json({
        error: 'storage limit reached',
        code: 'STORAGE_LIMIT',
        message: 'חבילת האחסון מלאה. יש לרכוש הרחבת אחסון כדי להעלות קבצים נוספים.',
      });
    }

    const uploaded = await storage.putInvoiceFile({
      buffer,
      contentType,
      fileName: parsed.data.fileName,
    });
    if (!uploaded) {
      logger.error('invoice file upload failed');
      return response.status(503).json({ error: 'upload failed, please try again' });
    }

    if (quota) quota.invalidateCache();
    return response.status(201).json({ key: uploaded.key });
  });

  router.get('/file', async (request, response) => {
    const key = typeof request.query.key === 'string' ? request.query.key : '';
    const file = await storage.getInvoiceFile(key);
    if (!file) {
      return response.status(404).json({ error: 'not found' });
    }
    response.type(file.contentType).send(file.buffer);
  });

  router.delete('/', async (request, response) => {
    const parsed = DeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalid request' });
    }
    const deleted = await storage.deleteInvoiceFile(parsed.data.key);
    if (!deleted) {
      return response.status(404).json({ error: 'not found' });
    }
    if (quota) quota.invalidateCache();
    return response.json({ ok: true });
  });

  return router;
}

module.exports = { createInvoiceFilesRouter };
