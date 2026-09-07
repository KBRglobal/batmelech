'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMeyTools } = require('../server/telegram/mey-tools');
const { NOTES_KEY, customerMetaFor, rememberNote, undoMeyChange } = require('../server/telegram/mey-audited-actions');

const silentLogger = { error() {} };

function repositoryOf(initial) {
  let data = structuredClone(initial);
  let revision = 1;
  return {
    async loadState() {
      return { data: structuredClone(data), revision, hash: `h${revision}` };
    },
    async saveState({ localState }) {
      data = structuredClone(localState);
      revision += 1;
      return { ok: true };
    },
    current: () => data,
  };
}

function baseState() {
  return {
    settings: {},
    orders: [
      { id: 'o-1', name: 'קטי סוזנה', phone: '054-2016970', date: '2026-08-07', total: '390' },
      { id: 'o-2', name: 'קטי סוזאנה', phone: '0542016970', date: '2026-08-14', total: '380' },
      { id: 'o-3', name: 'טוני בוחבוט', phone: '0508214040', date: '2026-08-21', total: '148' },
      { id: 'o-4', name: 'טוני לוי', phone: '', date: '2026-08-21', total: '100' },
    ],
    customerMeta: { '0542016970': { vip: false, notes: 'אוהבת מרוקאי לא חריף' } },
  };
}

test('a business note is kept forever in settings, signed and dated, and can be undone', async () => {
  const repository = repositoryOf(baseState());
  const result = await rememberNote(repository, { scope: 'business', text: 'בחגים לא עושים תפריט צהריים', by: 'לין' });
  assert.equal(result.ok, true);
  const notes = repository.current().settings[NOTES_KEY];
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'בחגים לא עושים תפריט צהריים');
  assert.equal(notes[0].by, 'לין');
  assert.match(notes[0].date, /^\d{4}-\d{2}-\d{2}$/u);

  const undone = await undoMeyChange(repository);
  assert.equal(undone.ok, true);
  assert.deepEqual(repository.current().settings[NOTES_KEY], []);
});

test('a customer note lands on the same card the panel shows, appended to what Lin already wrote', async () => {
  const repository = repositoryOf(baseState());
  const result = await rememberNote(repository, { scope: 'customer', customerQuery: 'קטי', text: 'תמיד מבקשת חריף בצד', by: 'לין' });
  assert.equal(result.ok, true);
  assert.equal(result.customer, 'קטי סוזנה');
  assert.equal(repository.current().customerMeta['0542016970'].notes, 'אוהבת מרוקאי לא חריף · תמיד מבקשת חריף בצד');
  assert.equal(repository.current().customerMeta['0542016970'].vip, false, 'other fields untouched');

  const read = customerMetaFor(repository.current(), { name: 'קטי סוזנה', phone: '+971 54 201 6970' });
  assert.match(read.notes, /חריף בצד/u);

  await undoMeyChange(repository);
  assert.equal(repository.current().customerMeta['0542016970'].notes, 'אוהבת מרוקאי לא חריף');
});

test('an ambiguous customer is refused with the candidates, nothing is written', async () => {
  const repository = repositoryOf(baseState());
  const result = await rememberNote(repository, { scope: 'customer', customerQuery: 'טוני', text: 'משהו', by: 'לין' });
  assert.equal(result.ok, false);
  assert.match(result.error, /טוני בוחבוט/u);
  assert.match(result.error, /טוני לוי/u);
  assert.equal(repository.current().customerMeta['0508214040'], undefined);
});

test('the remember_note tool is exposed, honours the freeze, and signs with the sender', async () => {
  const state = baseState();
  const repository = repositoryOf(state);
  const mey = createMeyTools({ repository, logger: silentLogger });
  assert.ok(mey.definitions.some((definition) => definition.name === 'remember_note'));

  const saved = await mey.execute('remember_note', { scope: 'business', customerQuery: null, text: 'פליקס לא עובד בשבת' }, { sender: 'F @balmin55' });
  assert.equal(saved.ok, true);
  assert.equal(repository.current().settings[NOTES_KEY][0].by, 'F @balmin55');

  const frozen = repositoryOf({ ...baseState(), settings: { meyWritesFrozen: true } });
  const blocked = await createMeyTools({ repository: frozen, logger: silentLogger }).execute('remember_note', { scope: 'business', customerQuery: null, text: 'x' });
  assert.match(blocked.error, /הקפאה/u);
});
