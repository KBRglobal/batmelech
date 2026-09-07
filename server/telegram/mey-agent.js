'use strict';

const OpenAI = require('openai');
const { MEY_SYSTEM_PROMPT } = require('./mey-persona');
const { createMeyTools } = require('./mey-tools');
const { loadRecentTurns, appendTurn } = require('./mey-memory');
const { buildBriefing } = require('./mey-briefing');
const { verifyReply } = require('./mey-verifier');
const { allowedNumberTokens } = require('../ai/openai-order-reply');
const { USD_TO_AED } = require('../domain/money-labels');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 1, timeout: 60_000 });
const MAX_TOOL_ROUNDS = 8;
const REASONING_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high']);
const DEFAULT_REASONING_EFFORT = 'medium';
const FALLBACK_REPLY = 'משהו השתבש אצלי, נסי לשלוח שוב עוד רגע 🙏';

// What goes out when the model, corrected once, still quotes a number that
// exists nowhere in the data. Better an honest "I could not find it" than a
// confident wrong amount — that is exactly the answer Lin's customer got once.
const UNGROUNDED_REPLY =
  'בדקתי במערכת ולא מצאתי מספר מדויק לזה, ואני לא רוצה לנחש. תני לי שם מלא, טלפון או תאריך ואבדוק שוב 🙏';

// Numbers this small are counting, not claiming: list numbering, "2 in
// Atlantis", days of the month, hours. Every larger number must trace back to
// the data the model was given.
const FREE_INTEGER_MAX = 31;

const HEBREW_WEEKDAYS = Object.freeze({
  Sun: 'ראשון',
  Mon: 'שני',
  Tue: 'שלישי',
  Wed: 'רביעי',
  Thu: 'חמישי',
  Fri: 'שישי',
  Sat: 'שבת',
});

const dubaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dubaiTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dubaiWeekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'short' });

function comingFriday(now) {
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const candidate = new Date(now.getTime() + ahead * 86_400_000);
    if (dubaiWeekdayFormatter.format(candidate) === 'Fri') return dubaiDateFormatter.format(candidate);
  }
  return dubaiDateFormatter.format(now);
}

// The model has no clock. Without this line "tomorrow" is a guess, and it
// guessed wrong in the staff chat ("no deliveries on that date" for a day
// with seven). Fresh on every turn.
function nowBlock(now = new Date()) {
  const weekday = HEBREW_WEEKDAYS[dubaiWeekdayFormatter.format(now)] || '';
  return [
    `עכשיו (שעון דובאי): יום ${weekday}, ${dubaiDateFormatter.format(now)}, ${dubaiTimeFormatter.format(now)}.`,
    `יום המשלוחים הקרוב (שישי): ${comingFriday(now)}. "היום", "מחר" ו"שישי" — תחשבי מהתאריך הזה.`,
    `מטבע: המחירים בדולרים. השער קבוע, 1$ = ${USD_TO_AED} דירהם, אבל אל תמירי בעצמך — כל סכום שכלי מחזיר מגיע גם`,
    'בדולרים (שדה Usd) וגם בדירהם (שדה Aed). כשמבקשים דירהם, תצטטי את שדה Aed כפי שהוא.',
  ].join('\n');
}

function isFreeInteger(token) {
  return /^\d+$/u.test(token) && Number(token) <= FREE_INTEGER_MAX;
}

function ungroundedNumbers(reply, evidence) {
  const allowed = allowedNumberTokens(evidence);
  const normalized = reply.replace(/(\d),(?=\d{3}(?!\d))/gu, '$1');
  const invented = [];
  for (const match of normalized.matchAll(/\d+(?:\.\d+)?/gu)) {
    const token = match[0];
    if (isFreeInteger(token)) continue;
    if (allowed.has(token) || allowed.has(String(Number(token)))) continue;
    const parts = token.split('.');
    if (parts.length === 2 && parts.every((part) => isFreeInteger(part) || allowed.has(part) || allowed.has(String(Number(part))))) {
      continue;
    }
    invented.push(token);
  }
  return invented;
}

/** True when every number in the reply appears in the evidence (tool outputs, what the person wrote). */
function replyIsGrounded(reply, evidence) {
  return ungroundedNumbers(reply, evidence).length === 0;
}

function correctionInstruction(invented) {
  return (
    `תיקון מהמערכת: המספרים ${invented.join(', ')} בתשובה שלך לא מופיעים בשום נתון שקיבלת — לא בכלי ולא ` +
    'בהודעה. אסור להמציא, לעגל, לחשב או להמיר מטבע בעצמך. תני תשובה חדשה שבה כל מספר מועתק בדיוק מתוצאת ' +
    'כלי (כולל שדות Usd/Aed) או מהודעת האדם. אם הנתון לא קיים — תגידי שלא מצאת אותו, בלי מספר.'
  );
}

// A reply that states nothing checkable (a greeting, a clarifying question)
// does not need the truth check; anything with a digit, or produced after a
// tool call, does.
function needsVerification(text, toolOutputs) {
  return toolOutputs.length > 0 || /\d/u.test(text);
}

function createMeyAgent({
  repository,
  pool = null,
  logger = console,
  env = process.env,
  whatsappIntake = null,
  clientFactory = (options) => new OpenAI(options),
  toolsFactory = (options) => createMeyTools(options),
  now = () => new Date(),
} = {}) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  let client = null;

  // Mey gets her own model/effort knobs (OPENAI_MEY_MODEL / OPENAI_MEY_EFFORT)
  // so she can run on a stronger model than the rest of the AI features
  // without raising their cost. OPENAI_MEY_VERIFY=off disables the truth check.
  function resolveModel() {
    const own = env.OPENAI_MEY_MODEL;
    const model = typeof own === 'string' && own.trim() ? own : env.OPENAI_MODEL;
    if (typeof model !== 'string' || !model.trim()) return null;
    return model.trim();
  }

  function resolveReasoningEffort() {
    const selected = env.OPENAI_MEY_EFFORT;
    return REASONING_EFFORTS.includes(selected) ? selected : DEFAULT_REASONING_EFFORT;
  }

  function verificationEnabled() {
    return env.OPENAI_MEY_VERIFY !== 'off';
  }

  function resolveClient() {
    if (client) return client;
    const apiKey = env.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim()) return null;
    client = clientFactory(Object.freeze({ apiKey: apiKey.trim(), ...OPENAI_CLIENT_OPTIONS }));
    return client;
  }

  const tools = toolsFactory({ repository, logger, whatsappIntake });

  async function briefingFor(today) {
    try {
      const current = await repository.loadState();
      return buildBriefing(current && current.data, { today });
    } catch (error) {
      logger.error('mey briefing failed', error);
      return '';
    }
  }

  // One model conversation: tool rounds until the model answers in text.
  // Returns null on provider failure; every tool result is collected as
  // evidence for the grounding and truth checks.
  async function converse({ input, model, effort, selectedClient, evidence, toolOutputs, senderLabel }) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let response;
      try {
        response = await selectedClient.responses.create({
          model,
          store: false,
          reasoning: { effort },
          input,
          tools: tools.definitions,
        });
      } catch (error) {
        logger.error('mey agent OpenAI call failed', error);
        return null;
      }

      const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');
      if (functionCalls.length === 0) {
        return typeof response.output_text === 'string' ? response.output_text.trim() : '';
      }

      input.push(...functionCalls);
      for (const call of functionCalls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await tools.execute(call.name, args, { sender: senderLabel });
        const record = { tool: call.name, args, result };
        evidence.push(result);
        toolOutputs.push(record);
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
    }
    logger.error('mey agent exceeded max tool rounds');
    return null;
  }

  return {
    async reply(userMessage, sender) {
      const model = resolveModel();
      const selectedClient = resolveClient();
      if (!model || !selectedClient) {
        logger.error('mey agent not configured: missing OPENAI_MODEL or OPENAI_API_KEY');
        return FALLBACK_REPLY;
      }
      if (typeof userMessage !== 'string' || !userMessage.trim()) {
        return FALLBACK_REPLY;
      }
      const effort = resolveReasoningEffort();

      // The sender line lets the persona apply its per-person register
      // (Lin / Felix / the technical boss). Absent sender -> generic.
      const senderUsername = sender && typeof sender.username === 'string' ? sender.username.trim() : '';
      const senderName = sender && typeof sender.firstName === 'string' ? sender.firstName.trim() : '';
      const senderLabel = `${senderName || (senderUsername ? '' : '')}${senderUsername ? `${senderName ? ' ' : ''}@${senderUsername}` : ''}`.trim();
      const senderLine = senderLabel ? `[השולח: ${senderName || 'ללא שם'}${senderUsername ? ` @${senderUsername}` : ''}]\n` : '';

      // Rolling memory: the last turns of the group conversation, so follow-ups
      // ("וזה?", "אז מה אמרת קודם?") make sense. Memory failures degrade to a
      // memoryless reply, never to a crash.
      let recentTurns = [];
      if (pool) {
        try {
          recentTurns = await loadRecentTurns(pool);
        } catch (error) {
          logger.error('mey memory load failed', error);
        }
      }

      const current = now();
      const clock = nowBlock(current);
      const briefing = await briefingFor(dubaiDateFormatter.format(current));
      const userTurn = `${senderLine}${userMessage.trim()}`;
      const input = [
        { role: 'system', content: [MEY_SYSTEM_PROMPT, clock, briefing].filter(Boolean).join('\n\n') },
        ...recentTurns,
        { role: 'user', content: userTurn },
      ];

      // Numbers the model may repeat: what people wrote (this turn and the
      // remembered ones), the clock and briefing lines, and every tool result.
      // Earlier assistant turns are deliberately NOT evidence — a number
      // invented yesterday must not launder itself through memory.
      const evidence = [clock, briefing, userTurn, ...recentTurns.filter((turn) => turn.role === 'user').map((turn) => turn.content)];
      const toolOutputs = [];
      const session = { input, model, effort, selectedClient, evidence, toolOutputs, senderLabel };

      let text = await converse(session);
      if (text === null) return FALLBACK_REPLY;

      // 1. number guard — one correction round, then the honest fallback
      let invented = text ? ungroundedNumbers(text, evidence) : [];
      if (invented.length > 0) {
        logger.error(`mey reply quoted numbers absent from the data: ${invented.join(', ')}`);
        input.push({ role: 'assistant', content: text });
        input.push({ role: 'system', content: correctionInstruction(invented) });
        text = await converse(session);
        if (text === null) return FALLBACK_REPLY;
        invented = text ? ungroundedNumbers(text, evidence) : [];
        if (invented.length > 0) {
          logger.error(`mey reply still ungrounded after correction: ${invented.join(', ')}`);
          text = UNGROUNDED_REPLY;
        }
      }

      // 2. truth check — every claim against the evidence, not just numbers
      if (text && text !== UNGROUNDED_REPLY && verificationEnabled() && needsVerification(text, toolOutputs)) {
        const verdict = await verifyReply({
          client: selectedClient,
          model,
          evidence: { briefing, toolOutputs },
          userTurn,
          draft: text,
          logger,
        });
        if (verdict && !verdict.ok && verdict.corrected) {
          logger.error(`mey verifier corrected the reply: ${verdict.problems.join(' | ')}`);
          text = replyIsGrounded(verdict.corrected, evidence) ? verdict.corrected : UNGROUNDED_REPLY;
        }
      }

      if (pool && text) {
        // remember the exchange; failures must not delay or break the reply
        appendTurn(pool, 'user', userTurn)
          .then(() => appendTurn(pool, 'assistant', text))
          .catch((error) => logger.error('mey memory append failed', error));
      }
      return text || FALLBACK_REPLY;
    },
  };
}

module.exports = {
  DEFAULT_REASONING_EFFORT,
  UNGROUNDED_REPLY,
  createMeyAgent,
  needsVerification,
  nowBlock,
  replyIsGrounded,
  ungroundedNumbers,
};
