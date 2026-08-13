'use strict';

// Admin-only (mounted after the staff gate). Write-only: whatever Lin sets
// here is encrypted at rest and never echoed back — same shape as
// ziina-key-route.js. decoy-login-route.js reads the ciphertext through
// getStaffCredentialCiphertexts() on every login attempt, so a change here
// takes effect immediately, no redeploy or restart needed.

const express = require('express');
const { z } = require('zod');
const { encryptSecret } = require('../business-data/secret-box');
const { setStaffCredentialCiphertexts, getStaffCredentialCiphertexts } = require('../business-data/repository');

const CredentialsSchema = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(8).max(200),
});

function createStaffCredentialsRouter({ pool, encryptionKey, logger = console }) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/status', async (_request, response) => {
    try {
      const stored = await getStaffCredentialCiphertexts(pool);
      response.json({ configured: Boolean(stored) });
    } catch (error) {
      logger.error('GET staff-credentials status failed', error);
      response.status(500).json({ error: 'status unavailable' });
    }
  });

  router.post('/', async (request, response) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'invalid credentials' });
    try {
      await setStaffCredentialCiphertexts(pool, {
        usernameCiphertext: encryptSecret(parsed.data.username, encryptionKey),
        passwordCiphertext: encryptSecret(parsed.data.password, encryptionKey),
      });
      response.status(200).json({ configured: true });
    } catch (error) {
      logger.error('POST staff-credentials failed', error);
      response.status(500).json({ error: 'could not save credentials' });
    }
  });

  return router;
}

module.exports = { createStaffCredentialsRouter };
