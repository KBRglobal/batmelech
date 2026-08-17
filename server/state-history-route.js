'use strict';

// The owner's safety net: browse the append-only bm_state_versions history
// (every save ever made, immutable by trigger) and restore any snapshot.
// A restore never rewrites history — it saves the old data as a NEW version
// through the same guarded saveState path every other writer uses, so the
// restore itself is also undoable.
//
// Mounted under /api/state (a decoy-gated prefix): staff session required.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const STATE_ID = 1;
const LIST_LIMIT = 80;
const MAX_RESTORE_ATTEMPTS = 5;
const REVISION_PATTERN = /^[1-9]\d{0,15}$/u;

const LIST_SQL = `SELECT replacement_revision, created_at, request_id,
    jsonb_array_length(COALESCE(replacement_data->'orders', '[]'::jsonb)) AS orders_count
  FROM public.bm_state_versions
  WHERE state_id = $1
  ORDER BY replacement_revision DESC
  LIMIT $2`;

const READ_SNAPSHOT_SQL = `SELECT replacement_data
  FROM public.bm_state_versions
  WHERE state_id = $1 AND replacement_revision = $2`;

function createStateHistoryRouter({ pool, repository, logger = console }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg pool is required');
  }
  if (!repository || typeof repository.loadState !== 'function' || typeof repository.saveState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '2kb' }));
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

  router.get('/', async (_request, response) => {
    try {
      const result = await pool.query(LIST_SQL, [STATE_ID, LIST_LIMIT]);
      const versions = result.rows.map((row) => ({
        revision: Number(row.replacement_revision),
        savedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        ordersCount: Number.isSafeInteger(Number(row.orders_count)) ? Number(row.orders_count) : null,
        source: typeof row.request_id === 'string' ? row.request_id.split(':')[0] : '',
      }));
      return response.status(200).json({ versions });
    } catch (error) {
      logger.error('state history list failed', error);
      return response.status(503).json({ error: 'history unavailable' });
    }
  });

  router.post('/:revision/restore', async (request, response) => {
    const rawRevision = request.params.revision;
    if (!REVISION_PATTERN.test(rawRevision)) {
      return response.status(400).json({ error: 'invalid revision' });
    }
    const revision = Number(rawRevision);

    let snapshot;
    try {
      const result = await pool.query(READ_SNAPSHOT_SQL, [STATE_ID, revision]);
      if (result.rows.length !== 1) {
        return response.status(404).json({ error: 'revision not found' });
      }
      snapshot = result.rows[0].replacement_data;
    } catch (error) {
      logger.error('state history snapshot read failed', error);
      return response.status(503).json({ error: 'history unavailable' });
    }
    if (typeof snapshot !== 'object' || snapshot === null || !Array.isArray(snapshot.orders)) {
      return response.status(409).json({ error: 'snapshot is not restorable' });
    }

    for (let attempt = 0; attempt < MAX_RESTORE_ATTEMPTS; attempt += 1) {
      try {
        const current = await repository.loadState();
        if (current.revision === revision) {
          // Restoring the exact version already live is a no-op success.
          return response.status(200).json({ ok: true, revision: current.revision, unchanged: true });
        }
        const saved = await repository.saveState({
          baseState: current.data,
          localState: snapshot,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: `web-restore:${crypto.randomUUID()}`,
        });
        if (saved.ok) {
          return response.status(200).json({ ok: true, revision: saved.revision });
        }
      } catch (error) {
        logger.error('state history restore attempt failed', error);
      }
    }
    return response.status(503).json({ error: 'restore did not complete, please try again' });
  });

  return router;
}

module.exports = { createStateHistoryRouter };
