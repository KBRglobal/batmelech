'use strict';

// Reads a supplier invoice (PDF or photo) with OpenAI structured outputs and
// returns merchant, date, currency, total and categorized line items. Prices
// come back in minor units so no float arithmetic ever touches money.

const OpenAI = require('openai');
const { zodTextFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const EXPENSE_CATEGORIES = Object.freeze([
  'fruits',
  'vegetables',
  'meat_fish',
  'dairy',
  'dry_goods',
  'packaging',
  'other',
]);

const InvoiceItemSchema = z.object({
  name: z.string().min(1).max(160),
  quantity: z.number().nonnegative().nullable(),
  unitPriceMinor: z.number().int().nonnegative().nullable(),
  totalMinor: z.number().int().nonnegative().nullable(),
  category: z.enum(EXPENSE_CATEGORIES),
});

const InvoiceScanSchema = z.object({
  merchant: z.string().max(160).nullable(),
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .nullable(),
  currency: z.string().length(3).nullable(),
  totalMinor: z.number().int().nonnegative().nullable(),
  items: z.array(InvoiceItemSchema).max(200),
});

const SYSTEM_PROMPT = [
  'You read supplier invoices and receipts for a kosher catering kitchen in Dubai.',
  'Extract the merchant name, the purchase date (YYYY-MM-DD), the ISO currency code, the grand total, and every line item.',
  'Dates on UAE invoices are printed day-first (DD/MM/YYYY). Never emit a purchase date later than today; if a parsed date lands in the future, the day and month were swapped — flip them.',
  'All money amounts must be integer minor units (fils/agorot/cents): 12.50 AED -> 1250.',
  'Classify every item into exactly one category:',
  'fruits (fresh fruit), vegetables (fresh vegetables and herbs), meat_fish (meat, poultry, fish), dairy (milk, cheese, eggs), dry_goods (grains, spices, oil, canned, baking, drinks), packaging (containers, bags, disposables, cleaning), other (anything else, including delivery fees and deposits).',
  'Item names: keep the language they are printed in. Never invent values — use null when a field is not on the document.',
].join('\n');

class InvoiceScanError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'InvoiceScanError';
    this.code = code;
  }
}

function createInvoiceScanner({
  client,
  model,
  env = process.env,
  clientFactory = (options) => new OpenAI(options),
} = {}) {
  let openAIClient = client || null;

  function resolveModel() {
    const selected = typeof model === 'string' ? model : env.OPENAI_MODEL;
    if (typeof selected !== 'string' || !selected.trim()) {
      throw new InvoiceScanError('ai_not_configured', 'Invoice scanning is unavailable.');
    }
    return selected.trim();
  }

  function resolveClient() {
    if (!openAIClient) {
      const apiKey = env.OPENAI_API_KEY;
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new InvoiceScanError('ai_not_configured', 'Invoice scanning is unavailable.');
      }
      openAIClient = clientFactory(Object.freeze({ apiKey: apiKey.trim(), maxRetries: 1, timeout: 90_000 }));
    }
    if (!openAIClient.responses || typeof openAIClient.responses.parse !== 'function') {
      throw new InvoiceScanError('ai_not_configured', 'Invoice scanning is unavailable.');
    }
    return openAIClient;
  }

  return async function scanInvoice({ buffer, contentType, fileName = 'invoice.pdf' }) {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
      throw new InvoiceScanError('invalid_input', 'Empty file.');
    }

    const selectedModel = resolveModel();
    const selectedClient = resolveClient();

    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
    const fileContent =
      contentType === 'application/pdf'
        ? { type: 'input_file', filename: fileName, file_data: dataUrl }
        : { type: 'input_image', image_url: dataUrl, detail: 'high' };

    let response;
    try {
      response = await selectedClient.responses.parse({
        model: selectedModel,
        store: false,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: `Extract this supplier invoice. Today is ${new Date().toISOString().slice(0, 10)}.` },
              fileContent,
            ],
          },
        ],
        text: {
          format: zodTextFormat(InvoiceScanSchema, 'invoice_scan'),
        },
      });
    } catch (error) {
      throw new InvoiceScanError('provider_failure', error?.message);
    }

    if (!response || (response.status && response.status !== 'completed')) {
      throw new InvoiceScanError('invalid_provider_output', 'Scan did not complete.');
    }

    const parsed = InvoiceScanSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new InvoiceScanError('invalid_provider_output', 'Scan returned an unexpected shape.');
    }
    return parsed.data;
  };
}

module.exports = { createInvoiceScanner, InvoiceScanError, EXPENSE_CATEGORIES };
