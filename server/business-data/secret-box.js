'use strict';

// Small symmetric-encryption helper for secrets that must never round-trip to
// the browser (payment provider API keys). AES-256-GCM, one key from env.

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_PREFIX = 'v1';

function loadKey(base64Key) {
  if (typeof base64Key !== 'string' || base64Key.length === 0) {
    throw new TypeError('encryption key is required');
  }
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new TypeError(`encryption key must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

function encryptSecret(plaintext, base64Key) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('plaintext is required');
  }
  const key = loadKey(base64Key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptSecret(payload, base64Key) {
  if (typeof payload !== 'string') throw new TypeError('payload is required');
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('unrecognized secret payload format');
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const key = loadKey(base64Key);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, KEY_BYTES };
