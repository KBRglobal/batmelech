'use strict';

// The truth check. After מיי drafts a reply, a second model pass reads only
// the evidence she actually had — what the person wrote and what her tools
// returned — and checks every factual claim in the draft against it: names,
// amounts, dates, hotels, statuses, dishes, phone numbers, counts. A claim
// with no source is either replaced by the supported fact or by an honest
// "I did not find that". The number guard in mey-agent catches invented
// digits; this catches everything else.

const MAX_EVIDENCE_CHARS = 60_000;

const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true when every factual claim in the draft is supported by the evidence' },
    problems: {
      type: 'array',
      items: { type: 'string' },
      description: 'each unsupported or contradicted claim, quoted, with what the evidence says instead',
    },
    corrected: {
      type: 'string',
      description: 'the draft when ok; otherwise the draft rewritten so every claim is supported, same tone and language',
    },
  },
  required: ['ok', 'problems', 'corrected'],
  additionalProperties: false,
});

const VERIFIER_INSTRUCTIONS = `את בודקת עובדות של עוזרת בשם מיי בעסק קייטרינג. תקבלי: (1) הראיות — מה שהאדם כתב ומה שהכלים החזירו, (2) טיוטת תשובה.
תבדקי כל טענה עובדתית בטיוטה מול הראיות בלבד: שמות לקוחות, סכומים, תאריכים, שעות, מלונות וכתובות, סטטוסים, מנות וכמויות, טלפונים, מספרים כלשהם.
- טענה שמופיעה בראיות (גם בניסוח אחר או בעיגול שהראיות מאפשרות) — נתמכת.
- ברכות, חום, שאלות הבהרה, הצעות ("אם תרצי"), וחזרה על מה שהאדם עצמו כתב — לא טענות עובדתיות, לא לפסול.
- טענה שאין לה שום מקור בראיות, או שסותרת אותן — לא נתמכת.
- לא לפסול ניסוח טבעי של מה שהכלי החזיר: "ההזמנה הכי גדולה אי פעם" כשהכלי מיין את כל ההזמנות לפי סכום, "אין משלוחים מחר" כשהכלי החזיר 0, סיכום או עיגול שהראיות מאפשרות. את בודקת עובדות, לא דקדוקי ניסוח — תיקון רק כשיש טעות אמיתית שלין תקבל ממנה מידע שגוי.
אם הכול נתמך: ok=true, problems=[], corrected=הטיוטה כמו שהיא.
אם לא: ok=false, problems=רשימת הטענות הבעייתיות (ציטוט + מה הראיות אומרות), corrected=הטיוטה משוכתבת: אותו טון, אותה שפה, אותו אורך בערך — טענה לא נתמכת מוחלפת בעובדה הנתמכת מהראיות, ואם אין כזו — במשפט קצר שלא נמצא מידע על זה. לא להוסיף עובדות חדשות שאינן בראיות.`;

function clip(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length <= MAX_EVIDENCE_CHARS ? serialized : `${serialized.slice(0, MAX_EVIDENCE_CHARS)}…(נחתך)`;
}

/**
 * Returns { ok, problems, corrected } or null when the check itself failed
 * (provider error, unparsable output) — the caller then keeps the draft and
 * relies on the number guard alone.
 */
async function verifyReply({ client, model, effort = 'low', evidence, userTurn, draft, logger = console }) {
  const input = [
    { role: 'system', content: VERIFIER_INSTRUCTIONS },
    {
      role: 'user',
      content:
        `הראיות:\n1. מה שהאדם כתב:\n${userTurn}\n\n2. מה שהכלים החזירו (JSON):\n${clip(evidence)}\n\n` +
        `הטיוטה לבדיקה:\n${draft}`,
    },
  ];
  let response;
  try {
    response = await client.responses.create({
      model,
      store: false,
      reasoning: { effort },
      input,
      text: { format: { type: 'json_schema', name: 'mey_verdict', strict: true, schema: VERDICT_SCHEMA } },
    });
  } catch (error) {
    logger.error('mey verifier call failed', error);
    return null;
  }
  const raw = typeof response?.output_text === 'string' ? response.output_text.trim() : '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.ok !== 'boolean' || typeof parsed.corrected !== 'string' || !Array.isArray(parsed.problems)) return null;
    return { ok: parsed.ok, problems: parsed.problems.map(String), corrected: parsed.corrected.trim() };
  } catch {
    logger.error('mey verifier returned unparsable output');
    return null;
  }
}

module.exports = { VERDICT_SCHEMA, VERIFIER_INSTRUCTIONS, verifyReply };
