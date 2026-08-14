'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_MAX_BYTES, downloadFile, getFilePath } = require('../server/telegram/telegram-files');

const silentLogger = { error() {} };

function stubFetch(responder) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return responder(url, calls.length);
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

function jsonResponse(payload) {
  return { ok: true, status: 200, async json() { return payload; }, async text() { return JSON.stringify(payload); } };
}

function bytesResponse(buffer, { contentLength } = {}) {
  const declared = contentLength === undefined ? String(buffer.byteLength) : contentLength;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? declared : null) },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

test('getFilePath asks Telegram for the file and returns the path', async (t) => {
  const fetchStub = stubFetch(() => jsonResponse({ ok: true, result: { file_path: 'photos/file_7.jpg' } }));
  t.after(() => fetchStub.restore());

  const path = await getFilePath({ botToken: 'token', fileId: 'AgAC 42', logger: silentLogger });

  assert.equal(path, 'photos/file_7.jpg');
  assert.equal(fetchStub.calls.length, 1);
  assert.match(fetchStub.calls[0].url, /^https:\/\/api\.telegram\.org\/bottoken\/getFile\?file_id=/u);
  // The file id lands in a query string, so it must be encoded, not pasted.
  assert.match(fetchStub.calls[0].url, /file_id=AgAC%2042$/u);
});

test('getFilePath returns null on an API error, a non-ok response, or a missing path', async (t) => {
  const responses = [
    { ok: false, status: 400, async json() { return {}; }, async text() { return 'bad'; } },
    jsonResponse({ ok: false, description: 'file is too big' }),
    jsonResponse({ ok: true, result: {} }),
  ];
  const fetchStub = stubFetch((_url, call) => responses[call - 1]);
  t.after(() => fetchStub.restore());

  for (let i = 0; i < responses.length; i += 1) {
    assert.equal(await getFilePath({ botToken: 'token', fileId: 'f', logger: silentLogger }), null);
  }
});

test('getFilePath refuses to call out without a token or a file id', async (t) => {
  const fetchStub = stubFetch(() => jsonResponse({ ok: true, result: { file_path: 'x' } }));
  t.after(() => fetchStub.restore());

  assert.equal(await getFilePath({ botToken: '  ', fileId: 'f', logger: silentLogger }), null);
  assert.equal(await getFilePath({ botToken: 'token', fileId: '', logger: silentLogger }), null);
  assert.equal(fetchStub.calls.length, 0);
});

test('getFilePath never throws when the network fails', async (t) => {
  const fetchStub = stubFetch(() => { throw new Error('network down'); });
  t.after(() => fetchStub.restore());

  assert.equal(await getFilePath({ botToken: 'token', fileId: 'f', logger: silentLogger }), null);
});

test('downloadFile fetches from the file host and returns a Buffer', async (t) => {
  const payload = Buffer.from('jpeg-bytes');
  const fetchStub = stubFetch(() => bytesResponse(payload));
  t.after(() => fetchStub.restore());

  const buffer = await downloadFile({ botToken: 'token', filePath: 'photos/file_7.jpg', logger: silentLogger });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.toString(), 'jpeg-bytes');
  assert.equal(fetchStub.calls[0].url, 'https://api.telegram.org/file/bottoken/photos/file_7.jpg');
});

test('downloadFile rejects a file whose declared content-length exceeds the cap', async (t) => {
  const fetchStub = stubFetch(() => bytesResponse(Buffer.from('small'), { contentLength: String(DEFAULT_MAX_BYTES + 1) }));
  t.after(() => fetchStub.restore());

  const buffer = await downloadFile({ botToken: 'token', filePath: 'photos/big.jpg', logger: silentLogger });
  assert.equal(buffer, null);
});

// Content-Length is a claim, not a fact. A response that under-reports (or omits)
// its size must still be measured once the bytes are in hand.
test('downloadFile rejects an oversized body even when content-length lies or is absent', async (t) => {
  const oversized = Buffer.alloc(64, 1);
  const fetchStub = stubFetch((_url, call) => (
    call === 1
      ? bytesResponse(oversized, { contentLength: '4' })
      : bytesResponse(oversized, { contentLength: null })
  ));
  t.after(() => fetchStub.restore());

  assert.equal(await downloadFile({ botToken: 'token', filePath: 'a.jpg', maxBytes: 32, logger: silentLogger }), null);
  assert.equal(await downloadFile({ botToken: 'token', filePath: 'a.jpg', maxBytes: 32, logger: silentLogger }), null);
});

test('downloadFile returns null on a non-ok response and never throws on a network failure', async (t) => {
  const fetchStub = stubFetch((_url, call) => {
    if (call === 1) return { ok: false, status: 404, headers: { get: () => null } };
    throw new Error('network down');
  });
  t.after(() => fetchStub.restore());

  assert.equal(await downloadFile({ botToken: 'token', filePath: 'a.jpg', logger: silentLogger }), null);
  assert.equal(await downloadFile({ botToken: 'token', filePath: 'a.jpg', logger: silentLogger }), null);
});

test('downloadFile refuses to call out without a token or a file path', async (t) => {
  const fetchStub = stubFetch(() => bytesResponse(Buffer.from('x')));
  t.after(() => fetchStub.restore());

  assert.equal(await downloadFile({ botToken: '', filePath: 'a.jpg', logger: silentLogger }), null);
  assert.equal(await downloadFile({ botToken: 'token', filePath: '   ', logger: silentLogger }), null);
  assert.equal(fetchStub.calls.length, 0);
});
