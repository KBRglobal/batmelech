'use strict';

// Disguised as a public "contact us" form on the 404 decoy page. The first
// message is checked against the username, the second against the password
// — the page never shows a field labeled either way. Anyone who gets either
// step wrong sees the same fake "message sent" confirmation as a genuine
// visitor, and their IP is silently locked out after a few misses so brute
// forcing looks identical to just... nothing happening.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { readToken, makeToken, issueSessionCookie, parseCookies } = require('./decoy-auth');
const { decryptSecret } = require('../business-data/secret-box');
const { getStaffCredentialCiphertexts } = require('../business-data/repository');

const CHALLENGE_COOKIE = 'bm_rq';
const CHALLENGE_TTL_MS = 3 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 3;
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1_000;

const MessageSchema = z.object({ message: z.string().trim().min(1).max(500) });

// IP -> { count, blockedUntil }. Small business scale — in-memory is fine,
// and it resets on deploy, which is acceptable for a lockout, not a ban.
const attemptsByIp = new Map();

function isBlocked(ip) {
  const record = attemptsByIp.get(ip);
  return Boolean(record && record.blockedUntil && record.blockedUntil > Date.now());
}

function recordFailure(ip) {
  const record = attemptsByIp.get(ip) || { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    record.count = 0;
  }
  attemptsByIp.set(ip, record);
}

function ticketRef() {
  return `RQ-${crypto.randomInt(10_000, 99_999)}`;
}

// The env pair (BM_USER/BM_PASS on Railway) stays valid forever as Moshe's
// recovery key, even after Lin sets her own encrypted pair from the panel —
// changing the Railway vars must always be a working escape hatch. A decrypt
// failure on the stored pair just means it's treated as absent, never a lock-out.
async function loadStaffPair(pool, encryptionKey) {
  if (!pool || !encryptionKey) return null;
  try {
    const stored = await getStaffCredentialCiphertexts(pool);
    if (!stored) return null;
    return {
      user: decryptSecret(stored.usernameCiphertext, encryptionKey),
      pass: decryptSecret(stored.passwordCiphertext, encryptionKey),
    };
  } catch {
    return null;
  }
}

function createDecoyLoginRouter({ authUser, authPass, sessionSecret, pool, encryptionKey }) {
  if (!authUser || !authPass || !sessionSecret) {
    throw new TypeError('authUser, authPass, and sessionSecret are required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '2kb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/', async (request, response) => {
    const parsed = MessageSchema.safeParse(request.body);
    if (!parsed.success) return response.status(200).json({ status: 'received' });

    const ip = request.ip;
    if (isBlocked(ip)) {
      return response.status(200).json({ status: 'received' });
    }

    const staffPair = await loadStaffPair(pool, encryptionKey);

    const cookies = parseCookies(request.headers.cookie);
    const challenge = readToken(cookies[CHALLENGE_COOKIE], sessionSecret);
    const awaitingPassword = Boolean(
      challenge && (challenge.source === 'env' || challenge.source === 'staff') && challenge.exp > Date.now()
    );
    const message = parsed.data.message;

    if (!awaitingPassword) {
      let source = null;
      if (message === authUser) source = 'env';
      else if (staffPair && message === staffPair.user) source = 'staff';

      if (source) {
        const token = makeToken({ source, exp: Date.now() + CHALLENGE_TTL_MS }, sessionSecret);
        response.cookie(CHALLENGE_COOKIE, token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: CHALLENGE_TTL_MS,
          path: '/',
        });
        return response.status(200).json({ status: 'received', ref: ticketRef() });
      }
      recordFailure(ip);
      return response.status(200).json({ status: 'received' });
    }

    response.clearCookie(CHALLENGE_COOKIE, { path: '/' });
    const expectedPass = challenge.source === 'env' ? authPass : staffPair?.pass;
    if (expectedPass && message === expectedPass) {
      issueSessionCookie(response, sessionSecret);
      return response.status(200).json({ status: 'received', ref: ticketRef() });
    }
    recordFailure(ip);
    return response.status(200).json({ status: 'received' });
  });

  return router;
}

module.exports = { createDecoyLoginRouter, CHALLENGE_COOKIE };
