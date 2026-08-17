'use strict';

// Normalizes WhatsApp content into a clean "Sender: text" transcript the
// order-intake pipeline can ground quotes against. Two shapes are handled:
//
// 1. The native "Export chat" .txt file (the whole-conversation path Moshe
//    approved — one tap in WhatsApp, never screenshots). iOS and Android
//    write different timestamp prefixes; both are recognized:
//      iOS:     [18/08/2026, 14:32:11] Lin: text
//      Android: 18/08/26, 14:32 - Lin: text
// 2. Plain pasted text (multi-select copy, or a single message) — returned
//    unchanged apart from whitespace/directional-mark cleanup.
//
// System lines (encryption notice, media placeholders, deleted messages)
// are dropped so the AI never mistakes them for customer intent.

const MAX_INPUT_LENGTH = 200_000;

// Timestamp prefixes. Date and time formats vary by device locale, so the
// match is deliberately loose about digits/separators and strict about shape.
const IOS_LINE = /^\[[^\]\n]{6,40}\]\s(.{1,120}?):\s([\s\S]*)$/u;
const ANDROID_LINE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?\s[-–]\s(.{1,120}?):\s([\s\S]*)$/u;
const IOS_SYSTEM_LINE = /^\[[^\]\n]{6,40}\]\s[^:\n]{0,200}$/u;
const ANDROID_SYSTEM_LINE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?\s[-–]\s[^:\n]{0,200}$/u;

const MEDIA_PLACEHOLDERS = [
  '<media omitted>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'sticker omitted',
  'gif omitted',
  'document omitted',
  'contact card omitted',
  'this message was deleted',
  'you deleted this message',
  'null',
  'הודעה זו נמחקה',
  'מחקת את ההודעה הזו',
  'תמונה הושמטה',
  'סרטון הושמט',
  'מדיה הושמטה',
];

function stripDirectionalMarks(value) {
  // U+200E/U+200F/U+202A-U+202E/U+2066-U+2069 — WhatsApp sprinkles these
  // around timestamps and RTL names; they break exact-quote grounding.
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
}

function isMediaPlaceholder(text) {
  const normalized = text.trim().toLowerCase();
  return MEDIA_PLACEHOLDERS.some(
    (placeholder) => normalized === placeholder
  );
}

function parseMessageLine(line) {
  const ios = IOS_LINE.exec(line);
  if (ios) return { sender: ios[1].trim(), text: ios[2] };
  const android = ANDROID_LINE.exec(line);
  if (android) return { sender: android[1].trim(), text: android[2] };
  return null;
}

function isSystemLine(line) {
  return IOS_SYSTEM_LINE.test(line) || ANDROID_SYSTEM_LINE.test(line);
}

// Returns { isExport, messages: [{sender, text}] }. messages is empty when
// the input is not an exported chat.
function parseWhatsAppExport(input) {
  if (typeof input !== 'string') return { isExport: false, messages: [] };
  const cleaned = stripDirectionalMarks(input.slice(0, MAX_INPUT_LENGTH));
  const lines = cleaned.split(/\r?\n/u);

  const messages = [];
  let current = null;
  let timestampedLines = 0;

  for (const line of lines) {
    const parsed = parseMessageLine(line);
    if (parsed) {
      timestampedLines += 1;
      if (current) messages.push(current);
      current = isMediaPlaceholder(parsed.text)
        ? null
        : { sender: parsed.sender, text: parsed.text.trim() };
      continue;
    }
    if (isSystemLine(line)) {
      timestampedLines += 1;
      if (current) messages.push(current);
      current = null;
      continue;
    }
    // Continuation of a multi-line message.
    if (current) current.text = `${current.text}\n${line}`.trim();
  }
  if (current) messages.push(current);

  const kept = messages.filter((message) => message.text.trim() !== '');
  // An export has at least two timestamped lines; a lone "[...]" in pasted
  // free text must not trigger export handling.
  if (timestampedLines < 2 || kept.length === 0) return { isExport: false, messages: [] };
  return { isExport: true, messages: kept };
}

// The single normalization entry point for any WhatsApp-shaped input.
// Exported chats become "Sender: text" lines in original order; anything
// else is returned cleaned but unchanged.
function normalizeWhatsAppInput(input) {
  if (typeof input !== 'string') return '';
  const parsed = parseWhatsAppExport(input);
  if (!parsed.isExport) {
    return stripDirectionalMarks(input).trim();
  }
  return parsed.messages
    .map((message) => `${message.sender}: ${message.text}`)
    .join('\n')
    .trim();
}

module.exports = {
  MAX_INPUT_LENGTH,
  normalizeWhatsAppInput,
  parseWhatsAppExport,
  stripDirectionalMarks,
};
