'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeWhatsAppInput,
  parseWhatsAppExport,
  stripDirectionalMarks,
} = require('../server/ai/whatsapp-chat');

test('parses an iOS export with multi-line messages and drops media/system lines', () => {
  const input = [
    '[18/08/2026, 14:30:01] Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
    '[18/08/2026, 14:32:11] Lin: שלום, במה אפשר לעזור?',
    '[18/08/2026, 14:33:00] David Cohen: אפשר 2 חלות',
    'וגם סלט חצילים',
    '[18/08/2026, 14:34:00] David Cohen: image omitted',
    '[18/08/2026, 14:35:00] David Cohen: בעצם בלי הסלט',
  ].join('\n');

  const parsed = parseWhatsAppExport(input);
  assert.equal(parsed.isExport, true);
  assert.deepEqual(parsed.messages, [
    { sender: 'Lin', text: 'שלום, במה אפשר לעזור?' },
    { sender: 'David Cohen', text: 'אפשר 2 חלות\nוגם סלט חצילים' },
    { sender: 'David Cohen', text: 'בעצם בלי הסלט' },
  ]);

  assert.equal(
    normalizeWhatsAppInput(input),
    'Lin: שלום, במה אפשר לעזור?\nDavid Cohen: אפשר 2 חלות\nוגם סלט חצילים\nDavid Cohen: בעצם בלי הסלט'
  );
});

test('parses an Android export (dash separator, no seconds)', () => {
  const input = [
    '18/08/26, 14:32 - Lin: hi',
    '18/08/26, 14:33 - Sarah: two challahs please',
    '18/08/26, 14:34 - Sarah: <Media omitted>',
  ].join('\n');

  assert.equal(normalizeWhatsAppInput(input), 'Lin: hi\nSarah: two challahs please');
});

test('plain pasted text is returned unchanged (not treated as an export)', () => {
  const message = 'שלום, אפשר להזמין 2 חלות ליום שישי? [חשוב]';
  assert.equal(normalizeWhatsAppInput(message), message);
  assert.equal(parseWhatsAppExport(message).isExport, false);
});

test('a single timestamped line inside free text does not trigger export mode', () => {
  const message = 'ההודעה הגיעה ב-[18/08/2026, 14:32:11] Lin: נא לבדוק';
  assert.equal(parseWhatsAppExport(message).isExport, false);
});

test('directional marks are stripped everywhere', () => {
  const marked = '‎שתי חלות‏ בבקשה⁦!⁩';
  assert.equal(stripDirectionalMarks(marked), 'שתי חלות בבקשה!');
  assert.equal(normalizeWhatsAppInput(marked), 'שתי חלות בבקשה!');
});

test('non-string and empty inputs are safe', () => {
  assert.equal(normalizeWhatsAppInput(null), '');
  assert.equal(normalizeWhatsAppInput(undefined), '');
  assert.equal(normalizeWhatsAppInput(''), '');
  assert.deepEqual(parseWhatsAppExport(null), { isExport: false, messages: [] });
});

test('an export where every message is media falls back to non-export handling', () => {
  const input = [
    '[18/08/2026, 14:32:11] Lin: image omitted',
    '[18/08/2026, 14:33:00] David: video omitted',
  ].join('\n');
  assert.equal(parseWhatsAppExport(input).isExport, false);
});
