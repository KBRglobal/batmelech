'use strict';

// Staff-only panel API over מיי's audit log: browse her recent changes, undo
// any one of them, and control the emergency freeze. Mounted behind the
// decoy gate — never public. Unfreeze lives ONLY here by design: a
// compromised Telegram chat must not be able to lift its own freeze.

const crypto = require('node:crypto');
const express = require('express');
const {
  freezeWrites,
  readAuditLog,
  undoMeyChange,
  unfreezeWrites,
} = require('./mey-audited-actions');

function createMeyAuditRouter({ repository, logger = console } = {}) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (_request, response) => {
    try {
      const log = await readAuditLog(repository);
      return response.status(200).json(log);
    } catch (error) {
      logger.error('mey audit read failed', error);
      return response.status(503).json({ error: 'audit unavailable' });
    }
  });

  router.post('/undo', async (request, response) => {
    const entryId = typeof request.body?.entryId === 'string' ? request.body.entryId.trim() : '';
    try {
      const result = await undoMeyChange(repository, entryId === '' ? undefined : entryId);
      if (!result.ok) return response.status(409).json({ error: result.error });
      return response.status(200).json({ ok: true, undone: result.undone });
    } catch (error) {
      logger.error('mey audit undo failed', error);
      return response.status(503).json({ error: 'undo failed' });
    }
  });

  // Lin's stored WhatsApp reply voice (spec: tone defined once and reused by
  // every drafted reply). Empty string clears it.
  router.get('/reply-style', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      const style = typeof settings.waReplyStyle === 'string' ? settings.waReplyStyle : '';
      return response.status(200).json({ style });
    } catch (error) {
      logger.error('mey reply style read failed', error);
      return response.status(503).json({ error: 'style unavailable' });
    }
  });

  router.post('/reply-style', async (request, response) => {
    const style = request.body?.style;
    if (typeof style !== 'string' || style.length > 2000) {
      return response.status(400).json({ error: 'style must be a string up to 2000 chars' });
    }
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await repository.loadState();
        const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
        const next = { ...settings };
        if (style.trim() === '') delete next.waReplyStyle;
        else next.waReplyStyle = style.trim();
        const saved = await repository.saveState({
          baseState: current.data,
          localState: { ...current.data, settings: next },
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) return response.status(200).json({ ok: true });
      }
      return response.status(503).json({ error: 'save failed' });
    } catch (error) {
      logger.error('mey reply style save failed', error);
      return response.status(503).json({ error: 'save failed' });
    }
  });

  router.post('/freeze', async (request, response) => {
    const frozen = request.body?.frozen;
    if (typeof frozen !== 'boolean') {
      return response.status(400).json({ error: 'frozen must be a boolean' });
    }
    try {
      const result = frozen ? await freezeWrites(repository) : await unfreezeWrites(repository);
      if (!result.ok) return response.status(503).json({ error: result.error });
      return response.status(200).json({ ok: true, frozen });
    } catch (error) {
      logger.error('mey audit freeze failed', error);
      return response.status(503).json({ error: 'freeze failed' });
    }
  });

  return router;
}

module.exports = { createMeyAuditRouter };
