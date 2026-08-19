'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

// Hosts the built public site actually reaches (verified against site/assets):
// Google Fonts for the Assistant/Playfair stylesheets and font files, Supabase
// storage and randomuser.me for imagery, and the Iconify API mirrors the icon
// runtime fetches icon data from. 'unsafe-inline' is required for style-src
// because React and Iconify both set inline styles; script-src stays strict.
const PUBLIC_SITE_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev https://randomuser.me",
    "connect-src 'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
});

function createReactAppRouter(options = {}) {
  const reactRoot = options.reactRoot;
  if (typeof reactRoot !== 'string' || reactRoot.length === 0 || !path.isAbsolute(reactRoot)) {
    throw new TypeError('reactRoot must be an absolute path.');
  }

  // Optional per-request HTML rewriting for the SPA shell (the public site
  // uses it for server-side SEO meta). (html, requestPath) => html.
  const transformIndexHtml = options.transformIndexHtml;
  if (transformIndexHtml !== undefined && typeof transformIndexHtml !== 'function') {
    throw new TypeError('transformIndexHtml must be a function when provided.');
  }

  // Opt-in: only the public /site mount carries a policy. The authenticated
  // admin build has different needs and is deliberately left untouched.
  const securityHeaders = options.securityHeaders;
  if (securityHeaders !== undefined && (typeof securityHeaders !== 'object' || securityHeaders === null)) {
    throw new TypeError('securityHeaders must be an object when provided.');
  }

  const indexPath = path.join(reactRoot, 'index.html');
  const router = express.Router();

  if (securityHeaders) {
    router.use((_req, res, next) => {
      res.set(securityHeaders);
      next();
    });
  }

  router.use((req, res, next) => {
    if (!fs.existsSync(indexPath)) {
      return res.status(503).type('text').send('React application is unavailable.');
    }
    next();
  });

  // Extension-less requests (the SPA shell) are answered before the static
  // layer so the optional HTML transform also covers the mount root, which
  // express.static would otherwise serve as a plain directory index.
  const sendIndex = (req, res, next) => {
    if (!transformIndexHtml) {
      return res.sendFile(indexPath, (error) => {
        if (error) next(error);
      });
    }
    fs.readFile(indexPath, 'utf8', (error, html) => {
      if (error) return next(error);
      try {
        res.type('html').send(transformIndexHtml(html, req.path));
      } catch {
        res.type('html').send(html);
      }
    });
  };
  router.get('*', (req, res, next) => {
    if (path.extname(req.path) !== '') return next();
    sendIndex(req, res, next);
  });
  router.use(express.static(reactRoot, { fallthrough: true, index: false }));
  router.get('*', (req, res, next) => {
    if (path.extname(req.path) !== '') return next();
    sendIndex(req, res, next);
  });

  return router;
}

module.exports = { PUBLIC_SITE_SECURITY_HEADERS, createReactAppRouter };
