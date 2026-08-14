'use strict';

// Felix drives; typing is the thing he cannot do. A voice note becomes Hebrew
// text here and is then handed to מיי exactly as if he had typed it.
//
// Same client/env conventions as mey-agent.js: lazily built, injectable for
// tests, and never throwing — a failed transcription returns null so the
// webhook can ask him to write instead.

const OpenAI = require('openai');
const { toFile } = require('openai');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 1, timeout: 60_000 });
const DEFAULT_MODEL = 'whisper-1';

function createVoiceTranscriber({
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
  logger = console,
} = {}) {
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  if (apiKey === '') {
    return {
      enabled: false,
      async transcribe() {
        logger.error('voice transcription disabled: missing OPENAI_API_KEY');
        return null;
      },
    };
  }

  let client = null;
  function resolveClient() {
    if (client === null) client = clientFactory(Object.freeze({ apiKey, ...OPENAI_CLIENT_OPTIONS }));
    return client;
  }

  return {
    enabled: true,
    async transcribe(buffer) {
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        logger.error('transcribe: empty buffer');
        return null;
      }
      try {
        const model = typeof env.OPENAI_TRANSCRIBE_MODEL === 'string' && env.OPENAI_TRANSCRIBE_MODEL.trim() !== ''
          ? env.OPENAI_TRANSCRIBE_MODEL.trim()
          : DEFAULT_MODEL;
        const response = await resolveClient().audio.transcriptions.create({
          file: await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' }),
          model,
          language: 'he',
        });
        const text = response && typeof response.text === 'string' ? response.text.trim() : '';
        return text === '' ? null : text;
      } catch (error) {
        logger.error('transcribe failed', error);
        return null;
      }
    },
  };
}

module.exports = { DEFAULT_MODEL, createVoiceTranscriber };
