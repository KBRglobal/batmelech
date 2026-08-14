'use strict';

// Small, bounded set of state mutations any trusted caller (admin UI, the
// Telegram assistant) can perform without going through the full versioned
// /api/state client flow. Each function loads-mutates-saves with retry,
// mirroring the pattern in site-order-route.js. Deliberately narrow: this is
// NOT a general state-write API — it only knows how to flip these specific
// fields under settings.

const crypto = require('node:crypto');

const MAX_ATTEMPTS = 5;

async function withSettingsUpdate(repository, mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
    const nextSettings = mutate(settings);
    const localState = { ...current.data, settings: nextSettings };
    const saved = await repository.saveState({
      baseState: current.data,
      localState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false };
}

async function setOrderingOpen(repository, open) {
  return withSettingsUpdate(repository, (settings) => ({ ...settings, orderingOpen: Boolean(open) }));
}

async function setSiteBanner(repository, message) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  return withSettingsUpdate(repository, (settings) => ({ ...settings, siteBanner: trimmed === '' ? null : trimmed }));
}

async function setItemStock(repository, itemName, inStock) {
  const name = typeof itemName === 'string' ? itemName.trim() : '';
  if (name === '') throw new RangeError('item name required');
  return withSettingsUpdate(repository, (settings) => {
    const current = Array.isArray(settings.out) ? settings.out.filter((value) => typeof value === 'string') : [];
    const withoutName = current.filter((existing) => existing !== name);
    const next = inStock ? withoutName : [...withoutName, name];
    return { ...settings, out: next };
  });
}

module.exports = { setOrderingOpen, setSiteBanner, setItemStock };
