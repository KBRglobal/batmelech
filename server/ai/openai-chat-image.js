'use strict';

// Screenshot fallback for WhatsApp intake (the approved spec keeps Export
// Chat as the primary whole-conversation path; a screenshot is only for the
// odd case where exporting is impractical). The image is transcribed into
// the same "Sender: text" transcript the text pipeline uses, and that
// transcript is what the operator sees and the review is grounded against.

const OpenAI = require('openai');

const OPENAI_CLIENT_OPTIONS = Object.freeze({ maxRetries: 0, timeout: 90_000 });
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000; // ~6MB of image data
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/u;
const MAX_TRANSCRIPT_LENGTH = 24000;

const CHAT_IMAGE_SYSTEM_PROMPT = `You transcribe a screenshot of a WhatsApp chat for a kosher kitchen's order desk.

Rules:
- Output ONLY the chat messages, one per line, in visual top-to-bottom order, in the form "Sender: text".
- Use "לקוח" as the sender for messages aligned to the customer side and "בת מלך" for the business side when names are not visible.
- Transcribe text exactly as written, in its original language. Never translate, summarize, complete cut-off words, or add anything.
- Skip timestamps, day separators, and system notices.
- If part of a message is unreadable, write [לא קריא] in its place.
- If the image is not a chat screenshot, output exactly: NOT_A_CHAT`;

class ChatImageServiceError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'ChatImageServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isValidImageDataUrl(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    IMAGE_DATA_URL_PATTERN.test(value)
  );
}

function createOpenAIChatImageTranscriber({
  client,
  model,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  function resolveModel() {
    const selected = typeof model === 'string' ? model : env.OPENAI_MODEL;
    if (typeof selected !== 'string' || !selected.trim()) {
      throw new ChatImageServiceError('ai_not_configured', 503, 'Screenshot reading is unavailable.');
    }
    return selected.trim();
  }

  function resolveClient() {
    if (!openAIClient) {
      const apiKey = env.OPENAI_API_KEY;
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new ChatImageServiceError('ai_not_configured', 503, 'Screenshot reading is unavailable.');
      }
      try {
        openAIClient = clientFactory(Object.freeze({ apiKey: apiKey.trim(), ...OPENAI_CLIENT_OPTIONS }));
      } catch {
        throw new ChatImageServiceError('ai_not_configured', 503, 'Screenshot reading is unavailable.');
      }
    }
    if (!openAIClient.responses || typeof openAIClient.responses.create !== 'function') {
      throw new ChatImageServiceError('ai_not_configured', 503, 'Screenshot reading is unavailable.');
    }
    return openAIClient;
  }

  return async function transcribeChatImage(imageDataUrl) {
    if (!isValidImageDataUrl(imageDataUrl)) {
      throw new ChatImageServiceError('invalid_request', 400, 'Invalid chat screenshot.');
    }
    const selectedModel = resolveModel();
    const selectedClient = resolveClient();

    let response;
    try {
      response = await selectedClient.responses.create({
        model: selectedModel,
        store: false,
        max_output_tokens: 4000,
        input: [
          { role: 'system', content: CHAT_IMAGE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Transcribe this WhatsApp chat screenshot.' },
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
            ],
          },
        ],
      });
    } catch {
      throw new ChatImageServiceError('ai_provider_error', 502, 'Screenshot reading failed.');
    }

    const text = typeof response?.output_text === 'string' ? response.output_text.trim() : '';
    if (text === '' || text.length > MAX_TRANSCRIPT_LENGTH) {
      throw new ChatImageServiceError('invalid_ai_response', 502, 'Screenshot reading returned an invalid transcript.');
    }
    if (text === 'NOT_A_CHAT') {
      throw new ChatImageServiceError('ai_refused', 422, 'The image does not look like a chat screenshot.');
    }
    return text;
  };
}

module.exports = {
  CHAT_IMAGE_SYSTEM_PROMPT,
  ChatImageServiceError,
  MAX_IMAGE_DATA_URL_LENGTH,
  createOpenAIChatImageTranscriber,
  isValidImageDataUrl,
};
