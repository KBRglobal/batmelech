'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const MAX_CUSTOMER_FORM_BYTES = 5 * 1024 * 1024;
const CUSTOMER_FORM_FILENAME = 'order-form.html';
const CUSTOMER_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

async function readCustomerOrderForm(contentRoot) {
  if (typeof contentRoot !== 'string' || contentRoot.length === 0 || !path.isAbsolute(contentRoot)) {
    throw new TypeError('getContentRoot must return an absolute path.');
  }

  const rootRealPath = await fs.promises.realpath(contentRoot);
  const formPath = path.join(contentRoot, CUSTOMER_FORM_FILENAME);
  const metadata = await fs.promises.lstat(formPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Customer order form is not a regular file.');
  }
  if (metadata.size > MAX_CUSTOMER_FORM_BYTES) {
    throw new Error('Customer order form is too large.');
  }

  const formRealPath = await fs.promises.realpath(formPath);
  if (!formRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Customer order form is outside the content root.');
  }
  const html = await fs.promises.readFile(formRealPath, 'utf8');
  if (/\/(?:api\/state|bm-sync\.js)\b/iu.test(html)) {
    throw new Error('Customer order form references administrative state.');
  }
  return html;
}

function createCustomerOrderRouter(options = {}) {
  const getContentRoot = options.getContentRoot;
  if (typeof getContentRoot !== 'function') {
    throw new TypeError('getContentRoot must be a function.');
  }

  const router = express.Router();
  router.use((_request, response, next) => {
    response.set(CUSTOMER_RESPONSE_HEADERS);
    next();
  });
  router.get('/', async (_request, response) => {
    try {
      const html = await readCustomerOrderForm(getContentRoot());
      response
        .type('html')
        .send(html);
    } catch {
      response.status(503).type('text').send('Customer order form is unavailable.');
    }
  });

  return router;
}

module.exports = {
  CUSTOMER_FORM_FILENAME,
  MAX_CUSTOMER_FORM_BYTES,
  createCustomerOrderRouter,
  readCustomerOrderForm,
};
