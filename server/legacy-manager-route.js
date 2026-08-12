'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const MAX_LEGACY_HTML_BYTES = 20 * 1024 * 1024;

function injectSyncBootstrap(html, syncScriptPath) {
  const tag = `<script src="${syncScriptPath}"></script>`;
  if (html.includes(tag)) return html;

  const head = /<head(?:\s[^>]*)?>/iu;
  return head.test(html) ? html.replace(head, (match) => `${match}${tag}`) : `${tag}${html}`;
}

async function readLegacyIndex(contentRoot) {
  if (typeof contentRoot !== 'string' || contentRoot.length === 0 || !path.isAbsolute(contentRoot)) {
    throw new TypeError('getContentRoot must return an absolute path.');
  }

  const rootRealPath = await fs.promises.realpath(contentRoot);
  const indexPath = path.join(contentRoot, 'index.html');
  const indexMetadata = await fs.promises.lstat(indexPath);
  if (indexMetadata.isSymbolicLink() || !indexMetadata.isFile()) {
    throw new Error('Legacy manager index is not a regular file.');
  }
  if (indexMetadata.size > MAX_LEGACY_HTML_BYTES) {
    throw new Error('Legacy manager index is too large.');
  }

  const indexRealPath = await fs.promises.realpath(indexPath);
  if (!indexRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Legacy manager index is outside the content root.');
  }

  return fs.promises.readFile(indexRealPath, 'utf8');
}

function createLegacyManagerRouter(options = {}) {
  const getContentRoot = options.getContentRoot;
  const syncScriptPath = options.syncScriptPath ?? '/bm-sync.js';
  if (typeof getContentRoot !== 'function') {
    throw new TypeError('getContentRoot must be a function.');
  }
  if (typeof syncScriptPath !== 'string' || !syncScriptPath.startsWith('/')) {
    throw new TypeError('syncScriptPath must be an absolute URL path.');
  }

  const router = express.Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get(['/', '/index.html'], async (_request, response) => {
    try {
      const html = await readLegacyIndex(getContentRoot());
      response
        .type('html')
        .send(injectSyncBootstrap(html, syncScriptPath));
    } catch {
      response.status(503).type('text').send('Legacy manager is unavailable.');
    }
  });

  return router;
}

module.exports = {
  MAX_LEGACY_HTML_BYTES,
  createLegacyManagerRouter,
  injectSyncBootstrap,
  readLegacyIndex,
};
