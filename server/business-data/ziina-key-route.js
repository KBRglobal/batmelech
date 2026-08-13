'use strict';

// Admin-only (mounted after the Basic Auth wall). Write-only: the stored key
// is never read back to the browser, only whether one is configured.

const express = require('express');
const { z } = require('zod');
const { encryptSecret } = require('./secret-box');
const { setZiinaApiKeyCiphertext, getZiinaApiKeyCiphertext } = require('./repository');

const KeySchema = z.object({ apiKey: z.string().trim().min(10).max(2_000) });

function createZiinaKeyRouter({ pool, encryptionKey, logger = console }) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/status', async (_request, response) => {
    try {
      const ciphertext = await getZiinaApiKeyCiphertext(pool);
      response.json({ configured: typeof ciphertext === 'string' && ciphertext.length > 0 });
    } catch (error) {
      logger.error('GET ziina-key status failed', error);
      response.status(500).json({ error: 'status unavailable' });
    }
  });

  router.post('/', async (request, response) => {
    const parsed = KeySchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'invalid key' });
    try {
      const ciphertext = encryptSecret(parsed.data.apiKey, encryptionKey);
      await setZiinaApiKeyCiphertext(pool, ciphertext);
      response.status(200).json({ configured: true });
    } catch (error) {
      logger.error('POST ziina-key failed', error);
      response.status(500).json({ error: 'could not save key' });
    }
  });

  return router;
}

module.exports = { createZiinaKeyRouter };
