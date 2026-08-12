'use strict';

const express = require('express');

const COMMAND_KEYS = Object.freeze([
  'baseHash',
  'baseRevision',
  'baseState',
  'localState',
  'requestId',
]);

const CLIENT_ERROR_CODES = new Set([
  'BASE_HASH_MISMATCH',
  'INVALID_JSON_VALUE',
  'INVALID_REQUEST_ID',
  'INVALID_REVISION',
  'INVALID_STATE',
  'INVALID_STATE_HASH',
]);

function isExactCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === COMMAND_KEYS.length &&
    keys.every((key, index) => key === COMMAND_KEYS[index]);
}

function createStateRouter({ service, logger = console } = {}) {
  if (
    !service ||
    typeof service.loadState !== 'function' ||
    typeof service.mergeAndSave !== 'function'
  ) {
    throw new TypeError('A state safety service is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('Pragma', 'no-cache');
    next();
  });

  router.get('/', async (_request, response) => {
    try {
      response.json(await service.loadState());
    } catch (error) {
      logger.error('GET /api/state failed', error);
      response.status(500).json({ error: 'state unavailable' });
    }
  });

  router.post('/', async (request, response) => {
    if (!isExactCommand(request.body)) {
      return response.status(400).json({
        error: 'versioned state command required',
      });
    }

    try {
      const result = await service.mergeAndSave(request.body);
      return response.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
      if (error && CLIENT_ERROR_CODES.has(error.code)) {
        return response.status(400).json({ error: 'invalid state command' });
      }
      logger.error('POST /api/state failed', error);
      return response.status(500).json({ error: 'state unavailable' });
    }
  });

  return router;
}

module.exports = { createStateRouter, isExactCommand };
