'use strict';

// The staff panel gate deliberately does not look like a login. Anyone
// without a valid session sees the same "page not found" page as a real
// broken link — no prompt, no hint that a panel exists at all. The real
// entry is the two-step hidden flow in decoy-login-route.js, served ONLY on
// gated routes (decoy-gate-page.html, posting to /api/site/access). Every
// other 404 site-wide gets decoy-page.html, whose form can only ever send a
// genuine message (generic-contact-route.js) — it has no login capability
// at all, so no random broken link can ever be used to guess your way in.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_COOKIE = 'bm_ref';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const genericDecoyPage = fs.readFileSync(path.join(__dirname, 'decoy-page.html'), 'utf8');
const gateDecoyPage = fs.readFileSync(path.join(__dirname, 'decoy-gate-page.html'), 'utf8');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // malformed cookie value — ignore it, treat as absent
    }
  }
  return out;
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function readToken(token, secret) {
  if (typeof token !== 'string' || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expectedMac = sign(body, secret);
  const macBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expectedMac);
  if (macBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(macBuffer, expectedBuffer)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

function hasValidSession(request, sessionSecret) {
  const cookies = parseCookies(request.headers.cookie);
  const payload = readToken(cookies[SESSION_COOKIE], sessionSecret);
  return Boolean(payload && typeof payload.exp === 'number' && payload.exp > Date.now());
}

function issueSessionCookie(response, sessionSecret) {
  const token = makeToken({ exp: Date.now() + SESSION_TTL_MS }, sessionSecret);
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Paths that actually correspond to protected staff surface. A request
// outside this list falls through to whatever's next (ultimately the global
// 404 below) instead of showing the login-capable gate page — otherwise
// EVERY unauthenticated request site-wide, including garbage bot probes,
// would get the gate page just because it isn't logged in, defeating the
// point of having a separate, login-incapable page for real 404s.
const PROTECTED_PREFIXES = [
  '/api/ai',
  '/api/hotels/search',
  '/api/settings',
  '/api/state',
  '/legacy',
  '/app',
  '/admin',
  '/orders/admin',
  '/index.html',
];

function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function createDecoyGate(sessionSecret) {
  return (request, response, next) => {
    if (hasValidSession(request, sessionSecret)) return next();
    if (!isProtectedPath(request.path)) return next();
    response.status(404);
    response.set('Cache-Control', 'no-store');
    response.type('html').send(gateDecoyPage);
  };
}

// Last-resort handler for any path nothing else matched — bot probes,
// typos, old links. Same page, same look, but its form can only ever
// deliver a real message (see generic-contact-route.js), never a login.
function createGlobal404Handler() {
  return (_request, response) => {
    response.status(404);
    response.set('Cache-Control', 'no-store');
    response.type('html').send(genericDecoyPage);
  };
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  makeToken,
  readToken,
  hasValidSession,
  issueSessionCookie,
  clearSessionCookie,
  createDecoyGate,
  createGlobal404Handler,
};
