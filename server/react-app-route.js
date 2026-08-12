'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function createReactAppRouter(options = {}) {
  const reactRoot = options.reactRoot;
  if (typeof reactRoot !== 'string' || reactRoot.length === 0 || !path.isAbsolute(reactRoot)) {
    throw new TypeError('reactRoot must be an absolute path.');
  }

  const indexPath = path.join(reactRoot, 'index.html');
  const router = express.Router();

  router.use((req, res, next) => {
    if (!fs.existsSync(indexPath)) {
      return res.status(503).type('text').send('React application is unavailable.');
    }
    next();
  });

  router.use(express.static(reactRoot, { fallthrough: true }));
  router.get('*', (req, res, next) => {
    if (path.extname(req.path) !== '') return next();
    res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  });

  return router;
}

module.exports = { createReactAppRouter };
