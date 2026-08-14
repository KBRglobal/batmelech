'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_MODEL, createVoiceTranscriber } = require('../server/telegram/transcribe-voice');

const silentLogger = { error() {} };

// Mirrors the OpenAI client surface transcribe() touches, and records the
// request so the file wrapping and language pin can be asserted.
function fakeOpenAI({ onCreate } = {}) {
  const built = [];
  const requests = [];
  return {
    built,
    requests,
    factory(options) {
      built.push(options);
      return {
        audio: {
          transcriptions: {
            async create(request) {
              requests.push(request);
              if (onCreate) return onCreate(request);
              return { text: '  יש שבע הזמנות היום  ' };
            },
          },
        },
      };
    },
  };
}

test('transcription is disabled without an API key', async () => {
  for (const env of [{}, { OPENAI_API_KEY: '   ' }]) {
    const transcriber = createVoiceTranscriber({ env, logger: silentLogger });
    assert.equal(transcriber.enabled, false);
    assert.equal(await transcriber.transcribe(Buffer.from('a')), null);
  }
});

test('a voice note is sent to Whisper as an ogg file pinned to Hebrew', async () => {
  const client = fakeOpenAI();
  const transcriber = createVoiceTranscriber({
    env: { OPENAI_API_KEY: 'sk-test' },
    clientFactory: client.factory,
    logger: silentLogger,
  });

  assert.equal(transcriber.enabled, true);
  assert.equal(await transcriber.transcribe(Buffer.from('ogg-bytes')), 'יש שבע הזמנות היום');

  assert.equal(client.built[0].apiKey, 'sk-test');
  const [request] = client.requests;
  assert.equal(request.model, DEFAULT_MODEL);
  assert.equal(request.language, 'he');
  assert.equal(request.file.name, 'voice.ogg');
  assert.equal(request.file.type, 'audio/ogg');
});

test('the transcription model can be overridden by env', async () => {
  const client = fakeOpenAI();
  const transcriber = createVoiceTranscriber({
    env: { OPENAI_API_KEY: 'sk-test', OPENAI_TRANSCRIBE_MODEL: '  gpt-4o-transcribe  ' },
    clientFactory: client.factory,
    logger: silentLogger,
  });

  await transcriber.transcribe(Buffer.from('a'));
  assert.equal(client.requests[0].model, 'gpt-4o-transcribe');
});

test('an empty buffer, an empty transcript, or a thrown call all return null', async () => {
  const empty = createVoiceTranscriber({
    env: { OPENAI_API_KEY: 'sk-test' },
    clientFactory: fakeOpenAI({ onCreate: () => ({ text: '   ' }) }).factory,
    logger: silentLogger,
  });
  assert.equal(await empty.transcribe(Buffer.alloc(0)), null);
  assert.equal(await empty.transcribe('not a buffer'), null);
  assert.equal(await empty.transcribe(Buffer.from('a')), null);

  const throwing = createVoiceTranscriber({
    env: { OPENAI_API_KEY: 'sk-test' },
    clientFactory: fakeOpenAI({ onCreate() { throw new Error('openai down'); } }).factory,
    logger: silentLogger,
  });
  assert.equal(await throwing.transcribe(Buffer.from('a')), null);
});

test('the client is built once and reused across transcriptions', async () => {
  const client = fakeOpenAI();
  const transcriber = createVoiceTranscriber({
    env: { OPENAI_API_KEY: 'sk-test' },
    clientFactory: client.factory,
    logger: silentLogger,
  });

  await transcriber.transcribe(Buffer.from('a'));
  await transcriber.transcribe(Buffer.from('b'));
  assert.equal(client.built.length, 1);
  assert.equal(client.requests.length, 2);
});
