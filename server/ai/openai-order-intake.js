'use strict';

const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { ZodError } = require('zod');
const {
  OrderCatalogSchema,
  OrderIntakeReviewSchema,
} = require('./order-intake-schema');
const {
  ORDER_INTAKE_SYSTEM_PROMPT,
  buildOrderIntakeUserPrompt,
} = require('./order-intake-prompt');

const SERVICE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'invalid_request',
  NOT_CONFIGURED: 'ai_not_configured',
  REFUSED: 'ai_refused',
  INVALID_PROVIDER_OUTPUT: 'invalid_ai_response',
  PROVIDER_FAILURE: 'ai_provider_error',
});

const OPENAI_CLIENT_OPTIONS = Object.freeze({
  maxRetries: 0,
  timeout: 30_000,
});

const OPENAI_REQUEST_LIMITS = Object.freeze({
  max_output_tokens: 6_000,
  reasoning: Object.freeze({ effort: 'medium' }),
});

const NUMBER_WORD_VALUES = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  אחד: 1,
  אחת: 1,
  שני: 2,
  שתי: 2,
  שניים: 2,
  שתיים: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
  עשרים: 20,
});

const CURRENCY_WORDS = new Set([
  'aed',
  'dollar',
  'dollars',
  'usd',
  'דולר',
  'דולרים',
  'דירהם',
  'שקל',
  'שקלים',
]);

class OrderIntakeServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'OrderIntakeServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function serviceError(code) {
  switch (code) {
    case SERVICE_ERROR_CODES.INVALID_INPUT:
      return new OrderIntakeServiceError(code, 400, 'Invalid order intake request.');
    case SERVICE_ERROR_CODES.NOT_CONFIGURED:
      return new OrderIntakeServiceError(code, 503, 'Order review is temporarily unavailable.');
    case SERVICE_ERROR_CODES.REFUSED:
      return new OrderIntakeServiceError(code, 422, 'The order message could not be reviewed.');
    case SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT:
      return new OrderIntakeServiceError(code, 502, 'The order review response was invalid.');
    default:
      return new OrderIntakeServiceError(
        SERVICE_ERROR_CODES.PROVIDER_FAILURE,
        502,
        'The order review service failed.'
      );
  }
}

function hasRefusal(response) {
  if (!response || !Array.isArray(response.output)) return false;
  return response.output.some(
    (item) =>
      item &&
      item.type === 'message' &&
      Array.isArray(item.content) &&
      item.content.some((content) => content && content.type === 'refusal')
  );
}

function hasUniqueIds(items, getId) {
  const ids = items.map(getId);
  return new Set(ids).size === ids.length;
}

function normalizeEvidenceText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function sourceTextIsGrounded(message, sourceText) {
  return normalizeEvidenceText(message).includes(normalizeEvidenceText(sourceText));
}

function digitValue(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30;
  if (codePoint >= 0x660 && codePoint <= 0x669) return codePoint - 0x660;
  if (codePoint >= 0x6f0 && codePoint <= 0x6f9) return codePoint - 0x6f0;
  if (codePoint >= 0xff10 && codePoint <= 0xff19) return codePoint - 0xff10;
  return null;
}

function parseUnicodeInteger(token) {
  let value = 0;
  for (const character of token) {
    const digit = digitValue(character);
    if (digit === null) return null;
    value = value * 10 + digit;
  }
  return value;
}

function isCurrencyMarker(value) {
  return /[$€£₪]/u.test(value);
}

function explicitQuantities(sourceText) {
  const normalized = normalizeEvidenceText(sourceText).toLowerCase();
  const quantities = new Set();
  const numericTokens = [...normalized.matchAll(/\p{Decimal_Number}+/gu)];

  for (const token of numericTokens) {
    const before = normalized.slice(Math.max(0, token.index - 1), token.index);
    const after = normalized.slice(token.index + token[0].length).trimStart();
    if (isCurrencyMarker(before) || isCurrencyMarker(after.slice(0, 1))) continue;
    const followingWord = after.match(/^[\p{L}]+/u)?.[0];
    if (followingWord && CURRENCY_WORDS.has(followingWord)) continue;
    const value = parseUnicodeInteger(token[0]);
    if (value !== null) quantities.add(value);
  }

  const words = normalized.match(/[\p{L}]+/gu) || [];
  for (const [index, word] of words.entries()) {
    const candidates = [word];
    if (word.startsWith('ו') && word.length > 1) candidates.push(word.slice(1));
    const value = candidates
      .map((candidate) => NUMBER_WORD_VALUES[candidate])
      .find((candidate) => typeof candidate === 'number');
    if (typeof value !== 'number') continue;
    const nextWord = words[index + 1];
    if (nextWord && CURRENCY_WORDS.has(nextWord)) continue;
    quantities.add(value);
  }

  return quantities;
}

function quantityIsGrounded(sourceText, quantity) {
  return quantity === null || explicitQuantities(sourceText).has(quantity);
}

function draftTextIsGrounded(draft, message) {
  const values = [
    draft.customerName,
    draft.customerPhone,
    draft.serviceDate,
    draft.serviceTime,
    draft.deliveryLocation,
    ...draft.notes,
  ].filter((value) => value !== null);

  return values.every((value) => sourceTextIsGrounded(message, value));
}

function evidenceIsGrounded(review, message) {
  const evidence = [
    ...review.draft.items.map((item) => item.sourceText),
    ...review.corrections.flatMap((correction) => [
      correction.originalText,
      correction.correctedText,
    ]),
    ...review.ambiguities.map((ambiguity) => ambiguity.sourceText),
    ...review.paidExtras.map((paidExtra) => paidExtra.sourceText),
    ...review.unknownItems.map((unknownItem) => unknownItem.sourceText),
    ...review.missingFields
      .map((missingField) => missingField.sourceText)
      .filter((sourceText) => sourceText !== null),
  ];

  if (!evidence.every((sourceText) => sourceTextIsGrounded(message, sourceText))) {
    return false;
  }

  return (
    draftTextIsGrounded(review.draft, message) &&
    review.draft.items.every((item) => quantityIsGrounded(item.sourceText, item.quantity)) &&
    review.paidExtras.every((item) => quantityIsGrounded(item.sourceText, item.quantity)) &&
    review.unknownItems.every((item) =>
      quantityIsGrounded(item.sourceText, item.requestedQuantity)
    )
  );
}

function isStructuredOutputParseError(error) {
  return error instanceof SyntaxError || error instanceof ZodError || error?.name === 'ZodError';
}

function matchesCatalog(review, catalog) {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const draftIds = new Set(review.draft.items.map((item) => item.catalogItemId));
  const paidExtraById = new Map(
    review.paidExtras.map((item) => [item.catalogItemId, item])
  );

  if (!hasUniqueIds(review.draft.items, (item) => item.catalogItemId)) return false;
  if (!hasUniqueIds(review.paidExtras, (item) => item.catalogItemId)) return false;

  for (const item of review.draft.items) {
    const catalogItem = catalogById.get(item.catalogItemId);
    if (!catalogItem) return false;
    if (item.catalogItemName !== catalogItem.name || item.category !== catalogItem.category) {
      return false;
    }
    if (catalogItem.isPaidExtra) {
      const paidExtra = paidExtraById.get(item.catalogItemId);
      if (!paidExtra || paidExtra.quantity !== item.quantity) return false;
    }
  }

  for (const ambiguity of review.ambiguities) {
    if (!ambiguity.candidateCatalogItemIds.every((id) => catalogById.has(id))) return false;
  }

  for (const paidExtra of review.paidExtras) {
    const catalogItem = catalogById.get(paidExtra.catalogItemId);
    if (!catalogItem || !catalogItem.isPaidExtra || !draftIds.has(paidExtra.catalogItemId)) {
      return false;
    }
    if (paidExtra.catalogItemName !== catalogItem.name) return false;
    if (paidExtra.catalogPrice !== catalogItem.price) return false;
    if (paidExtra.currency !== catalogItem.currency) return false;
  }

  return true;
}

function createOpenAIOrderIntake({
  client,
  model,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  function resolveModel() {
    const selectedModel = typeof model === 'string' ? model : env.OPENAI_MODEL;
    if (typeof selectedModel !== 'string' || !selectedModel.trim()) {
      throw serviceError(SERVICE_ERROR_CODES.NOT_CONFIGURED);
    }
    return selectedModel.trim();
  }

  function resolveClient() {
    if (!openAIClient) {
      const apiKey = env.OPENAI_API_KEY;
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw serviceError(SERVICE_ERROR_CODES.NOT_CONFIGURED);
      }
      try {
        openAIClient = clientFactory(
          Object.freeze({ apiKey: apiKey.trim(), ...OPENAI_CLIENT_OPTIONS })
        );
      } catch {
        throw serviceError(SERVICE_ERROR_CODES.NOT_CONFIGURED);
      }
    }

    if (!openAIClient.responses || typeof openAIClient.responses.parse !== 'function') {
      throw serviceError(SERVICE_ERROR_CODES.NOT_CONFIGURED);
    }
    return openAIClient;
  }

  return async function reviewOrderIntake({ message, catalog } = {}) {
    if (typeof message !== 'string' || !message.trim()) {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_INPUT);
    }

    const parsedCatalog = OrderCatalogSchema.safeParse(catalog);
    if (!parsedCatalog.success) {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_INPUT);
    }

    const selectedModel = resolveModel();
    const selectedClient = resolveClient();
    let response;

    try {
      response = await selectedClient.responses.parse({
        model: selectedModel,
        store: false,
        ...OPENAI_REQUEST_LIMITS,
        input: [
          { role: 'system', content: ORDER_INTAKE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildOrderIntakeUserPrompt({
              message: message.trim(),
              catalog: parsedCatalog.data,
            }),
          },
        ],
        text: {
          format: zodTextFormat(OrderIntakeReviewSchema, 'order_intake_review'),
        },
      });
    } catch (error) {
      throw serviceError(
        isStructuredOutputParseError(error)
          ? SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
          : SERVICE_ERROR_CODES.PROVIDER_FAILURE
      );
    }

    if (hasRefusal(response)) {
      throw serviceError(SERVICE_ERROR_CODES.REFUSED);
    }

    if (
      !response ||
      !Array.isArray(response.output) ||
      (response.status && response.status !== 'completed')
    ) {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    let outputParsed;
    try {
      outputParsed = response.output_parsed;
    } catch {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    if (outputParsed === null || typeof outputParsed === 'undefined') {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    const parsedReview = OrderIntakeReviewSchema.safeParse(outputParsed);
    if (
      !parsedReview.success ||
      !matchesCatalog(parsedReview.data, parsedCatalog.data) ||
      !evidenceIsGrounded(parsedReview.data, message.trim())
    ) {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    return parsedReview.data;
  };
}

module.exports = {
  OPENAI_CLIENT_OPTIONS,
  OPENAI_REQUEST_LIMITS,
  OrderIntakeServiceError,
  SERVICE_ERROR_CODES,
  createOpenAIOrderIntake,
};
