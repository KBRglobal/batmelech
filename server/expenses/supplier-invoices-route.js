'use strict';

// Supplier expenses: upload an invoice (PDF or photo), scan it with AI into
// categorized line items, and manage the archive. Files live in R2 under
// invoices/<yyyy-mm>/ and count toward the client's metered storage plan.
// They are sensitive business documents — nothing is served from the public
// bucket URL; reads stream back through this authenticated route only.
//
// Sits behind the admin decoy gate (mounted under /api/settings, already in
// PROTECTED_PREFIXES) — never reachable without a valid staff session.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const repository = require('./repository');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+=*)$/u;

const UploadSchema = z.object({
  fileBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 100),
  fileName: z.string().min(1).max(120),
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

function createSupplierInvoicesRouter({ pool, storage, scanner, quota = null, logger = console }) {
  if (!pool) throw new TypeError('A pg pool is required');
  if (!storage || typeof storage.putInvoiceFile !== 'function') {
    throw new TypeError('An R2 storage instance with putInvoiceFile is required');
  }
  if (typeof scanner !== 'function') throw new TypeError('An invoice scanner function is required');

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

  async function runScan(record, buffer, contentType) {
    try {
      const scan = await scanner({ buffer, contentType, fileName: record.fileName });
      return await repository.saveScanResult(pool, record.id, {
        merchant: scan.merchant,
        purchasedAt: scan.purchasedAt,
        currency: scan.currency,
        totalMinor: scan.totalMinor,
        items: scan.items,
      });
    } catch (error) {
      logger.error('invoice scan failed:', error?.message || error);
      return await repository.saveScanFailure(pool, record.id, error?.message || 'scan failed');
    }
  }

  router.get('/', async (_request, response) => {
    try {
      const invoices = await repository.listSupplierInvoices(pool);
      response.json({ invoices });
    } catch (error) {
      logger.error('supplier invoices list failed:', error?.message || error);
      response.status(502).json({ error: 'archive unavailable' });
    }
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

    let record;
    try {
      record = await repository.createSupplierInvoice(pool, {
        r2Key: uploaded.key,
        fileName: parsed.data.fileName,
      });
    } catch (error) {
      logger.error('supplier invoice insert failed:', error?.message || error);
      return response.status(502).json({ error: 'archive unavailable' });
    }

    const scanned = await runScan(record, buffer, contentType);
    return response.status(201).json({ invoice: scanned || record });
  });

  router.post('/:id/rescan', async (request, response) => {
    try {
      const record = await repository.getSupplierInvoice(pool, request.params.id);
      if (!record) return response.status(404).json({ error: 'not found' });
      const file = await storage.getInvoiceFile(record.r2Key);
      if (!file) return response.status(404).json({ error: 'file missing' });
      const scanned = await runScan(record, file.buffer, file.contentType);
      return response.json({ invoice: scanned || record });
    } catch (error) {
      logger.error('supplier invoice rescan failed:', error?.message || error);
      return response.status(502).json({ error: 'rescan failed' });
    }
  });

  // Manual correction for a misread purchase date — the human reading of the
  // printed document is the source of truth, above any scan.
  router.patch('/:id/date', async (request, response) => {
    const parsed = z.object({ purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalid date' });
    }
    if (parsed.data.purchasedAt > new Date().toISOString().slice(0, 10)) {
      return response.status(400).json({ error: 'a purchase date cannot be in the future' });
    }
    try {
      const updated = await repository.setPurchasedAt(pool, request.params.id, parsed.data.purchasedAt);
      if (!updated) return response.status(404).json({ error: 'not found' });
      return response.json({ invoice: updated });
    } catch (error) {
      logger.error('supplier invoice date update failed:', error?.message || error);
      return response.status(502).json({ error: 'update failed' });
    }
  });

  router.get('/file', async (request, response) => {
    const key = typeof request.query.key === 'string' ? request.query.key : '';
    const file = await storage.getInvoiceFile(key);
    if (!file) {
      return response.status(404).json({ error: 'not found' });
    }
    response.type(file.contentType).send(file.buffer);
  });

  router.delete('/:id', async (request, response) => {
    try {
      const r2Key = await repository.deleteSupplierInvoice(pool, request.params.id);
      if (!r2Key) return response.status(404).json({ error: 'not found' });
      await storage.deleteInvoiceFile(r2Key);
      if (quota) quota.invalidateCache();
      return response.json({ ok: true });
    } catch (error) {
      logger.error('supplier invoice delete failed:', error?.message || error);
      return response.status(502).json({ error: 'delete failed' });
    }
  });

  return router;
}

module.exports = { createSupplierInvoicesRouter };
