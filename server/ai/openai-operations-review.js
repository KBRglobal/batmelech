'use strict';

const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { ZodError } = require('zod');
const {
  OperationsReviewInputSchema,
  OperationsReviewSchema,
} = require('./operations-review-schema');
const {
  OPERATIONS_REVIEW_SYSTEM_PROMPT,
  buildOperationsReviewUserPrompt,
} = require('./operations-review-prompt');

const OPERATIONS_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'invalid_request',
  NOT_CONFIGURED: 'ai_not_configured',
  REFUSED: 'ai_refused',
  INVALID_PROVIDER_OUTPUT: 'invalid_ai_response',
  PROVIDER_FAILURE: 'ai_provider_error',
});

const OPERATIONS_OPENAI_CLIENT_OPTIONS = Object.freeze({
  maxRetries: 0,
  timeout: 20_000,
});

const OPERATIONS_OPENAI_REQUEST_LIMITS = Object.freeze({
  max_output_tokens: 1_600,
  reasoning: Object.freeze({ effort: 'medium' }),
});

const CONFIGURATION_WARNING_CODES = new Set([
  'UNKNOWN_CATALOG_ITEM',
  'UNKNOWN_LUNCH_ITEM',
  'LUNCH_VARIANT_FALLBACK',
  'UNEXPECTED_LUNCH_FIELD',
  'MISSING_RECIPE',
  'INVALID_RECIPE',
]);

const UNIT_CONFLICT_WARNING_CODES = new Set([
  'DEMAND_IDENTITY_CONFLICT',
  'INGREDIENT_IDENTITY_CONFLICT',
]);

const FORBIDDEN_ACTION_WORDS = /\b(?:should|must|change|set|update|save|apply|add|remove|replace|increase|decrease|buy|prepare|assign|schedule|reroute|charge|edit|fix|correct|adjust|recalculate|rewrite)\b/iu;
const FORBIDDEN_HEBREW_ACTION_WORDS = /(?:^|[^\p{L}])(?:צריך|צריכה|חייב|חייבת|כדאי|מומלץ|שנה|שני|שנו|הוסף|הוסיפי|הוסיפו|הסר|הסירי|הסירו|מחק|מחקי|מחקו|עדכן|עדכני|עדכנו|שמור|שמרי|שמרו|קנה|קני|קנו|הכן|הכיני|הכינו|נתב|נתבי|נתבו|שבץ|שבצי|שבצו|תקן|תקני|תקנו)(?=$|[^\p{L}])/u;
const FORBIDDEN_NUMERIC_OR_MONEY = /[\p{Decimal_Number}$€£₪]|\b(?:aed|usd|dollar|dollars|dirham|dirhams)\b|(?:דולר|דולרים|דירהם|שקל|שקלים)/iu;
const FORBIDDEN_NUMBER_WORDS = /(?:\b(?:quantity|target|amount|portions?|units?)\b.{0,24}\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b.{0,24}\b(?:portions?|units?)\b)|(?:(?:כמות|יעד|מנות|יחידות).{0,24}(?:אחד|אחת|שניים|שתיים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים|מאה|אלף)|(?:אחד|אחת|שניים|שתיים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים|מאה|אלף).{0,24}(?:מנות|יחידות))/iu;

class OperationsReviewServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'OperationsReviewServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function serviceError(code) {
  switch (code) {
    case OPERATIONS_SERVICE_ERROR_CODES.INVALID_INPUT:
      return new OperationsReviewServiceError(code, 400, 'Invalid operations review request.');
    case OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED:
      return new OperationsReviewServiceError(
        code,
        503,
        'Operations review is temporarily unavailable.'
      );
    case OPERATIONS_SERVICE_ERROR_CODES.REFUSED:
      return new OperationsReviewServiceError(code, 422, 'The operations data could not be reviewed.');
    case OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT:
      return new OperationsReviewServiceError(code, 502, 'The operations review response was invalid.');
    default:
      return new OperationsReviewServiceError(
        OPERATIONS_SERVICE_ERROR_CODES.PROVIDER_FAILURE,
        502,
        'The operations review service failed.'
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

function isStructuredOutputParseError(error) {
  return error instanceof SyntaxError || error instanceof ZodError || error?.name === 'ZodError';
}

function outputTextIsAdvisoryOnly(review) {
  const texts = [review.overview, ...review.findings.map(({ explanation }) => explanation)];
  return texts.every(
    (value) =>
      !FORBIDDEN_NUMERIC_OR_MONEY.test(value) &&
      !FORBIDDEN_NUMBER_WORDS.test(value) &&
      !FORBIDDEN_ACTION_WORDS.test(value) &&
      !FORBIDDEN_HEBREW_ACTION_WORDS.test(value)
  );
}

function findingMatchesSources(finding, sourceById) {
  if (new Set(finding.sourceIds).size !== finding.sourceIds.length) return false;
  const sources = finding.sourceIds.map((id) => sourceById.get(id));
  if (sources.some((source) => source === undefined)) return false;

  if (finding.kind === 'unusual_quantity') {
    return sources.every(({ type }) => type === 'demand');
  }
  if (finding.kind === 'configuration_gap') {
    return sources.every(
      ({ type, value }) => type === 'warning' && CONFIGURATION_WARNING_CODES.has(value.code)
    );
  }
  if (finding.kind === 'unit_conflict') {
    return sources.every(
      ({ type, value }) => type === 'warning' && UNIT_CONFLICT_WARNING_CODES.has(value.code)
    );
  }
  if (finding.kind === 'delivery_risk') {
    return sources.every(
      ({ type, value }) => type === 'warning' && value.source === 'delivery'
    );
  }
  return sources.every(({ type }) => type === 'warning');
}

function outputIsGrounded(review, snapshot) {
  const sourceById = new Map([
    ...snapshot.demands.map((value) => [value.id, { type: 'demand', value }]),
    ...snapshot.warnings.map((value) => [value.id, { type: 'warning', value }]),
  ]);
  const findingKeys = review.findings.map(({ kind, sourceIds }) =>
    JSON.stringify([kind, [...sourceIds].sort()])
  );

  return (
    new Set(findingKeys).size === findingKeys.length &&
    review.findings.every((finding) => findingMatchesSources(finding, sourceById)) &&
    outputTextIsAdvisoryOnly(review)
  );
}

function createOpenAIOperationsReview({
  client,
  model,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  function resolveModel() {
    const selectedModel = typeof model === 'string' ? model : env.OPENAI_MODEL;
    if (typeof selectedModel !== 'string' || !selectedModel.trim()) {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED);
    }
    return selectedModel.trim();
  }

  function resolveClient() {
    if (!openAIClient) {
      const apiKey = env.OPENAI_API_KEY;
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED);
      }
      try {
        openAIClient = clientFactory(
          Object.freeze({ apiKey: apiKey.trim(), ...OPERATIONS_OPENAI_CLIENT_OPTIONS })
        );
      } catch {
        throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED);
      }
    }

    if (!openAIClient.responses || typeof openAIClient.responses.parse !== 'function') {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED);
    }
    return openAIClient;
  }

  return async function reviewOperations(snapshot) {
    const parsedSnapshot = OperationsReviewInputSchema.safeParse(snapshot);
    if (!parsedSnapshot.success) {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.INVALID_INPUT);
    }

    const selectedModel = resolveModel();
    const selectedClient = resolveClient();
    let response;

    try {
      response = await selectedClient.responses.parse({
        model: selectedModel,
        store: false,
        ...OPERATIONS_OPENAI_REQUEST_LIMITS,
        input: [
          { role: 'system', content: OPERATIONS_REVIEW_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildOperationsReviewUserPrompt(parsedSnapshot.data),
          },
        ],
        text: {
          format: zodTextFormat(OperationsReviewSchema, 'operations_review'),
        },
      });
    } catch (error) {
      throw serviceError(
        isStructuredOutputParseError(error)
          ? OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
          : OPERATIONS_SERVICE_ERROR_CODES.PROVIDER_FAILURE
      );
    }

    if (hasRefusal(response)) {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.REFUSED);
    }
    if (
      !response ||
      !Array.isArray(response.output) ||
      (response.status && response.status !== 'completed')
    ) {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    let outputParsed;
    try {
      outputParsed = response.output_parsed;
    } catch {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }
    if (outputParsed === null || typeof outputParsed === 'undefined') {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    const parsedReview = OperationsReviewSchema.safeParse(outputParsed);
    if (
      !parsedReview.success ||
      !outputIsGrounded(parsedReview.data, parsedSnapshot.data)
    ) {
      throw serviceError(OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
    }

    return parsedReview.data;
  };
}

module.exports = {
  OPERATIONS_OPENAI_CLIENT_OPTIONS,
  OPERATIONS_OPENAI_REQUEST_LIMITS,
  OPERATIONS_SERVICE_ERROR_CODES,
  OperationsReviewServiceError,
  createOpenAIOperationsReview,
};
