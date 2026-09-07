'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBriefing, comingFriday } = require('../server/telegram/mey-briefing');

function state() {
  return {
    settings: { orderingOpen: true, out: ['טחינה'], siteBanner: 'סגורים בסוכות', meyNotes: [{ text: 'קטי תמיד רוצה חריף', by: 'לין', date: '2026-09-01' }] },
    menu: { couplePrice: 230, challahPrice: 10, extras: [{ name: 'מארז הבדלה', price: 20 }] },
    customerMeta: { '0501112233': { notes: 'אוהבת לא חריף' } },
    orders: [
      { id: 'a', date: '2026-09-07', name: 'רותי', place: 'Atlantis The Palm', time: '17:00', total: '230', status: 'מוכנה', paid: 'לא', phone: '0501112233' },
      { id: 'b', date: '2026-09-11', name: 'דנה', place: 'Five Palm', time: '', total: '460', status: 'אושרה', paid: 'כן' },
      { id: 'c', date: '2026-09-11', name: 'חן', pickup: true, total: '148', status: 'בוטלה' },
      { id: 'd', date: '2026-08-21', name: 'טוני', total: '148', status: 'נמסרה', paid: 'לא', plataCount: 1, plataStatus: 'awaitingPickup' },
    ],
  };
}

test('the coming Friday is computed from a Dubai date', () => {
  assert.equal(comingFriday('2026-09-07'), '2026-09-11');
  assert.equal(comingFriday('2026-09-11'), '2026-09-11');
  assert.equal(comingFriday('2026-09-12'), '2026-09-18');
});

test('the briefing carries today, the coming Friday, debts, platas, prices and standing notes', () => {
  const briefing = buildBriefing(state(), { today: '2026-09-07' });
  assert.match(briefing, /הזמנות באתר פתוחות/u);
  assert.match(briefing, /באנר באתר: "סגורים בסוכות"/u);
  assert.match(briefing, /אזל מהמלאי: טחינה/u);
  assert.match(briefing, /היום \(2026-09-07\): 1 משלוחים/u);
  assert.match(briefing, /רותי — Atlantis The Palm, 17:00, 230\.00\$ \/ 844\.68 דירהם, מוכנה, לא שולם/u);
  assert.match(briefing, /שישי הקרוב \(2026-09-11\): 1 הזמנות, סה"כ 460\.00\$/u, 'the cancelled order is not counted');
  assert.match(briefing, /דנה — Five Palm, בלי שעה, 460\.00\$ .* שולם/u);
  assert.match(briefing, /חובות פתוחים: 2 לקוחות, סה"כ 378\.00\$/u);
  assert.match(briefing, /פלטות בחוץ: 1 \(טוני\)/u);
  assert.match(briefing, /ארוחה זוגית 230\$ \/ 844\.68 דירהם/u);
  assert.match(briefing, /מארז הבדלה 20\$ \/ 73\.45 דירהם/u);
  assert.match(briefing, /בגט\/חלת שניצל ישראלי: בבגט 25\$ \/ 91\.81 דירהם/u);
  assert.match(briefing, /קטי תמיד רוצה חריף \(לין, 2026-09-01\)/u);
  assert.match(briefing, /הערות אישיות על 1 לקוחות/u);
});

test('an empty business still produces a coherent briefing', () => {
  const briefing = buildBriefing({}, { today: '2026-09-07' });
  assert.match(briefing, /היום \(2026-09-07\): אין משלוחים/u);
  assert.match(briefing, /חובות פתוחים: אין/u);
  assert.match(briefing, /פלטות בחוץ: אין/u);
  assert.match(briefing, /ארוחה זוגית 230\$ \/ 844\.68 דירהם/u, 'default prices when the menu has none');
});

test('debtors in the briefing are ranked by what they owe, not by what they paid', () => {
  const briefing = buildBriefing(
    {
      orders: [
        { id: 'a', date: '2026-08-01', name: 'קטן', total: '100', paid: 'לא', phone: '0501' },
        { id: 'b', date: '2026-08-01', name: 'גדול', total: '900', paid: 'לא', phone: '0502' },
        { id: 'c', date: '2026-08-01', name: 'שילם', total: '500', paid: 'כן', phone: '0503' },
      ],
    },
    { today: '2026-09-07' },
  );
  assert.match(briefing, /הגדולים: גדול 900\.00\$, קטן 100\.00\$/u);
});
