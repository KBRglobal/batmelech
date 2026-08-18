'use strict';

// Signed, unguessable customer tracking links. The signature secret is
// DERIVED from the staff session secret (HMAC-scoped with 'tracking-scope'),
// mirroring server/auth/kitchen-route.js: a tracking signature can never be
// replayed as session material and vice versa.
//
// A link carries no expiry on purpose — it is read-only, order-scoped, and
// customers keep it for the whole delivery day. Rotating BM_SESSION_SECRET
// invalidates every previously issued link.

const crypto = require('node:crypto');

const SIGNATURE_HEX_LENGTH = 16;

function trackingSecret(sessionSecret) {
  if (typeof sessionSecret !== 'string' || sessionSecret === '') {
    throw new TypeError('sessionSecret required');
  }
  return crypto.createHmac('sha256', sessionSecret).update('tracking-scope').digest();
}

function trackingSignature(orderId, sessionSecret) {
  return crypto
    .createHmac('sha256', trackingSecret(sessionSecret))
    .update(String(orderId))
    .digest('hex')
    .slice(0, SIGNATURE_HEX_LENGTH);
}

function trackingPath(orderId, sessionSecret) {
  return `/t/${encodeURIComponent(String(orderId))}/${trackingSignature(orderId, sessionSecret)}`;
}

// Constant-time comparison: pad both sides to a common length so neither the
// comparison nor an early length check leaks how many characters matched.
function verifyTrackingSignature(orderId, signature, sessionSecret) {
  const expected = trackingSignature(orderId, sessionSecret);
  const givenBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  const length = Math.max(givenBuffer.length, expectedBuffer.length, 1);
  const givenPadded = Buffer.concat([givenBuffer], length);
  const expectedPadded = Buffer.concat([expectedBuffer], length);
  return (
    crypto.timingSafeEqual(givenPadded, expectedPadded) &&
    givenBuffer.length === expectedBuffer.length
  );
}

module.exports = {
  SIGNATURE_HEX_LENGTH,
  trackingPath,
  trackingSignature,
  verifyTrackingSignature,
};
