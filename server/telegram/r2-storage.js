'use strict';

// Uploads Felix's proof-of-delivery photos to Cloudflare R2 over the S3 API.
//
// The bucket is served publicly (the photo URL goes into the order record and
// is opened straight from the admin dashboard), so the object key carries a
// random suffix: without it, `proof/<date>/<orderId>.jpg` would let anyone who
// guesses an order id walk the whole day's deliveries.
//
// Every failure path returns null rather than throwing. A photo that cannot be
// stored must degrade into "tell Felix to send it again", never into a crashed
// webhook handler.

const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const REQUIRED_ENV = [
  'R2_ACCOUNT_ID',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
];

function present(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '';
}

// Order ids are internal and already tame, but they end up in a public URL —
// anything outside this alphabet is dropped rather than escaped.
function safeOrderId(orderId) {
  const raw = orderId === null || orderId === undefined ? '' : String(orderId);
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/gu, '');
  return cleaned === '' ? 'order' : cleaned;
}

function createR2Storage({ env = process.env, clientFactory = (options) => new S3Client(options), logger = console } = {}) {
  const missing = REQUIRED_ENV.filter((name) => !present(env, name));
  if (missing.length > 0) {
    return {
      enabled: false,
      async putProofPhoto() {
        logger.error('r2 storage disabled, missing env:', missing.join(', '));
        return null;
      },
    };
  }

  let client = null;
  function resolveClient() {
    if (client === null) {
      client = clientFactory({
        region: 'auto',
        endpoint: env.R2_ENDPOINT.trim(),
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
          secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
        },
      });
    }
    return client;
  }

  return {
    enabled: true,
    async putProofPhoto({ orderId, dateString, buffer, contentType = 'image/jpeg' } = {}) {
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        logger.error('putProofPhoto: empty buffer');
        return null;
      }
      const day = typeof dateString === 'string' && dateString.trim() !== '' ? dateString.trim() : 'unknown';
      const suffix = crypto.randomBytes(6).toString('hex');
      const key = `proof/${day}/${safeOrderId(orderId)}-${Date.now()}-${suffix}.jpg`;
      try {
        await resolveClient().send(new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME.trim(),
          Key: key,
          Body: buffer,
          ContentType: typeof contentType === 'string' && contentType.trim() !== '' ? contentType.trim() : 'image/jpeg',
        }));
      } catch (error) {
        logger.error('putProofPhoto failed', error);
        return null;
      }
      return { url: `${env.R2_PUBLIC_URL.trim().replace(/\/$/u, '')}/${key}`, key };
    },
    // Nightly off-site state backup. The bucket is PUBLIC, so the payload
    // must arrive ALREADY ENCRYPTED (secret-box with BM_SECRETS_KEY) and the
    // key carries a random suffix. Never accepts plaintext state.
    async putStateBackup({ dateString, encryptedBody } = {}) {
      if (typeof encryptedBody !== 'string' || encryptedBody.length === 0) {
        logger.error('putStateBackup: empty encrypted body');
        return null;
      }
      const day = typeof dateString === 'string' && dateString.trim() !== '' ? dateString.trim() : 'unknown';
      const suffix = crypto.randomBytes(12).toString('hex');
      const key = `backups/${day}-${suffix}.json.enc`;
      try {
        await resolveClient().send(new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME.trim(),
          Key: key,
          Body: encryptedBody,
          ContentType: 'application/octet-stream',
        }));
      } catch (error) {
        logger.error('putStateBackup failed', error);
        return null;
      }
      return { key };
    },
    // Dish photos for the menu editor. Same bucket, its own prefix — public
    // by design, the whole point is showing the picture on the menu.
    async putMenuItemImage({ buffer, contentType = 'image/jpeg' } = {}) {
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        logger.error('putMenuItemImage: empty buffer');
        return null;
      }
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const suffix = crypto.randomBytes(8).toString('hex');
      const key = `menu/${Date.now()}-${suffix}.${extension}`;
      try {
        await resolveClient().send(new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME.trim(),
          Key: key,
          Body: buffer,
          ContentType: typeof contentType === 'string' && contentType.trim() !== '' ? contentType.trim() : 'image/jpeg',
        }));
      } catch (error) {
        logger.error('putMenuItemImage failed', error);
        return null;
      }
      return { url: `${env.R2_PUBLIC_URL.trim().replace(/\/$/u, '')}/${key}`, key };
    },
  };
}

module.exports = { REQUIRED_ENV, createR2Storage };
