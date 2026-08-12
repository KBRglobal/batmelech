'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function createPublicLandingRouter({ contentRoot } = {}) {
  if (typeof contentRoot !== 'string' || !path.isAbsolute(contentRoot)) {
    throw new TypeError('contentRoot must be an absolute path.');
  }
  const landingPath = path.join(contentRoot, 'landing.html');
  const router = express.Router();
  router.get('/', async (_request, response) => {
    try {
      const html = await fs.promises.readFile(landingPath, 'utf8');
      response
        .set('Cache-Control', 'no-store')
        .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
        .set('X-Content-Type-Options', 'nosniff')
        .type('html')
        .send(html);
    } catch {
      response.status(503).type('text').send('Landing page is unavailable.');
    }
  });
  return router;
}

module.exports = { createPublicLandingRouter };
