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
const { normalizeWhatsAppInput } = require('./whatsapp-chat');

const SERVICE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'invalid_request',
  NOT_CONFIGURED: 'ai_not_configured',
  REFUSED: 'ai_refused',
  INVALID_PROVIDER_OUTPUT: 'invalid_ai_response',
  PROVIDER_FAILURE: 'ai_provider_error',
});

const OPENAI_CLIENT_OPTIONS = Object.freeze({
  maxRetries: 0,
  timeout: 120_000,
});

const OPENAI_REQUEST_LIMITS = Object.freeze({
  max_output_tokens: 12_000,
  reasoning: Object.freeze({ effort: 'low' }),
});

const OPENAI_RETRY_LIMITS = Object.freeze({
  max_output_tokens: 12_000,
  reasoning: Object.freeze({ effort: 'low' }),
});

const RETRY_SYSTEM_INSTRUCTION =
  'The previous response could not be parsed or completed. Return one minimal, schema-valid review. Use null and empty arrays instead of inventing any value.';

const REVIEW_LIMITS = Object.freeze({
  ambiguities: 50,
  missingFields: 50,
  unknownItems: 50,
  warnings: 100,
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

const HEBREW_ITEM_PREFIXES = new Set(['ב', 'ה', 'ו', 'כ', 'ל', 'מ', 'ש']);
const QUANTITY_LINK_WORDS = new Set([
  'actually',
  'instead',
  'make',
  'of',
  'portion',
  'portions',
  'qty',
  'quantity',
  'rather',
  'x',
  'בעצם',
  'במקום',
  'יח',
  'יחידה',
  'יחידות',
  'כלומר',
  'כמות',
  'לא',
  'מנה',
  'מנות',
  'סליחה',
  'של',
  'תעשה',
  'תעשי',
  'ו',
]);

class OrderIntakeServiceError extends Error {
  constructor(code, statusCode, message, internalReason = 'unspecified') {
    super(message);
    this.name = 'OrderIntakeServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.internalReason = internalReason;
  }
}

function serviceError(code, internalReason) {
  switch (code) {
    case SERVICE_ERROR_CODES.INVALID_INPUT:
      return new OrderIntakeServiceError(
        code,
        400,
        'Invalid order intake request.',
        internalReason
      );
    case SERVICE_ERROR_CODES.NOT_CONFIGURED:
      return new OrderIntakeServiceError(
        code,
        503,
        'Order review is temporarily unavailable.',
        internalReason
      );
    case SERVICE_ERROR_CODES.REFUSED:
      return new OrderIntakeServiceError(
        code,
        422,
        'The order message could not be reviewed.',
        internalReason
      );
    case SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT:
      return new OrderIntakeServiceError(
        code,
        502,
        'The order review response was invalid.',
        internalReason
      );
    default:
      return new OrderIntakeServiceError(
        SERVICE_ERROR_CODES.PROVIDER_FAILURE,
        502,
        'The order review service failed.',
        internalReason
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

function normalizeEvidenceText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function sourceTextIsGrounded(message, sourceText) {
  return normalizeEvidenceText(message).includes(normalizeEvidenceText(sourceText));
}

function isLetter(value) {
  return typeof value === 'string' && /^\p{L}$/u.test(value);
}

function catalogIdentityOccurrences(sourceText, catalogItem) {
  const normalizedSourceText = normalizeEvidenceText(sourceText).toLowerCase();
  const occurrences = [];

  for (const identity of [catalogItem.name, ...catalogItem.aliases]) {
    const normalizedIdentity = normalizeEvidenceText(identity).toLowerCase();
    let start = normalizedSourceText.indexOf(normalizedIdentity);
    while (start !== -1) {
      const end = start + normalizedIdentity.length;
      const before = normalizedSourceText[start - 1];
      const beforePrefix = normalizedSourceText[start - 2];
      const after = normalizedSourceText[end];
      const repeatedFinalLetter =
        after === normalizedIdentity[normalizedIdentity.length - 1] &&
        !isLetter(normalizedSourceText[end + 1]);
      const startsAtBoundary =
        !isLetter(before) ||
        (HEBREW_ITEM_PREFIXES.has(before) && !isLetter(beforePrefix));
      if (startsAtBoundary && (!isLetter(after) || repeatedFinalLetter)) {
        occurrences.push({ start, end: repeatedFinalLetter ? end + 1 : end });
      }
      start = normalizedSourceText.indexOf(normalizedIdentity, start + 1);
    }
  }

  return occurrences;
}

// Customers write short colloquial names ("כרוב לבן"), the catalog holds the
// kitchen's formal names ("כרוב לבן קלאסי"). Words that only describe form or
// quantity carry no identity, so they never count for or against a match.
const GENERIC_EVIDENCE_WORDS = new Set([
  'מנה', 'מנות', 'מגש', 'מגשי', 'מגשים', 'תוספת', 'תוספות', 'אקסטרה', 'אקסטרות',
  'סוג', 'סוגי', 'סוגים', 'נוסף', 'נוספת', 'נוספות', 'נוספים', 'נתח', 'נתחים',
  'יח', 'יחידות', 'קטן', 'קטנה', 'גדול', 'גדולה', 'זוגי', 'אישי', 'אישית',
  'שבת', 'עוד', 'גם', 'רק', 'אחד', 'אחת', 'שני', 'שתי', 'שניים', 'שתיים',
  'עם', 'בלי', 'ללא', 'של',
]);

// Common menu abbreviations, expanded before word comparison.
const EVIDENCE_WORD_EXPANSIONS = new Map([
  ['תפוא', ['תפוחי', 'אדמה']],
]);

const HEBREW_STRIPPABLE_PREFIXES = new Set(['ב', 'ל', 'ה', 'ו', 'מ', 'כ', 'ש']);

function evidenceContentWords(text) {
  const normalized = normalizeEvidenceText(text)
    .toLowerCase()
    // expand the ubiquitous menu abbreviation תפו"א before tokenizing —
    // the gershayim otherwise splits it into meaningless tokens
    .replace(/תפו["'\u05f3\u05f4]?א/gu, 'תפוחי אדמה');
  const words = [];
  for (const match of normalized.matchAll(/[\p{L}]+/gu)) {
    const word = match[0];
    if (word.length < 2) continue;
    if (GENERIC_EVIDENCE_WORDS.has(word)) continue;
    // a generic word behind a grammatical prefix ("בנוסף", "ומגש") is still generic
    if (GENERIC_EVIDENCE_WORDS.has(stripOneHebrewPrefix(word))) continue;
    words.push(word);
  }
  return words;
}

function stripOneHebrewPrefix(word) {
  return word.length > 2 && HEBREW_STRIPPABLE_PREFIXES.has(word[0]) ? word.slice(1) : word;
}

// Same word up to a short inflection: singular/plural, gender, construct
// state ("דגים"~"דג", "זוגות"~"זוגית", "צהוב"~"צהובה", "פילטים"~"פילה").
function inflectionCompatible(a, b) {
  if (a === b) return true;
  let commonPrefix = 0;
  while (commonPrefix < a.length && commonPrefix < b.length && a[commonPrefix] === b[commonPrefix]) {
    commonPrefix += 1;
  }
  // one word contains the other with a short suffix ("דג" -> "דגים")
  if ((commonPrefix === a.length || commonPrefix === b.length) &&
      commonPrefix >= 2 && Math.abs(a.length - b.length) <= 3) {
    return true;
  }
  return commonPrefix >= 3 && a.length - commonPrefix <= 3 && b.length - commonPrefix <= 3;
}

// Full/defective Hebrew spelling fallback ("פילפלים"~"פלפל").
function stripHebrewVowelLetters(word) {
  const stripped = word.replace(/[יו]/gu, '');
  return stripped.length >= 2 ? stripped : word;
}

function coreWordsCompatible(a, b) {
  if (inflectionCompatible(a, b)) return true;
  return inflectionCompatible(stripHebrewVowelLetters(a), stripHebrewVowelLetters(b));
}

// Grammatical prefixes (ב/ל/ה/ו/מ/כ/ש) may sit on either side ("ברוטב"~"רוטב"),
// so compatibility is tried with and without one stripped prefix on each side.
function evidenceWordsCompatible(a, b) {
  for (const left of new Set([a, stripOneHebrewPrefix(a)])) {
    for (const right of new Set([b, stripOneHebrewPrefix(b)])) {
      if (coreWordsCompatible(left, right)) return true;
    }
  }
  return false;
}

function sourceTextMatchesCatalogItem(sourceText, catalogItem) {
  if (catalogIdentityOccurrences(sourceText, catalogItem).length > 0) return true;

  // Subset rule: every identifying word the customer wrote must exist in the
  // catalog item's name or aliases. The customer may say less than the formal
  // name, never something the name does not contain.
  const quoteWords = evidenceContentWords(sourceText);
  if (quoteWords.length === 0) return false;
  const identityWords = [catalogItem.name, ...catalogItem.aliases].flatMap((identity) =>
    evidenceContentWords(identity)
  );
  if (identityWords.length === 0) return false;
  let strongMatch = false;
  for (const quoteWord of quoteWords) {
    const matched = identityWords.some((identityWord) => evidenceWordsCompatible(quoteWord, identityWord));
    if (!matched) return false;
    if (quoteWord.length >= 3) strongMatch = true;
  }
  return strongMatch;
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

function explicitQuantityMentions(sourceText) {
  const normalized = normalizeEvidenceText(sourceText).toLowerCase();
  const mentions = [];
  const numericTokens = [...normalized.matchAll(/\p{Decimal_Number}+/gu)];

  for (const token of numericTokens) {
    const before = normalized.slice(Math.max(0, token.index - 1), token.index);
    const after = normalized.slice(token.index + token[0].length).trimStart();
    if (isCurrencyMarker(before) || isCurrencyMarker(after.slice(0, 1))) continue;
    const followingWord = after.match(/^[\p{L}]+/u)?.[0];
    if (followingWord && CURRENCY_WORDS.has(followingWord)) continue;
    const value = parseUnicodeInteger(token[0]);
    if (value !== null) {
      mentions.push({ value, start: token.index, end: token.index + token[0].length });
    }
  }

  const words = [...normalized.matchAll(/[\p{L}]+/gu)];
  for (const [index, token] of words.entries()) {
    const word = token[0];
    const candidates = [word];
    if (word.startsWith('ו') && word.length > 1) candidates.push(word.slice(1));
    const value = candidates
      .map((candidate) => NUMBER_WORD_VALUES[candidate])
      .find((candidate) => typeof candidate === 'number');
    if (typeof value !== 'number') continue;
    const nextWord = words[index + 1]?.[0];
    if (nextWord && CURRENCY_WORDS.has(nextWord)) continue;
    mentions.push({ value, start: token.index, end: token.index + word.length });
  }

  return mentions;
}

function explicitQuantities(sourceText) {
  return new Set(explicitQuantityMentions(sourceText).map((mention) => mention.value));
}

function quantityIsGrounded(sourceText, quantity) {
  return quantity === null || explicitQuantities(sourceText).has(quantity);
}

function gapContainsOnlyQuantityLinks(value) {
  const words = value.toLowerCase().match(/\p{L}+/gu) || [];
  return words.every((word) => QUANTITY_LINK_WORDS.has(word));
}

function catalogItemQuantityIsGrounded(sourceText, quantity, catalogItem) {
  if (quantity === null) return true;
  const normalizedSourceText = normalizeEvidenceText(sourceText).toLowerCase();
  const identities = catalogIdentityOccurrences(sourceText, catalogItem);
  const quantities = explicitQuantityMentions(sourceText).filter(
    (mention) => mention.value === quantity
  );

  return identities.some((identity) =>
    quantities.some((mention) => {
      if (mention.end <= identity.start) {
        return gapContainsOnlyQuantityLinks(
          normalizedSourceText.slice(mention.end, identity.start)
        );
      }
      if (mention.start >= identity.end) {
        return gapContainsOnlyQuantityLinks(
          normalizedSourceText.slice(identity.end, mention.start)
        );
      }
      return false;
    })
  );
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

// Deterministic group-order detection ("we are 4 families at the same
// hotel"). Kept outside the structured AI call on purpose: the review
// schema stays untouched and the hint can never be hallucinated.
const GROUP_SIGNAL_PATTERN = new RegExp(
  [
    'משפחות',
    'כמה משפחות',
    'שתי משפחות',
    'הזמנות נפרדות',
    'חשבונות נפרדים',
    'כל משפחה',
    'קבוצה של',
    'families',
    'separate orders',
    'separate bills',
    'each family',
    'group of',
  ].join('|'),
  'iu'
);

function detectGroupSignal(message) {
  return GROUP_SIGNAL_PATTERN.test(message);
}

function withGroupWarning(review, message) {
  if (!detectGroupSignal(message)) return review;
  if (review.warnings.length >= REVIEW_LIMITS.warnings) return review;
  return {
    ...review,
    warnings: [
      ...review.warnings,
      {
        code: 'other',
        severity: 'warning',
        message:
          'נראה שמדובר בקבוצה של כמה משפחות. אפשר לשמור את ההזמנה הזאת עם שם קבוצה, ואז לשכפל אותה לכל משפחה תחת אותה קבוצה.',
      },
    ],
  };
}

function isStructuredOutputParseError(error) {
  return error instanceof SyntaxError || error instanceof ZodError || error?.name === 'ZodError';
}

function pushUniqueCapped(items, value, limit, identity) {
  if (items.length >= limit) return false;
  const key = identity(value);
  if (items.some((item) => identity(item) === key)) return false;
  items.push(value);
  return true;
}

function sanitizeReview(review, catalog, message) {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const generatedWarnings = [];
  let changed = false;

  const warn = (code, messageText) => {
    pushUniqueCapped(
      generatedWarnings,
      { code, severity: 'warning', message: messageText },
      REVIEW_LIMITS.warnings,
      (warning) => `${warning.code}\u0000${warning.message}`
    );
  };

  const sanitized = {
    reviewOnly: true,
    draft: {
      customerName: review.draft.customerName,
      customerPhone: review.draft.customerPhone,
      serviceDate: review.draft.serviceDate,
      serviceTime: review.draft.serviceTime,
      fulfillmentMethod: 'unknown',
      deliveryLocation: review.draft.deliveryLocation,
      items: [],
      notes: [],
    },
    corrections: [],
    ambiguities: [],
    paidExtras: [],
    unknownItems: [],
    missingFields: [],
    warnings: [],
    overallConfidence: review.overallConfidence,
  };

  for (const field of [
    'customerName',
    'customerPhone',
    'serviceDate',
    'serviceTime',
    'deliveryLocation',
  ]) {
    const value = sanitized.draft[field];
    if (value !== null && !sourceTextIsGrounded(message, value)) {
      sanitized.draft[field] = null;
      changed = true;
      warn('missing_field', 'An unverified draft detail was removed for human review.');
    }
  }

  sanitized.draft.notes = review.draft.notes.filter((note) => {
    const grounded = sourceTextIsGrounded(message, note);
    if (!grounded) changed = true;
    return grounded;
  });

  if (review.draft.fulfillmentMethod !== 'unknown') {
    changed = true;
    pushUniqueCapped(
      sanitized.missingFields,
      {
        field: 'fulfillment_method',
        sourceText: null,
        reason: 'Delivery or pickup must be confirmed by the operator.',
      },
      REVIEW_LIMITS.missingFields,
      (finding) => `${finding.field}\u0000${finding.sourceText || ''}`
    );
    warn('missing_field', 'Confirm delivery or pickup before applying this draft.');
  }

  for (const correction of review.corrections) {
    if (
      sourceTextIsGrounded(message, correction.originalText) &&
      sourceTextIsGrounded(message, correction.correctedText)
    ) {
      sanitized.corrections.push({
        ...correction,
        reason: 'The quoted customer wording changed and requires operator confirmation.',
      });
      if (
        correction.reason !==
        'The quoted customer wording changed and requires operator confirmation.'
      ) {
        changed = true;
      }
    } else {
      changed = true;
    }
  }

  for (const ambiguity of review.ambiguities) {
    if (!sourceTextIsGrounded(message, ambiguity.sourceText)) {
      changed = true;
      continue;
    }
    const candidateCatalogItemIds = [
      ...new Set(
        ambiguity.candidateCatalogItemIds.filter((catalogItemId) =>
          catalogById.has(catalogItemId)
        )
      ),
    ];
    if (candidateCatalogItemIds.length !== ambiguity.candidateCatalogItemIds.length) {
      changed = true;
    }
    pushUniqueCapped(
      sanitized.ambiguities,
      {
        ...ambiguity,
        question: 'Confirm the customer\'s intended choice.',
        candidateCatalogItemIds,
      },
      REVIEW_LIMITS.ambiguities,
      (finding) => `${finding.sourceText}\u0000${finding.candidateCatalogItemIds.join(',')}`
    );
    if (ambiguity.question !== 'Confirm the customer\'s intended choice.') changed = true;
    warn('ambiguous_intent', 'A customer choice requires human confirmation.');
  }

  for (const missingField of review.missingFields) {
    if (
      missingField.sourceText === null ||
      sourceTextIsGrounded(message, missingField.sourceText)
    ) {
      pushUniqueCapped(
        sanitized.missingFields,
        {
          ...missingField,
          reason: 'This detail must be confirmed by the operator.',
        },
        REVIEW_LIMITS.missingFields,
        (finding) => `${finding.field}\u0000${finding.sourceText || ''}`
      );
      if (missingField.reason !== 'This detail must be confirmed by the operator.') changed = true;
      warn('missing_field', 'A missing order detail requires human confirmation.');
    } else {
      changed = true;
      pushUniqueCapped(
        sanitized.missingFields,
        {
          field: missingField.field,
          sourceText: null,
          reason: 'This detail must be confirmed by the operator.',
        },
        REVIEW_LIMITS.missingFields,
        (finding) => `${finding.field}\u0000${finding.sourceText || ''}`
      );
    }
  }

  for (const unknownItem of review.unknownItems) {
    if (!sourceTextIsGrounded(message, unknownItem.sourceText)) {
      changed = true;
      continue;
    }
    const requestedQuantity = quantityIsGrounded(
      unknownItem.sourceText,
      unknownItem.requestedQuantity
    )
      ? unknownItem.requestedQuantity
      : null;
    if (requestedQuantity !== unknownItem.requestedQuantity) {
      changed = true;
      warn('quantity_missing', 'Confirm an unmatched item quantity before applying this draft.');
    }
    pushUniqueCapped(
      sanitized.unknownItems,
      {
        ...unknownItem,
        requestedQuantity,
        reason: 'No authoritative catalog item has been confirmed for this request.',
      },
      REVIEW_LIMITS.unknownItems,
      (item) => item.sourceText
    );
    if (
      unknownItem.reason !==
      'No authoritative catalog item has been confirmed for this request.'
    ) {
      changed = true;
    }
    warn('catalog_mismatch', 'An unmatched customer request requires human review.');
  }

  const itemById = new Map();
  for (const item of review.draft.items) {
    if (!sourceTextIsGrounded(message, item.sourceText)) {
      changed = true;
      warn('catalog_mismatch', 'An item without exact customer evidence was removed.');
      continue;
    }

    const catalogItem = catalogById.get(item.catalogItemId);
    const quantity = catalogItem && catalogItemQuantityIsGrounded(
      item.sourceText,
      item.quantity,
      catalogItem
    )
      ? item.quantity
      : null;

    if (!catalogItem) {
      changed = true;
      pushUniqueCapped(
        sanitized.unknownItems,
        {
          sourceText: item.sourceText,
          requestedQuantity: quantity,
          reason: 'The proposed catalog ID is not present in the authoritative catalog.',
        },
        REVIEW_LIMITS.unknownItems,
        (unknownItem) => unknownItem.sourceText
      );
      warn('catalog_mismatch', 'An unknown catalog match requires human review.');
      continue;
    }

    if (!sourceTextMatchesCatalogItem(item.sourceText, catalogItem)) {
      changed = true;
      pushUniqueCapped(
        sanitized.unknownItems,
        {
          sourceText: item.sourceText,
          requestedQuantity: null,
          reason: 'The quoted customer wording does not identify the proposed catalog item.',
        },
        REVIEW_LIMITS.unknownItems,
        (unknownItem) => unknownItem.sourceText
      );
      warn('catalog_mismatch', 'An unverified catalog match requires human review.');
      continue;
    }

    if (
      item.catalogItemName !== catalogItem.name ||
      item.category !== catalogItem.category ||
      quantity !== item.quantity
    ) {
      changed = true;
    }

    const existingItem = itemById.get(catalogItem.id);
    if (existingItem) {
      changed = true;
      existingItem.quantity = null;
      existingItem.confidence = Math.min(existingItem.confidence, item.confidence);
      pushUniqueCapped(
        sanitized.ambiguities,
        {
          sourceText: item.sourceText,
          question: `Confirm the total quantity for ${catalogItem.name}.`,
          candidateCatalogItemIds: [catalogItem.id],
        },
        REVIEW_LIMITS.ambiguities,
        (ambiguity) => `${ambiguity.sourceText}\u0000${ambiguity.candidateCatalogItemIds.join(',')}`
      );
      pushUniqueCapped(
        sanitized.missingFields,
        {
          field: 'item_quantity',
          sourceText: item.sourceText,
          reason: 'Duplicate matches cannot be combined without operator confirmation.',
        },
        REVIEW_LIMITS.missingFields,
        (finding) => `${finding.field}\u0000${finding.sourceText || ''}`
      );
      warn('ambiguous_intent', 'Duplicate item matches require quantity confirmation.');
      continue;
    }

    const sanitizedItem = {
      catalogItemId: catalogItem.id,
      catalogItemName: catalogItem.name,
      category: catalogItem.category,
      quantity,
      sourceText: item.sourceText,
      confidence: item.confidence,
    };
    sanitized.draft.items.push(sanitizedItem);
    itemById.set(catalogItem.id, sanitizedItem);

    if (quantity !== item.quantity) {
      pushUniqueCapped(
        sanitized.missingFields,
        {
          field: 'item_quantity',
          sourceText: item.sourceText,
          reason: 'The quantity was not explicitly stated in the customer message.',
        },
        REVIEW_LIMITS.missingFields,
        (finding) => `${finding.field}\u0000${finding.sourceText || ''}`
      );
      warn('quantity_missing', 'Confirm an ungrounded item quantity before applying this draft.');
    }
  }

  const paidExtraWarnings = [];
  for (const item of sanitized.draft.items) {
    const catalogItem = catalogById.get(item.catalogItemId);
    if (!catalogItem.isPaidExtra) continue;
    const providerPaidExtra = review.paidExtras.find(
      (paidExtra) =>
        paidExtra.catalogItemId === catalogItem.id &&
        paidExtra.sourceText === item.sourceText &&
        sourceTextIsGrounded(message, paidExtra.sourceText)
    );
    sanitized.paidExtras.push({
      catalogItemId: catalogItem.id,
      catalogItemName: catalogItem.name,
      quantity: item.quantity,
      catalogPrice: catalogItem.price,
      currency: catalogItem.currency,
      sourceText: item.sourceText,
      reason: 'This authoritative catalog item is marked as a paid extra.',
      confidence: item.confidence,
    });
    if (
      !providerPaidExtra ||
      providerPaidExtra.catalogItemName !== catalogItem.name ||
      providerPaidExtra.quantity !== item.quantity ||
      providerPaidExtra.catalogPrice !== catalogItem.price ||
      providerPaidExtra.currency !== catalogItem.currency ||
      providerPaidExtra.reason !==
        'This authoritative catalog item is marked as a paid extra.' ||
      providerPaidExtra.confidence !== item.confidence
    ) {
      changed = true;
    }
    paidExtraWarnings.push({
      code: 'paid_extra',
      severity: 'warning',
      message: `Confirm the paid extra ${catalogItem.name} before applying this draft.`,
    });
  }

  if (review.paidExtras.length !== sanitized.paidExtras.length) changed = true;

  if (review.warnings.length > 0) changed = true;
  sanitized.warnings = [...paidExtraWarnings, ...generatedWarnings].slice(
    0,
    REVIEW_LIMITS.warnings
  );

  if (changed) {
    sanitized.overallConfidence = Math.min(sanitized.overallConfidence, 0.5);
  }

  if (changed && sanitized.warnings.length < REVIEW_LIMITS.warnings) {
    pushUniqueCapped(
      sanitized.warnings,
      {
        code: 'other',
        severity: 'warning',
        message: 'The AI draft was safely normalized and requires human review before use.',
      },
      REVIEW_LIMITS.warnings,
      (warning) => `${warning.code}\u0000${warning.message}`
    );
  }

  const finalReview = OrderIntakeReviewSchema.safeParse(sanitized);
  if (!finalReview.success || !evidenceIsGrounded(sanitized, message)) return null;
  return finalReview.data;
}

function createOpenAIOrderIntake({
  client,
  model,
  reasoningEffort,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  // Intake gets its own model/effort knobs (OPENAI_INTAKE_MODEL /
  // OPENAI_INTAKE_EFFORT) so upgrading order understanding does not raise
  // the cost of every other AI feature sharing OPENAI_MODEL.
  function resolveReasoningEffort() {
    const selected = typeof reasoningEffort === 'string' ? reasoningEffort : env.OPENAI_INTAKE_EFFORT;
    return ['minimal', 'low', 'medium', 'high'].includes(selected) ? selected : null;
  }

  function resolveModel() {
    const selectedModel =
      typeof model === 'string'
        ? model
        : typeof env.OPENAI_INTAKE_MODEL === 'string' && env.OPENAI_INTAKE_MODEL.trim()
          ? env.OPENAI_INTAKE_MODEL
          : env.OPENAI_MODEL;
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
    // Exported WhatsApp chats arrive with timestamp/sender prefixes and
    // directional marks; grounding quotes must run against the same cleaned
    // transcript the model reads, so normalization happens here, once.
    const normalizedMessage = normalizeWhatsAppInput(message);
    if (normalizedMessage === '') {
      throw serviceError(SERVICE_ERROR_CODES.INVALID_INPUT);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const isRetry = attempt === 1;
      let response;

      try {
        const effortOverride = resolveReasoningEffort();
        response = await selectedClient.responses.parse({
          model: selectedModel,
          store: false,
          ...(isRetry ? OPENAI_RETRY_LIMITS : OPENAI_REQUEST_LIMITS),
          ...(effortOverride ? { reasoning: { effort: effortOverride } } : {}),
          input: [
            {
              role: 'system',
              content: isRetry
                ? `${ORDER_INTAKE_SYSTEM_PROMPT}\n\n${RETRY_SYSTEM_INSTRUCTION}`
                : ORDER_INTAKE_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: buildOrderIntakeUserPrompt({
                message: normalizedMessage,
                catalog: parsedCatalog.data,
              }),
            },
          ],
          text: {
            format: zodTextFormat(OrderIntakeReviewSchema, 'order_intake_review'),
          },
        });
      } catch (error) {
        if (isStructuredOutputParseError(error) && !isRetry) continue;
        throw serviceError(
          isStructuredOutputParseError(error)
            ? SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
            : SERVICE_ERROR_CODES.PROVIDER_FAILURE,
          isStructuredOutputParseError(error)
            ? 'structured_parse_failed'
            : 'provider_request_failed'
        );
      }

      if (hasRefusal(response)) {
        throw serviceError(SERVICE_ERROR_CODES.REFUSED, 'provider_refusal');
      }

      if (!response || response.status === 'incomplete') {
        if (!isRetry) continue;
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'incomplete_response');
      }

      if (!Array.isArray(response.output)) {
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'invalid_output_shape');
      }

      if (response.status && response.status !== 'completed') {
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'invalid_response_status');
      }

      let outputParsed;
      try {
        outputParsed = response.output_parsed;
      } catch (error) {
        if (isStructuredOutputParseError(error) && !isRetry) continue;
        throw serviceError(
          SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT,
          'structured_output_access_failed'
        );
      }

      if (outputParsed === null || typeof outputParsed === 'undefined') {
        if (!isRetry) continue;
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'null_parsed_output');
      }

      const parsedReview = OrderIntakeReviewSchema.safeParse(outputParsed);
      if (!parsedReview.success) {
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'schema_invalid');
      }

      const sanitizedReview = sanitizeReview(
        parsedReview.data,
        parsedCatalog.data,
        normalizedMessage
      );
      if (!sanitizedReview) {
        throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'sanitization_failed');
      }

      return withGroupWarning(sanitizedReview, normalizedMessage);
    }

    throw serviceError(SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT, 'retry_exhausted');
  };
}

module.exports = {
  detectGroupSignal,
  OPENAI_CLIENT_OPTIONS,
  OPENAI_REQUEST_LIMITS,
  OPENAI_RETRY_LIMITS,
  OrderIntakeServiceError,
  SERVICE_ERROR_CODES,
  createOpenAIOrderIntake,
  sourceTextMatchesCatalogItem,
};
