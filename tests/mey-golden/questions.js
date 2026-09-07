'use strict';

// The golden set: real questions from the staff chat, asked against a real
// state snapshot, with expectations computed FROM THAT SNAPSHOT so the set
// never rots when the data changes. Run with scripts/mey-eval.js. Each check
// returns true when the reply is right, or a short string saying what is wrong.

const { customerLedger, financialSummary, orderMoney, ordersOf } = require('../../server/domain/business-queries');
const { aedLabel, usdLabel } = require('../../server/domain/money-labels');
const { comingFriday } = require('../../server/telegram/mey-briefing');

const LIN = { firstName: 'Lin' };
const FELIX = { firstName: 'F', username: 'balmin55' };
const BOSS = { firstName: 'Mr Quackson', username: 'k3rgl0bal' };

function has(reply, ...needles) {
  const missing = needles.filter((needle) => !reply.includes(needle));
  return missing.length === 0 ? true : `missing: ${missing.join(' | ')}`;
}

function lacks(reply, ...needles) {
  const present = needles.filter((needle) => reply.includes(needle));
  return present.length === 0 ? true : `should not say: ${present.join(' | ')}`;
}

function isoDaysFrom(today, days) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ordersOn(state, day) {
  return ordersOf(state).filter((order) => order.date === day && order.status !== 'בוטלה');
}

function usd(minor) {
  return `${usdLabel(minor)}$`;
}

/** Picks concrete diners/orders from the snapshot and builds the question list. */
function buildQuestions(state, { today }) {
  const orders = ordersOf(state);
  const byTotalDesc = [...orders].filter((o) => orderMoney(o).totalMinorUnits !== null && o.status !== 'בוטלה').sort((a, b) => orderMoney(b).totalMinorUnits - orderMoney(a).totalMinorUnits);
  const ledger = customerLedger(state);
  const debtors = ledger.filter((c) => c.outstandingMinorUnits > 0).sort((a, b) => b.outstandingMinorUnits - a.outstandingMinorUnits);
  const friday = comingFriday(today);
  const tomorrow = isoDaysFrom(today, 1);
  const fridayOrders = ordersOn(state, friday);
  const tomorrowOrders = ordersOn(state, tomorrow);
  const lastServiceDay = [...new Set(orders.map((o) => o.date).filter((d) => d && d < today))].sort().at(-1);
  const lastDayOrders = lastServiceDay ? ordersOn(state, lastServiceDay) : [];
  const lastDaySummary = lastServiceDay ? financialSummary(state, { fromDate: lastServiceDay, toDate: lastServiceDay }) : null;

  // a diner with exactly one non-cancelled order and a unique first name
  const singles = ledger.filter((c) => c.orderCount === 1 && c.name);
  const uniqueFirst = singles.find((c) => {
    const first = c.name.split(' ')[0];
    return ledger.filter((other) => other.name && other.name.split(' ')[0] === first).length === 1;
  });
  const single = uniqueFirst ? orders.find((o) => o.id === uniqueFirst.orderIds[0]) : null;
  const singleMoney = single ? orderMoney(single) : null;
  const singleFirst = uniqueFirst ? uniqueFirst.name.split(' ')[0] : null;

  const biggest = byTotalDesc[0];
  const topDebtor = debtors[0];
  const topBilled = [...ledger].sort((a, b) => b.totalBilledMinorUnits - a.totalBilledMinorUnits)[0];

  const questions = [];

  if (single) {
    questions.push(
      { id: 'order-total-usd', ask: `כמה יצא ל${singleFirst}?`, sender: LIN, check: (r) => has(r, usd(singleMoney.totalMinorUnits)) },
      { id: 'order-total-aed', ask: `כמה יצא ל${singleFirst} בדירהם?`, sender: LIN, check: (r) => has(r, aedLabel(singleMoney.totalMinorUnits)) },
      {
        id: 'paid-vs-total',
        ask: `כמה ${singleFirst} שילם/ה לי בפועל?`,
        sender: LIN,
        check: (r) => has(r, usd(singleMoney.collectedMinorUnits ?? 0)),
      },
      {
        id: 'order-dishes',
        ask: `מה ${singleFirst} הזמין/ה?`,
        sender: LIN,
        check: (r) => {
          const names = Object.keys({ ...(single.salads || {}), ...(single.mains || {}), ...(single.firsts || {}), ...(single.extras || {}) }).slice(0, 2);
          return names.length === 0 ? true : has(r, ...names);
        },
      },
      {
        id: 'why-this-price',
        ask: `למה ל${singleFirst} יצא ${usdLabel(singleMoney.totalMinorUnits).replace(/\.00$/u, '')} דולר? תפרטי`,
        sender: LIN,
        check: (r) => (single.pickup !== true ? has(r, 'משלוח') : true),
      },
      {
        id: 'order-hotel',
        ask: `לאן המשלוח של ${singleFirst}?`,
        sender: FELIX,
        check: (r) => (single.pickup === true ? has(r, 'איסוף') : has(r, (single.hotelName || single.place || single.address || '').split(' ')[0])),
      },
    );
  }

  questions.push(
    {
      id: 'tomorrow-deliveries',
      ask: 'מיי מחר איפה כל המשלוחים שלי ?',
      sender: FELIX,
      check: (r) => (tomorrowOrders.length === 0 ? has(r, 'אין') : has(r, ...tomorrowOrders.slice(0, 3).map((o) => o.name.split(' ')[0]))),
    },
    {
      id: 'friday-count',
      ask: 'כמה הזמנות יש לשישי הקרוב?',
      sender: LIN,
      check: (r) => (fridayOrders.length === 0 ? (/אין|0 הזמנות|אפס/u.test(r) ? true : 'should say none') : has(r, String(fridayOrders.length))),
    },
    {
      id: 'friday-total',
      ask: 'כמה כסף יוצא לי בשישי הקרוב סה"כ?',
      sender: LIN,
      check: (r) => {
        if (fridayOrders.length === 0) return /אין|0 הזמנות|0\.00\$|אפס/u.test(r) ? true : 'should say none';
        const billed = fridayOrders.reduce((s, o) => s + (orderMoney(o).totalMinorUnits ?? 0), 0);
        return has(r, usdLabel(billed));
      },
    },
    {
      id: 'who-owes',
      ask: 'מי חייב לי כסף?',
      sender: LIN,
      check: (r) => (topDebtor ? has(r, topDebtor.name.split(' ')[0], usdLabel(topDebtor.outstandingMinorUnits)) : has(r, 'אין')),
    },
    {
      id: 'biggest-order',
      ask: 'מה ההזמנה הכי גדולה שהייתה לי אי פעם?',
      sender: LIN,
      check: (r) => (biggest ? has(r, biggest.name.split(' ')[0], usdLabel(orderMoney(biggest).totalMinorUnits)) : true),
    },
    {
      id: 'top-customer-billed',
      ask: 'מי הלקוח שהזמין בהכי הרבה כסף אי פעם?',
      sender: BOSS,
      check: (r) => (topBilled ? (has(r, topBilled.name.split(' ')[0], usdLabel(topBilled.totalBilledMinorUnits)) === true ? lacks(r, 'הוכחה', 'לא ניתן לאמת') : has(r, topBilled.name.split(' ')[0], usdLabel(topBilled.totalBilledMinorUnits))) : true),
    },
    {
      id: 'last-service-income',
      ask: 'כמה נכנס לי בפועל ביום המשלוחים האחרון?',
      sender: LIN,
      check: (r) => (lastDaySummary ? has(r, usdLabel(lastDaySummary.collectedMinorUnits)) : true),
    },
    {
      id: 'last-service-count',
      ask: 'כמה הזמנות היו ביום המשלוחים האחרון?',
      sender: LIN,
      check: (r) => (lastServiceDay ? has(r, String(lastDayOrders.length)) : true),
    },
    { id: 'couple-price', ask: 'כמה עולה ארוחה זוגית?', sender: LIN, check: (r) => has(r, String((state.menu && state.menu.couplePrice) || 230)) },
    { id: 'delivery-fee', ask: 'כמה עולה משלוח לאבו דאבי?', sender: LIN, check: (r) => has(r, '55') },
    { id: 'delivery-fee-dubai', ask: 'ומשלוח בדובאי?', sender: LIN, check: (r) => has(r, '15') },
    { id: 'ordering-open', ask: 'האתר פתוח להזמנות עכשיו?', sender: LIN, check: (r) => /פתוח|סגור/u.test(r) || 'no open/closed answer' },
    {
      id: 'out-of-stock',
      ask: 'מה אזל מהמלאי כרגע?',
      sender: LIN,
      check: (r) => {
        const out = (state.settings && state.settings.out) || [];
        return out.length === 0 ? (/אין|שום|כלום|לא/u.test(r) ? true : 'should say nothing is out') : has(r, out[0]);
      },
    },
    { id: 'gluten', ask: 'לקוחה שואלת אם יש גלוטן במטבוחה, מה עונים לה?', sender: LIN, check: (r) => has(r, 'מטבוחה') },
    { id: 'whats-included', ask: 'מה כלול בארוחה זוגית? כמה דגים?', sender: LIN, check: (r) => has(r, '2') },
    { id: 'delivered-unknown', ask: 'אני מודיע לך שפליקס מסר', sender: LIN, check: (r) => (/למי|איזה|מי |שם הלקוח|\?/u.test(r) ? true : 'should ask which delivery') },
    { id: 'no-invented-customer', ask: 'כמה יצא לזבולון פרנקנשטיין?', sender: LIN, check: (r) => (/לא מצאתי|אין|לא נמצא/u.test(r) ? lacks(r, '$') : 'should say not found') },
    { id: 'no-invented-date', ask: 'כמה משלוחים היו ב-2031-01-01?', sender: BOSS, check: (r) => (/אין|0|לא/u.test(r) ? true : 'should say none') },
    {
      id: 'remember-business',
      ask: 'תזכרי שבחגים אנחנו לא עושים תפריט צהריים',
      sender: LIN,
      check: (r, ctx) => (ctx.toolCalls.some((c) => c.tool === 'remember_note') ? true : 'remember_note not called'),
    },
    {
      id: 'recall-business',
      ask: 'עושים צהריים בחגים?',
      sender: LIN,
      check: (r) => (/לא/u.test(r) ? true : 'should recall the standing note'),
    },
    { id: 'currency-both', ask: single ? `כמה יצא ל${singleFirst}, גם בדולר וגם בדירהם` : 'כמה עולה ארוחה זוגית בדירהם?', sender: LIN, check: (r) => has(r, 'דירהם', '$') },
    { id: 'aggregate-by-hotel', ask: 'תאגדי לי את ההזמנות של שישי הקרוב לפי מלון', sender: FELIX, check: (r) => (fridayOrders.length === 0 ? has(r, 'אין') : true) },
    { id: 'plata', ask: 'יש פלטות בחוץ?', sender: FELIX, check: (r) => {
      const open = orders.filter((o) => Number(o.plataCount) > 0 && o.plataStatus !== 'depositReturned');
      return open.length === 0 ? (/אין|לא/u.test(r) ? true : 'should say none') : has(r, open[0].name.split(' ')[0]);
    } },
    {
      id: 'ambiguous-best-customer',
      ask: 'מי הלקוח הכי טוב שלי?',
      sender: LIN,
      check: (r) => (/\?/u.test(r) && /כסף|סכום|פעמים|הזמנות/u.test(r) ? lacks(r, '$') : 'should ask money vs. frequency before answering'),
    },
    {
      id: 'ambiguous-name',
      ask: 'כמה יצא לקובי?',
      sender: LIN,
      check: (r) => {
        const kobis = ledger.filter((c) => c.name && c.name.startsWith('קובי'));
        const kobiOrders = orders.filter((o) => typeof o.name === 'string' && o.name.startsWith('קובי') && o.status !== 'בוטלה');
        if (kobiOrders.length <= 1) return true;
        return /\?/u.test(r) || kobiOrders.every((o) => r.includes(usdLabel(orderMoney(o).totalMinorUnits))) ? true : `several orders for קובי (${kobis.length} diners, ${kobiOrders.length} orders) — should ask which, or list all`;
      },
    },
    { id: 'small-talk', ask: 'בוקר טוב מיי', sender: LIN, check: (r) => (r.length < 300 ? true : 'too long for small talk') },
  );

  return questions;
}

module.exports = { buildQuestions };
