'use strict';

const OpenAI = require('openai');
const { MEY_SYSTEM_PROMPT } = require('./mey-persona');
const { createMeyTools } = require('./mey-tools');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 1, timeout: 60_000 });
const MAX_TOOL_ROUNDS = 6;
const FALLBACK_REPLY = 'משהו השתבש אצלי, נסי לשלוח שוב עוד רגע 🙏';

function createMeyAgent({
  repository,
  logger = console,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  let client = null;

  function resolveModel() {
    const model = env.OPENAI_MODEL;
    if (typeof model !== 'string' || !model.trim()) return null;
    return model.trim();
  }

  function resolveClient() {
    if (client) return client;
    const apiKey = env.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim()) return null;
    client = clientFactory(Object.freeze({ apiKey: apiKey.trim(), ...OPENAI_CLIENT_OPTIONS }));
    return client;
  }

  const tools = createMeyTools({ repository, logger });

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

      // The sender line lets the persona apply its per-person register
      // (Lin / Felix / the technical boss). Absent sender -> generic.
      const senderUsername = sender && typeof sender.username === 'string' ? sender.username.trim() : '';
      const senderName = sender && typeof sender.firstName === 'string' ? sender.firstName.trim() : '';
      const senderLine = senderUsername || senderName
        ? `[השולח: ${senderName || 'ללא שם'}${senderUsername ? ` @${senderUsername}` : ''}]\n`
        : '';

      const input = [
        { role: 'system', content: MEY_SYSTEM_PROMPT },
        { role: 'user', content: `${senderLine}${userMessage.trim()}` },
      ];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        let response;
        try {
          response = await selectedClient.responses.create({
            model,
            store: false,
            input,
            tools: tools.definitions,
          });
        } catch (error) {
          logger.error('mey agent OpenAI call failed', error);
          return FALLBACK_REPLY;
        }

        const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');
        if (functionCalls.length === 0) {
          const text = typeof response.output_text === 'string' ? response.output_text.trim() : '';
          return text || FALLBACK_REPLY;
        }

        input.push(...functionCalls);
        for (const call of functionCalls) {
          let args = {};
          try {
            args = JSON.parse(call.arguments || '{}');
          } catch {
            args = {};
          }
          const result = await tools.execute(call.name, args);
          input.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }

      logger.error('mey agent exceeded max tool rounds');
      return FALLBACK_REPLY;
    },
  };
}

module.exports = { createMeyAgent };
