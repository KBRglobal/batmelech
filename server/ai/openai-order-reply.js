'use strict';

const OpenAI = require('openai');
const {
  ORDER_REPLY_SYSTEM_PROMPT,
  buildOrderReplyUserPrompt,
} = require('./order-reply-prompt');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 0, timeout: 60_000 });
const MAX_REPLY_LENGTH = 2500;
const RETRY_INSTRUCTION =
  'Your previous draft contained a number that does not appear in the supplied data. Rewrite it using ONLY numbers that appear verbatim in the conversation or order summary.';

class OrderReplyServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'OrderReplyServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function notConfigured() {
  return new OrderReplyServiceError('ai_not_configured', 503, 'Reply drafting is unavailable.');
}

function providerFailure() {
  return new OrderReplyServiceError('ai_provider_error', 502, 'The reply drafting service failed.');
}

function invalidOutput() {
  return new OrderReplyServiceError('invalid_ai_response', 502, 'The drafted reply was invalid.');
}

// Every digit-run the model is allowed to use: anything that appears in the
// supplied data, plus the components of dates/times split on separators
// ("2026-08-22" also allows "22", "08", "8", "2026"). This is the hard line
// against invented prices and amounts.
function allowedNumberTokens(payload) {
  const allowed = new Set();
  const serialized = JSON.stringify(payload);
  for (const match of serialized.matchAll(/\d+(?:\.\d+)?/gu)) {
    const token = match[0];
    allowed.add(token);
    for (const part of token.split('.')) {
      allowed.add(part);
      allowed.add(String(Number(part)));
    }
    allowed.add(String(Number(token)));
  }
  return allowed;
}

function replyNumbersAreGrounded(reply, allowed) {
  for (const match of reply.matchAll(/\d+(?:\.\d+)?/gu)) {
    const token = match[0];
    if (allowed.has(token) || allowed.has(String(Number(token)))) continue;
    const parts = token.split('.');
    if (parts.length === 2 && parts.every((part) => allowed.has(part) || allowed.has(String(Number(part))))) {
      continue;
    }
    return false;
  }
  return true;
}

function createOpenAIOrderReply({
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

  return async function draftOrderReply({ conversation, summary, missing, styleNote } = {}) {
    if (typeof conversation !== 'string' || !conversation.trim()) throw invalidOutput();
    const selectedModel = resolveModel();
    const selectedClient = resolveClient();
    const payload = { conversation: conversation.trim(), summary, missing };
    const allowed = allowedNumberTokens(payload);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const isRetry = attempt === 1;
      let response;
      try {
        response = await selectedClient.responses.create({
          model: selectedModel,
          store: false,
          max_output_tokens: 2000,
          input: [
            {
              role: 'system',
              content: isRetry
                ? `${ORDER_REPLY_SYSTEM_PROMPT}\n\n${RETRY_INSTRUCTION}`
                : ORDER_REPLY_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: buildOrderReplyUserPrompt({
                conversation: payload.conversation,
                summary,
                missing,
                styleNote,
              }),
            },
          ],
        });
      } catch {
        throw providerFailure();
      }

      const text = typeof response?.output_text === 'string' ? response.output_text.trim() : '';
      if (text === '' || text.length > MAX_REPLY_LENGTH) {
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
  MAX_REPLY_LENGTH,
  OrderReplyServiceError,
  allowedNumberTokens,
  createOpenAIOrderReply,
  replyNumbersAreGrounded,
};
