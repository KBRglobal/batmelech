'use strict';

// The phone-only WhatsApp intake path (approved spec, section F): Lin
// forwards a customer's WhatsApp conversation to מיי in Telegram — as text,
// as the native "Export chat" .txt file, or as a voice note — and gets back
// a saved draft order, a ready-to-copy reply, and a panel link. No computer.
//
// Boundaries preserved: the system never messages a customer; prices and
// dishes come only from the live menu; anything uncertain lands in the
// order's notes for Lin to resolve in the panel. The saved order is status
// חדשה, exactly like an order arriving from the public site.

const crypto = require('node:crypto');
const { normalizeWhatsAppInput } = require('../ai/whatsapp-chat');
const { isWritesFrozen, recordOrderCreated } = require('./mey-audited-actions');

const MAX_ATTEMPTS = 5;
const MAX_CONVERSATION_LENGTH = 24000;

const MISSING_FIELD_LABELS = {
  customer_name: 'שם הלקוח/ה',
  customer_phone: 'טלפון',
  service_date: 'תאריך',
  service_time: 'שעה',
  fulfillment_method: 'משלוח או איסוף',
  delivery_location: 'מלון / כתובת',
  item_quantity: 'כמות לפריט',
  item_choice: 'בחירת פריט',
  other: 'פרט נוסף',
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value, maxLength = 240) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, maxLength) : '';
}

function usd(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

// A server-side projection of the live menu into the intake catalog shape.
// Mirrors the id scheme of the panel's buildAIOrderCatalog so reviews read
// the same either way; weekday-lunch structures are omitted here (they have
// no reliable names in the stored overrides) — those requests surface as
// unknownItems for Lin to place in the panel.
function buildIntakeCatalog(state) {
  const menu = isRecord(state.menu) ? state.menu : {};
  const items = [];
  const priceById = new Map();
  const add = (id, name, category, options = {}) => {
    items.push({
      id,
      name,
      category,
      aliases: options.aliases || [],
      isPaidExtra: options.paid || false,
      price: options.price === undefined ? null : options.price,
      currency: options.price === undefined || options.price === null ? null : 'USD',
    });
    if (options.price !== undefined && options.price !== null) priceById.set(id, options.price);
  };

  add('meal:couple', 'ארוחה זוגית', 'couple_meal', {
    aliases: ['זוגית', 'ארוחה לזוג'],
    price: usd(menu.couplePrice),
  });
  add('selection:challahs', 'חלות', 'challahs', { aliases: ['חלה'], price: usd(menu.challahPrice) });

  const categories = [
    ['salad', 'salads'],
    ['first', 'firsts'],
    ['main', 'mains'],
    ['side', 'sides'],
    ['dessert', 'desserts'],
  ];
  for (const [category, key] of categories) {
    const names = Array.isArray(menu[key]) ? menu[key] : [];
    names.forEach((name, index) => {
      const cleaned = text(name);
      if (cleaned === '') return;
      add(`${category}:${index}`, cleaned, category);
    });
  }

  const extras = Array.isArray(menu.extras) ? menu.extras : [];
  extras.forEach((row, index) => {
    if (!isRecord(row)) return;
    const cleaned = text(row.name);
    if (cleaned === '') return;
    add(`extra:${index}`, cleaned, 'extra', { paid: true, price: usd(row.price) });
  });

  return { items, priceById };
}

function isoDateFrom(value) {
  const cleaned = text(value, 40);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(cleaned)) return cleaned;
  // Customers write 22.8, 22/8, 22.8.2026 — day first, always.
  const match = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/u.exec(cleaned);
  if (!match) return null;
  const now = new Date();
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

function dubaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

function summaryLines(review) {
  return review.draft.items.map((item) => ({
    name: item.catalogItemName,
    qty: item.quantity,
    priceUsd: null,
  }));
}

function buildOrderNotes(review, conversation) {
  const lines = [];
  lines.push('נקלטה מוואטסאפ דרך מיי — טעונה בדיקה ואישור בפאנל.');
  lines.push('');
  lines.push('פריטים שזוהו:');
  for (const item of review.draft.items) {
    lines.push(`• ${item.catalogItemName}${item.quantity === null ? ' — כמות לא צוינה' : ` x${item.quantity}`}`);
  }
  if (review.draft.items.length === 0) lines.push('• (לא זוהו פריטים ודאיים)');
  if (review.unknownItems.length > 0) {
    lines.push('');
    lines.push('בקשות שלא זוהו בתפריט:');
    for (const unknown of review.unknownItems) {
      lines.push(`• "${unknown.sourceText.slice(0, 120)}"`);
    }
  }
  const missing = [...new Set(review.missingFields.map((field) => MISSING_FIELD_LABELS[field.field] || field.field))];
  if (missing.length > 0) {
    lines.push('');
    lines.push(`חסר: ${missing.join(', ')}`);
  }
  lines.push('');
  lines.push('--- השיחה המקורית ---');
  lines.push(conversation.slice(0, 4000));
  return lines.join('\n');
}

function createWhatsAppIntake({
  repository,
  reviewOrderIntake,
  draftOrderReply = null,
  appBaseUrl = 'https://www.batmelech.ae',
  logger = console,
} = {}) {
  if (!repository || typeof repository.loadState !== 'function' || typeof repository.saveState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (typeof reviewOrderIntake !== 'function') {
    throw new TypeError('reviewOrderIntake must be a function');
  }

  async function saveOrder(order) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const current = await repository.loadState();
        const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
        const localState = { ...current.data, orders: [...orders, order] };
        const saved = await repository.saveState({
          baseState: current.data,
          localState,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) return true;
      } catch (error) {
        logger.error('mey whatsapp intake save failed', error);
      }
    }
    return false;
  }

  return {
    async intake(rawText) {
      const conversation = normalizeWhatsAppInput(rawText).slice(0, MAX_CONVERSATION_LENGTH);
      if (conversation === '') {
        return { ok: false, error: 'empty' };
      }

      const current = await repository.loadState();
      const settings = isRecord(current.data.settings) ? current.data.settings : {};
      if (isWritesFrozen(settings)) {
        return { ok: false, error: 'frozen' };
      }
      const { items } = buildIntakeCatalog(current.data);
      if (items.length < 5) {
        return { ok: false, error: 'menu_unavailable' };
      }

      let review;
      try {
        review = await reviewOrderIntake({ message: conversation, catalog: items });
      } catch (error) {
        logger.error('mey whatsapp intake review failed', error);
        return { ok: false, error: 'review_failed' };
      }

      const now = new Date();
      const orderId = `mey-${now.getTime()}-${crypto.randomBytes(4).toString('hex')}`;
      const serviceDate = isoDateFrom(review.draft.serviceDate);
      const timeValue = text(review.draft.serviceTime, 40);
      const location = text(review.draft.deliveryLocation, 300);
      const isPickup = review.draft.fulfillmentMethod === 'pickup';
      const order = {
        id: orderId,
        date: serviceDate || dubaiToday(),
        time: /^([01]?\d|2[0-3]):[0-5]\d$/u.test(timeValue) ? timeValue.padStart(5, '0') : '',
        name: text(review.draft.customerName, 200),
        phone: text(review.draft.customerPhone, 60),
        address: isPickup ? 'איסוף עצמי' : location,
        ...(location && !isPickup ? { place: location } : {}),
        status: 'חדשה',
        source: 'mey-whatsapp',
        notes: buildOrderNotes(review, conversation),
        total: 0,
        payMethod: '',
        paid: 'לא',
        intakeConversation: conversation,
      };

      const saved = await saveOrder(order);
      if (!saved) return { ok: false, error: 'save_failed' };
      // Creations join the same undoable audit stream as every other מיי write.
      await recordOrderCreated(
        repository,
        orderId,
        `יצירת הזמנה מוואטסאפ${order.name ? ` — ${order.name}` : ''}`
      ).catch(() => {});

      let replyDraft = null;
      if (typeof draftOrderReply === 'function') {
        try {
          const missing = [
            ...new Set(review.missingFields.map((field) => MISSING_FIELD_LABELS[field.field] || field.field)),
          ];
          replyDraft = await draftOrderReply({
            conversation,
            summary: {
              lines: summaryLines(review),
              totalUsd: null,
              serviceDate: serviceDate,
              serviceTime: order.time || null,
              deliveryLocation: location || null,
              fulfillment: review.draft.fulfillmentMethod,
            },
            missing,
          });
        } catch (error) {
          logger.error('mey whatsapp intake reply draft failed', error);
          replyDraft = null;
        }
      }

      return {
        ok: true,
        orderId,
        orderUrl: `${appBaseUrl}/admin/orders/${encodeURIComponent(orderId)}/edit`,
        review,
        replyDraft,
      };
    },
  };
}

module.exports = {
  MISSING_FIELD_LABELS,
  buildIntakeCatalog,
  createWhatsAppIntake,
  isoDateFrom,
};
