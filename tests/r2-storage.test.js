'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { REQUIRED_ENV, createR2Storage } = require('../server/telegram/r2-storage');

const silentLogger = { error() {} };

const FULL_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'batmelech',
  R2_PUBLIC_URL: 'https://proof.batmelech.ae',
};

// Captures the S3Client construction options and every command it is sent.
function fakeClient({ onSend } = {}) {
  const built = [];
  const sent = [];
  return {
    built,
    sent,
    factory(options) {
      built.push(options);
      return {
        async send(command) {
          sent.push(command);
          if (onSend) return onSend(command);
          return { ETag: '"abc"' };
        },
      };
    },
  };
}

// The whole point of the random suffix: the key must not be guessable from the
// order id alone, because the bucket is public.
const KEY_PATTERN = /^proof\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9_-]+-\d+-[a-f0-9]{12}\.jpg$/u;

test('r2 storage is disabled when any required env var is missing', async () => {
  for (const missing of REQUIRED_ENV) {
    const env = { ...FULL_ENV };
    delete env[missing];
    const storage = createR2Storage({ env, logger: silentLogger });
    assert.equal(storage.enabled, false, `expected disabled without ${missing}`);
    assert.equal(await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('x') }), null);
  }

  const blank = createR2Storage({ env: { ...FULL_ENV, R2_BUCKET_NAME: '   ' }, logger: silentLogger });
  assert.equal(blank.enabled, false);
});

test('r2 storage uploads the photo and returns an unguessable key and public url', async () => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });
  assert.equal(storage.enabled, true);

  const buffer = Buffer.from('jpeg-bytes');
  const result = await storage.putProofPhoto({ orderId: 'ord-42', dateString: '2026-08-14', buffer });

  assert.match(result.key, KEY_PATTERN);
  assert.ok(result.key.startsWith('proof/2026-08-14/ord-42-'));
  assert.equal(result.url, `https://proof.batmelech.ae/${result.key}`);

  assert.deepEqual(client.built, [{
    region: 'auto',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
  }]);
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].input, {
    Bucket: 'batmelech',
    Key: result.key,
    Body: buffer,
    ContentType: 'image/jpeg',
  });
});

test('r2 storage gives two uploads of the same order different keys', async () => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });

  const first = await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('a') });
  const second = await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('b') });

  assert.notEqual(first.key, second.key);
  assert.equal(client.built.length, 1, 'the client should be built once and reused');
});

test('r2 storage strips anything outside the key alphabet from the order id', async () => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });

  const traversal = await storage.putProofPhoto({
    orderId: '../../etc/pass wd?x=1',
    dateString: '2026-08-14',
    buffer: Buffer.from('a'),
  });
  assert.match(traversal.key, KEY_PATTERN);
  assert.ok(traversal.key.startsWith('proof/2026-08-14/etcpasswdx1-'));

  const empty = await storage.putProofPhoto({ orderId: '///', dateString: '2026-08-14', buffer: Buffer.from('a') });
  assert.match(empty.key, KEY_PATTERN);
  assert.ok(empty.key.startsWith('proof/2026-08-14/order-'));
});

test('r2 storage joins the public url without doubling the slash', async () => {
  const client = fakeClient();
  const storage = createR2Storage({
    env: { ...FULL_ENV, R2_PUBLIC_URL: 'https://proof.batmelech.ae/' },
    clientFactory: client.factory,
    logger: silentLogger,
  });

  const result = await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('a') });
  assert.equal(result.url, `https://proof.batmelech.ae/${result.key}`);
  assert.equal(result.url.includes('//proof/'), false);
});

test('r2 storage honours an explicit content type and defaults to jpeg', async () => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });

  await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('a'), contentType: 'image/png' });
  assert.equal(client.sent[0].input.ContentType, 'image/png');

  await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('a'), contentType: '  ' });
  assert.equal(client.sent[1].input.ContentType, 'image/jpeg');
});

test('r2 storage returns null instead of throwing when the upload fails', async () => {
  const client = fakeClient({ onSend() { throw new Error('r2 unreachable'); } });
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });

  const result = await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.from('a') });
  assert.equal(result, null);
});

test('r2 storage refuses an empty or non-buffer body', async () => {
  const client = fakeClient();
  const storage = createR2Storage({ env: FULL_ENV, clientFactory: client.factory, logger: silentLogger });

  assert.equal(await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: Buffer.alloc(0) }), null);
  assert.equal(await storage.putProofPhoto({ orderId: 'o1', dateString: '2026-08-14', buffer: 'not a buffer' }), null);
  assert.equal(client.sent.length, 0);
});
