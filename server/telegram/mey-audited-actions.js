'use strict';

// מיי's widened write surface (Moshe, 2026-08-18: "שליטה כמעט על הכל", paired
// with an undo for every change and an emergency freeze). Three guarantees:
//
// 1. AUDIT — every write appends an entry to settings.meyAuditLog with a
//    Hebrew summary and the exact previous value, capped at MAX_AUDIT_ENTRIES.
// 2. UNDO — undoLastMeyChange / undoMeyChange revert any entry from its
//    stored snapshot: replaced orders are restored, created orders removed,
//    deleted orders re-added, menu/settings subsets put back.
// 3. FREEZE — settings.meyWritesFrozen blocks every write tool. Anyone in
//    the staff chat can freeze (code word / freeze tool); UNfreezing is
//    panel-only, so a compromised chat cannot lift its own freeze.
//
// Everything lives inside the bm_state JSON blob — zero migration — and the
// full bm_state_versions history remains the deep safety net underneath.

const crypto = require('node:crypto');
const { KNOWN_ORDER_STATUSES } = require('../business-actions');

const MAX_ATTEMPTS = 5;
const MAX_AUDIT_ENTRIES = 30;
const AUDIT_LOG_KEY = 'meyAuditLog';
const FROZEN_KEY = 'meyWritesFrozen';

const MENU_CATEGORY_KEYS = ['salads', 'firsts', 'mains', 'sides', 'desserts'];

// Fields מיי may edit on an order, with their validators. Deliberately a
// closed list: internal bookkeeping (mey*/courier*/deliveryProof*/intake*)
// stays out of reach.
const ORDER_FIELD_VALIDATORS = {
  name: (value) => typeof value === 'string' && value.trim().length >= 1 && value.length <= 200,
  phone: (value) => typeof value === 'string' && value.length <= 60,
  email: (value) => typeof value === 'string' && value.length <= 200,
  address: (value) => typeof value === 'string' && value.length <= 1000,
  place: (value) => typeof value === 'string' && value.length <= 300,
  date: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value),
  time: (value) => typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/u.test(value)),
  notes: (value) => typeof value === 'string' && value.length <= 8000,
  group: (value) => typeof value === 'string' && value.length <= 200,
  total: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000,
  deposit: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000,
  payMethod: (value) => typeof value === 'string' && value.length <= 100,
  paid: (value) => value === 'כן' || value === 'לא',
  status: (value) => KNOWN_ORDER_STATUSES.includes(value),
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settingsOf(state) {
  return isRecord(state.settings) ? state.settings : {};
}

function auditLogOf(settings) {
  return Array.isArray(settings[AUDIT_LOG_KEY]) ? settings[AUDIT_LOG_KEY] : [];
}

function isWritesFrozen(settings) {
  return settings[FROZEN_KEY] === true;
}

function appendAudit(settings, entry) {
  const log = [...auditLogOf(settings), entry].slice(-MAX_AUDIT_ENTRIES);
  return { ...settings, [AUDIT_LOG_KEY]: log };
}

function newAuditEntry(tool, summary, undo) {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    at: Date.now(),
    tool,
    summary,
    undo,
    undone: false,
  };
}

// One retry loop for every audited mutation. mutate(state) returns
// { state, entry } (entry may be null to skip audit) or an { error }.
async function withAuditedState(repository, mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    if (isWritesFrozen(settingsOf(current.data))) {
      return { ok: false, error: 'מיי מוקפאת כרגע — שחרור רק מהפאנל (הגדרות)' };
    }
    const outcome = mutate(current.data);
    if (outcome.error) return { ok: false, error: outcome.error };
    let nextState = outcome.state;
    if (outcome.entry) {
      nextState = { ...nextState, settings: appendAudit(settingsOf(nextState), outcome.entry) };
    }
    const saved = await repository.saveState({
      baseState: current.data,
      localState: nextState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true, ...outcome.result };
  }
  return { ok: false, error: 'save failed after retries' };
}

function findOrder(state, orderId) {
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const index = orders.findIndex((order) => String(order.id) === id);
  return { id, orders, index, order: index >= 0 ? orders[index] : null };
}

async function updateOrderDetails(repository, orderId, fields) {
  if (!isRecord(fields) || Object.keys(fields).length === 0) {
    return { ok: false, error: 'no fields to update' };
  }
  for (const [field, value] of Object.entries(fields)) {
    const validator = ORDER_FIELD_VALIDATORS[field];
    if (!validator) return { ok: false, error: `field not editable: ${field}` };
    if (!validator(value)) return { ok: false, error: `invalid value for ${field}` };
  }
  return withAuditedState(repository, (state) => {
    const { orders, index, order } = findOrder(state, orderId);
    if (!order) return { error: 'order not found' };
    const next = { ...order, ...fields };
    if (fields.status === 'נמסרה' && !next.deliveredAt) next.deliveredAt = Date.now();
    const changed = Object.keys(fields).join(', ');
    const entry = newAuditEntry(
      'update_order_details',
      `עדכון הזמנה של ${order.name || order.id}: ${changed}`,
      { kind: 'order-replace', orderId: String(order.id), previous: structuredClone(order) }
    );
    return {
      state: { ...state, orders: orders.map((row, i) => (i === index ? next : row)) },
      entry,
      result: { order: next },
    };
  });
}

async function deleteOrder(repository, orderId) {
  return withAuditedState(repository, (state) => {
    const { orders, index, order } = findOrder(state, orderId);
    if (!order) return { error: 'order not found' };
    const entry = newAuditEntry(
      'delete_order',
      `מחיקת הזמנה של ${order.name || order.id} (${order.date || 'ללא תאריך'})`,
      { kind: 'order-deleted', orderId: String(order.id), previous: structuredClone(order) }
    );
    return {
      state: { ...state, orders: orders.filter((_row, i) => i !== index) },
      entry,
      result: { deleted: { id: order.id, name: order.name || null } },
    };
  });
}

// Records creations (e.g. the WhatsApp intake) in the same audit stream so
// they are undoable like everything else.
async function recordOrderCreated(repository, orderId, summary) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = settingsOf(current.data);
    const entry = newAuditEntry('create_order', summary, {
      kind: 'order-created',
      orderId: String(orderId),
    });
    const saved = await repository.saveState({
      baseState: current.data,
      localState: { ...current.data, settings: appendAudit(settings, entry) },
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false };
}

function menuOf(state) {
  return isRecord(state.menu) ? state.menu : {};
}

function categoryKeyFor(category) {
  return MENU_CATEGORY_KEYS.includes(category) ? category : null;
}

async function editMenuItem(repository, { op, category, name, newName } = {}) {
  const key = categoryKeyFor(category);
  if (!key) return { ok: false, error: `category must be one of: ${MENU_CATEGORY_KEYS.join(', ')}` };
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName === '') return { ok: false, error: 'item name required' };
  const cleanNewName = typeof newName === 'string' ? newName.trim() : '';
  if (op === 'rename' && cleanNewName === '') return { ok: false, error: 'new name required' };
  if (!['add', 'remove', 'rename'].includes(op)) return { ok: false, error: 'op must be add, remove or rename' };

  return withAuditedState(repository, (state) => {
    const menu = menuOf(state);
    const names = Array.isArray(menu[key]) ? menu[key].filter((value) => typeof value === 'string') : [];
    const exists = names.includes(cleanName);
    if (op === 'add' && exists) return { error: 'item already exists' };
    if (op !== 'add' && !exists) return { error: 'item not found in this category' };

    let nextNames;
    if (op === 'add') nextNames = [...names, cleanName];
    else if (op === 'remove') nextNames = names.filter((value) => value !== cleanName);
    else nextNames = names.map((value) => (value === cleanName ? cleanNewName : value));

    const nextMenu = { ...menu, [key]: nextNames };
    // Keep the photo/description mapping attached through a rename.
    if (op === 'rename' && isRecord(menu.itemIds) && isRecord(menu.itemIds[key]) && menu.itemIds[key][cleanName]) {
      const ids = { ...menu.itemIds[key] };
      ids[cleanNewName] = ids[cleanName];
      delete ids[cleanName];
      nextMenu.itemIds = { ...menu.itemIds, [key]: ids };
    }

    let nextSettings = settingsOf(state);
    const out = Array.isArray(nextSettings.out) ? nextSettings.out.filter((value) => typeof value === 'string') : [];
    if ((op === 'remove' || op === 'rename') && out.includes(cleanName)) {
      const nextOut = out.filter((value) => value !== cleanName);
      if (op === 'rename') nextOut.push(cleanNewName);
      nextSettings = { ...nextSettings, out: nextOut };
    }

    const labels = { add: 'הוספת', remove: 'הסרת', rename: 'שינוי שם' };
    const entry = newAuditEntry(
      'edit_menu_item',
      op === 'rename'
        ? `שינוי שם מנה: "${cleanName}" ← "${cleanNewName}"`
        : `${labels[op]} מנה בתפריט: "${cleanName}"`,
      {
        kind: 'menu-category-replace',
        category: key,
        previousNames: structuredClone(names),
        previousItemIds: isRecord(menu.itemIds) && isRecord(menu.itemIds[key]) ? structuredClone(menu.itemIds[key]) : null,
        previousOut: structuredClone(out),
      }
    );
    return {
      state: { ...state, menu: nextMenu, settings: nextSettings },
      entry,
      result: { category: key, items: nextNames },
    };
  });
}

async function setExtraPrice(repository, { name, priceUsd } = {}) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName === '') return { ok: false, error: 'extra name required' };
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 1_000_000) {
    return { ok: false, error: 'invalid price' };
  }
  return withAuditedState(repository, (state) => {
    const menu = menuOf(state);
    const extras = Array.isArray(menu.extras) ? menu.extras : [];
    const index = extras.findIndex((row) => isRecord(row) && row.name === cleanName);
    if (index < 0) return { error: 'extra not found' };
    const previous = extras[index];
    const nextExtras = extras.map((row, i) => (i === index ? { ...row, price: priceUsd } : row));
    const entry = newAuditEntry(
      'set_extra_price',
      `עדכון מחיר "${cleanName}": ${previous.price ?? '—'} ← ${priceUsd} דולר`,
      { kind: 'menu-extras-replace', previousExtras: structuredClone(extras) }
    );
    return {
      state: { ...state, menu: { ...menu, extras: nextExtras } },
      entry,
      result: { name: cleanName, priceUsd },
    };
  });
}

async function setBasePrices(repository, { couplePriceUsd, challahPriceUsd } = {}) {
  const updates = {};
  for (const [field, value] of [['couplePrice', couplePriceUsd], ['challahPrice', challahPriceUsd]]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      return { ok: false, error: `invalid ${field}` };
    }
    updates[field] = value;
  }
  if (Object.keys(updates).length === 0) return { ok: false, error: 'no prices given' };
  return withAuditedState(repository, (state) => {
    const menu = menuOf(state);
    const entry = newAuditEntry(
      'set_base_prices',
      `עדכון מחירי בסיס: ${Object.entries(updates).map(([k, v]) => `${k === 'couplePrice' ? 'ארוחה זוגית' : 'חלה'} ${v}$`).join(', ')}`,
      {
        kind: 'menu-base-prices-replace',
        previousCouplePrice: menu.couplePrice ?? null,
        previousChallahPrice: menu.challahPrice ?? null,
      }
    );
    return {
      state: { ...state, menu: { ...menu, ...updates } },
      entry,
      result: { updated: updates },
    };
  });
}

// Freeze is writable even by "anyone" in the chat, on purpose: stopping מיי
// must always work. It bypasses the frozen check (it IS the frozen switch).
async function freezeWrites(repository) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = settingsOf(current.data);
    if (isWritesFrozen(settings)) return { ok: true, alreadyFrozen: true };
    const entry = newAuditEntry('freeze_writes', 'הקפאת חירום — כל הכתיבות של מיי נעצרו', { kind: 'freeze' });
    const saved = await repository.saveState({
      baseState: current.data,
      localState: {
        ...current.data,
        settings: appendAudit({ ...settings, [FROZEN_KEY]: true }, entry),
      },
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true, alreadyFrozen: false };
  }
  return { ok: false, error: 'save failed after retries' };
}

// Panel-only: called from the admin settings API, never exposed as a tool.
async function unfreezeWrites(repository) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = settingsOf(current.data);
    if (!isWritesFrozen(settings)) return { ok: true };
    const next = { ...settings };
    delete next[FROZEN_KEY];
    const saved = await repository.saveState({
      baseState: current.data,
      localState: { ...current.data, settings: next },
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false, error: 'save failed after retries' };
}

// ---- Standing memory -------------------------------------------------------
// What people tell מיי to remember, kept forever in state (not in the 48-hour
// chat memory): business-wide notes in settings.meyNotes, per-diner notes in
// customerMeta — the same record the panel's customers screen shows, keyed the
// way the panel keys it (raw phone digits, else "שם:<name>").

const NOTES_KEY = 'meyNotes';
const MAX_NOTES = 200;
const MAX_NOTE_CHARS = 400;

function customerMetaKey(order) {
  const digits = typeof order.phone === 'string' ? order.phone.replace(/\D/gu, '') : '';
  if (digits !== '') return digits;
  const name = typeof order.name === 'string' ? order.name.trim() : '';
  return name === '' ? null : `שם:${name}`;
}

/** Every customerMeta key the panel might have used for this order's diner. */
function customerMetaCandidates(order) {
  const keys = [];
  const digits = typeof order.phone === 'string' ? order.phone.replace(/\D/gu, '') : '';
  if (digits !== '') {
    // "0542016970" and "+971 54 201 6970" are one phone; the panel may have
    // keyed the card by either spelling.
    const local = digits.startsWith('971') ? `0${digits.slice(3)}` : digits;
    const international = local.startsWith('0') ? `971${local.slice(1)}` : local;
    keys.push(digits, local, international, `phone:${international}`);
  }
  const name = typeof order.name === 'string' ? order.name.trim() : '';
  if (name !== '') keys.push(`שם:${name}`);
  return [...new Set(keys)];
}

function customerMetaFor(state, order) {
  const meta = isRecord(state.customerMeta) ? state.customerMeta : {};
  const found = { vip: false, notes: '' };
  for (const key of customerMetaCandidates(order)) {
    const record = meta[key];
    if (!isRecord(record)) continue;
    if (record.vip === true) found.vip = true;
    const notes = typeof record.notes === 'string' ? record.notes.trim() : '';
    if (notes !== '' && !found.notes.includes(notes)) found.notes = found.notes === '' ? notes : `${found.notes} · ${notes}`;
  }
  return found;
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function rememberNote(repository, { scope, text, by, customerQuery } = {}) {
  const note = typeof text === 'string' ? text.trim().replace(/\s+/gu, ' ') : '';
  if (note === '' || note.length > MAX_NOTE_CHARS) return { ok: false, error: `ההערה חייבת להיות בין תו אחד ל-${MAX_NOTE_CHARS} תווים` };
  const author = typeof by === 'string' && by.trim() !== '' ? by.trim() : 'לא ידוע';
  if (scope === 'business') {
    return withAuditedState(repository, (state) => {
      const settings = settingsOf(state);
      const previous = Array.isArray(settings[NOTES_KEY]) ? settings[NOTES_KEY] : [];
      const record = { id: crypto.randomBytes(4).toString('hex'), text: note, by: author, date: todayIso(), at: Date.now() };
      const next = [...previous, record].slice(-MAX_NOTES);
      const entry = newAuditEntry('remember_note', `זיכרון קבוע: ${note}`, { kind: 'notes-replace', previous });
      return { state: { ...state, settings: { ...settings, [NOTES_KEY]: next } }, entry, result: { note: record, count: next.length } };
    });
  }
  if (scope === 'customer') {
    const query = typeof customerQuery === 'string' ? customerQuery.trim().toLowerCase() : '';
    if (query === '') return { ok: false, error: 'צריך שם או טלפון של הלקוח/ה' };
    return withAuditedState(repository, (state) => {
      const orders = Array.isArray(state.orders) ? state.orders.filter(isRecord) : [];
      const digits = query.replace(/\D/gu, '');
      const matches = orders.filter((order) => {
        const name = typeof order.name === 'string' ? order.name.trim().toLowerCase() : '';
        const phone = typeof order.phone === 'string' ? order.phone.replace(/\D/gu, '') : '';
        return (digits.length >= 4 && phone.includes(digits)) || (name !== '' && name.includes(query));
      });
      const keys = [...new Set(matches.map(customerMetaKey).filter(Boolean))];
      if (keys.length === 0) return { error: `לא מצאתי לקוח/ה שמתאים ל"${customerQuery}"` };
      if (keys.length > 1) {
        const names = [...new Set(matches.map((order) => order.name).filter(Boolean))];
        return { error: `יש כמה לקוחות שמתאימים ל"${customerQuery}": ${names.join(', ')} — תדייקי בשם או בטלפון` };
      }
      const key = keys[0];
      const meta = isRecord(state.customerMeta) ? state.customerMeta : {};
      const previous = isRecord(meta[key]) ? meta[key] : null;
      const existing = previous && typeof previous.notes === 'string' ? previous.notes.trim() : '';
      const nextNotes = existing === '' ? note : `${existing} · ${note}`;
      const record = { ...(previous || {}), notes: nextNotes };
      const customerName = matches[0].name || key;
      const entry = newAuditEntry('remember_note', `הערה על ${customerName}: ${note}`, { kind: 'customer-meta-replace', key, previous });
      return {
        state: { ...state, customerMeta: { ...meta, [key]: record } },
        entry,
        result: { customer: customerName, notes: nextNotes },
      };
    });
  }
  return { ok: false, error: 'scope חייב להיות business או customer' };
}

function applyUndo(state, entry) {
  const undo = entry.undo || {};
  if (undo.kind === 'notes-replace') {
    const settings = settingsOf(state);
    return { state: { ...state, settings: { ...settings, [NOTES_KEY]: Array.isArray(undo.previous) ? undo.previous : [] } } };
  }
  if (undo.kind === 'customer-meta-replace') {
    const meta = isRecord(state.customerMeta) ? { ...state.customerMeta } : {};
    if (undo.previous === null || undo.previous === undefined) delete meta[undo.key];
    else meta[undo.key] = undo.previous;
    return { state: { ...state, customerMeta: meta } };
  }
  if (undo.kind === 'order-replace' || undo.kind === 'order-deleted') {
    const orders = Array.isArray(state.orders) ? state.orders : [];
    const index = orders.findIndex((order) => String(order.id) === undo.orderId);
    if (undo.kind === 'order-deleted') {
      if (index >= 0) return { error: 'ההזמנה כבר קיימת — אין מה לשחזר' };
      return { state: { ...state, orders: [...orders, undo.previous] } };
    }
    if (index < 0) return { error: 'ההזמנה כבר לא קיימת — אי אפשר להחזיר את השינוי' };
    return { state: { ...state, orders: orders.map((row, i) => (i === index ? undo.previous : row)) } };
  }
  if (undo.kind === 'order-created') {
    const orders = Array.isArray(state.orders) ? state.orders : [];
    const index = orders.findIndex((order) => String(order.id) === undo.orderId);
    if (index < 0) return { error: 'ההזמנה כבר נמחקה' };
    return { state: { ...state, orders: orders.filter((_row, i) => i !== index) } };
  }
  if (undo.kind === 'menu-category-replace') {
    const menu = menuOf(state);
    const nextMenu = { ...menu, [undo.category]: undo.previousNames };
    if (undo.previousItemIds) {
      nextMenu.itemIds = { ...(isRecord(menu.itemIds) ? menu.itemIds : {}), [undo.category]: undo.previousItemIds };
    }
    const settings = settingsOf(state);
    const nextSettings = Array.isArray(undo.previousOut) ? { ...settings, out: undo.previousOut } : settings;
    return { state: { ...state, menu: nextMenu, settings: nextSettings } };
  }
  if (undo.kind === 'menu-extras-replace') {
    const menu = menuOf(state);
    return { state: { ...state, menu: { ...menu, extras: undo.previousExtras } } };
  }
  if (undo.kind === 'menu-base-prices-replace') {
    const menu = menuOf(state);
    const nextMenu = { ...menu };
    if (undo.previousCouplePrice === null) delete nextMenu.couplePrice;
    else nextMenu.couplePrice = undo.previousCouplePrice;
    if (undo.previousChallahPrice === null) delete nextMenu.challahPrice;
    else nextMenu.challahPrice = undo.previousChallahPrice;
    return { state: { ...state, menu: nextMenu } };
  }
  return { error: 'אי אפשר לבטל את הפעולה הזאת' };
}

// entryId undefined -> the most recent not-yet-undone entry. Undo itself is
// allowed while frozen (reverting damage must always work), so it uses its
// own load-save loop rather than withAuditedState.
async function undoMeyChange(repository, entryId) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = settingsOf(current.data);
    const log = auditLogOf(settings);
    const candidates = log.filter((entry) => !entry.undone && entry.undo && entry.undo.kind !== 'freeze');
    const target = entryId
      ? candidates.find((entry) => entry.id === entryId)
      : candidates[candidates.length - 1];
    if (!target) return { ok: false, error: entryId ? 'הפעולה לא נמצאה או כבר בוטלה' : 'אין פעולה לביטול' };

    const applied = applyUndo(current.data, target);
    if (applied.error) return { ok: false, error: applied.error };

    const nextLog = log.map((entry) => (entry.id === target.id ? { ...entry, undone: true, undoneAt: Date.now() } : entry));
    const nextState = {
      ...applied.state,
      settings: { ...settingsOf(applied.state), [AUDIT_LOG_KEY]: nextLog },
    };
    const saved = await repository.saveState({
      baseState: current.data,
      localState: nextState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true, undone: { id: target.id, summary: target.summary } };
  }
  return { ok: false, error: 'save failed after retries' };
}

async function readAuditLog(repository) {
  const current = await repository.loadState();
  const settings = settingsOf(current.data);
  return {
    frozen: isWritesFrozen(settings),
    entries: auditLogOf(settings)
      .slice()
      .reverse()
      .map((entry) => ({
        id: entry.id,
        at: entry.at,
        tool: entry.tool,
        summary: entry.summary,
        undone: entry.undone === true,
        undoable: Boolean(entry.undo) && entry.undo.kind !== 'freeze' && entry.undone !== true,
      })),
  };
}

module.exports = {
  AUDIT_LOG_KEY,
  FROZEN_KEY,
  MAX_AUDIT_ENTRIES,
  NOTES_KEY,
  ORDER_FIELD_VALIDATORS,
  customerMetaFor,
  deleteOrder,
  rememberNote,
  editMenuItem,
  freezeWrites,
  isWritesFrozen,
  readAuditLog,
  recordOrderCreated,
  setBasePrices,
  setExtraPrice,
  undoMeyChange,
  unfreezeWrites,
  updateOrderDetails,
};
