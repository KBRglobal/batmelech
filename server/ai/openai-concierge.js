'use strict';

// OpenAI-backed answerer for the public site concierge chat. Same shape as
// openai-order-reply: lazy client resolution from env, plain-text responses
// call, and a hard numeric grounding line — every digit-run in the answer must
// appear verbatim in the knowledge block or the conversation. One retry with
// an explicit correction, then fail closed.

const OpenAI = require('openai');
const { buildConciergeSystemPrompt } = require('./concierge-prompt');
const { allowedNumberTokens, replyNumbersAreGrounded } = require('./openai-order-reply');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 0, timeout: 30_000 });
const MAX_ANSWER_LENGTH = 2400;
const MAX_OUTPUT_TOKENS = 600;
const RETRY_INSTRUCTION =
  'Your previous draft contained a number that does not appear in the knowledge block or the conversation. Rewrite it using ONLY numbers that appear verbatim there, or answer without numbers.';

class ConciergeServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'ConciergeServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function notConfigured() {
  return new ConciergeServiceError('ai_not_configured', 503, 'The concierge is unavailable.');
}

function providerFailure() {
  return new ConciergeServiceError('ai_provider_error', 502, 'The concierge service failed.');
}

function invalidOutput() {
  return new ConciergeServiceError('invalid_ai_response', 502, 'The concierge answer was invalid.');
}

function isValidMessage(message) {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim() !== ''
  );
}

function createOpenAIConcierge({
  client,
  model,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  function resolveModel() {
    const selected = typeof model === 'string' ? model : env.OPENAI_MODEL;
    if (typeof selected !== 'string' || !selected.trim()) throw notConfigured();
    return selected.trim();
  }

  function resolveClient() {
    if (!openAIClient) {
      const apiKey = env.OPENAI_API_KEY;
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw notConfigured();
      try {
        openAIClient = clientFactory(Object.freeze({ apiKey: apiKey.trim(), ...OPENAI_CLIENT_OPTIONS }));
      } catch {
        throw notConfigured();
      }
    }
    if (!openAIClient.responses || typeof openAIClient.responses.create !== 'function') {
      throw notConfigured();
    }
    return openAIClient;
  }

  return async function answerConcierge({ messages, knowledge } = {}) {
    if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isValidMessage)) {
      throw invalidOutput();
    }
    if (typeof knowledge !== 'string' || !knowledge.trim()) throw invalidOutput();
    const selectedModel = resolveModel();
    const selectedClient = resolveClient();
    const conversation = messages.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
    const systemPrompt = buildConciergeSystemPrompt(knowledge);
    const allowed = allowedNumberTokens({ knowledge, conversation });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const isRetry = attempt === 1;
      let response;
      try {
        response = await selectedClient.responses.create({
          model: selectedModel,
          store: false,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [
            {
              role: 'system',
              content: isRetry ? `${systemPrompt}\n\n${RETRY_INSTRUCTION}` : systemPrompt,
            },
            ...conversation,
          ],
        });
      } catch {
        throw providerFailure();
      }

      const text = typeof response?.output_text === 'string' ? response.output_text.trim() : '';
      if (text === '' || text.length > MAX_ANSWER_LENGTH) {
        if (!isRetry) continue;
        throw invalidOutput();
      }
      if (!replyNumbersAreGrounded(text, allowed)) {
        if (!isRetry) continue;
        throw invalidOutput();
      }
      return text;
    }

    throw invalidOutput();
  };
}

module.exports = {
  MAX_ANSWER_LENGTH,
  ConciergeServiceError,
  createOpenAIConcierge,
};
