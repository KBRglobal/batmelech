'use strict';

// מיי's read side, in one place on purpose.
//
// The rule Lin asked for: she can pull ANY fact out of the system — every
// dish, every diner, what each one paid, what each one cost — while her
// WRITE surface stays exactly as narrow as it already was. Keeping every
// read-only tool in its own module (and out of mey-tools.js, which owns the
// writes) makes that boundary something you can see rather than something
// you have to audit: nothing in this file calls saveState.
//
// Reads still have a budget. An answer has to fit in a Telegram message and
// a model context, so lists are capped and the caps are REPORTED — a
// truncated list that looks complete is worse than no list.

const {
  customerKey,
  customerLedger,
  dishCosts,
  dishDemand,
  financialSummary,
  fullOrder,
  orderDishes,
  orderMoney,
  ordersOf,
} = require('../domain/business-queries');
const { withCurrencyLabels } = require('../domain/money-labels');
const { orderPriceBreakdown } = require('../domain/order-pricing');
const { customerMetaFor } = require('./mey-audited-actions');

const CUSTOMER_SORTS = Object.freeze({
  billed: (a, b) => b.totalBilledMinorUnits - a.totalBilledMinorUnits,
  collected: (a, b) => b.totalCollectedMinorUnits - a.totalCollectedMinorUnits,
  outstanding: (a, b) => b.outstandingMinorUnits - a.outstandingMinorUnits,
  orders: (a, b) => b.orderCount - a.orderCount,
  recent: (a, b) => String(b.lastOrderDate ?? '').localeCompare(String(a.lastOrderDate ?? '')),
});
const CUSTOMER_SORT_LABELS = Object.freeze({
  billed: 'סך ההזמנות (כמה הוזמן)',
  collected: 'כמה שולם בפועל',
  outstanding: 'כמה עוד חייב',
  orders: 'מספר הזמנות',
  recent: 'תאריך ההזמנה האחרונה',
});

const MAX_ORDERS = 40;
const MAX_CUSTOMERS = 50;
const MAX_DISHES = 120;
const MAX_STATE_CHARS = 12_000;

// Per-order courier capability token — the one field withheld from every read
// below. It is an access credential, not business information.
const WITHHELD_ORDER_FIELDS = new Set(['meyToken']);

const READ_TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_order_full',
    description:
      'מחזיר הזמנה אחת במלואה: כל מנה עם הכמות שלה (סלטים, ראשונות, עיקריות, תוספות, קינוחים, אקסטרות, ' +
      'תפריט צהריים ופריטים חופשיים), כמה ארוחות זוגיות וחלות, הכסף (סה"כ, מקדמה, כמה נגבה, כמה עוד פתוח, ' +
      'אמצעי תשלום, חשבונית), פירוט המחיר שורה-שורה מול המחירון (pricing — למה הסכום הוא מה שהוא), פלטה, משלוח, ' +
      'הערות, השיחה המקורית והערות קבועות על הלקוח/ה. זה הכלי לשאלה "מה בדיוק היא הזמינה" ו"למה זה יצא ככה".',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'מזהה ההזמנה' } },
      required: ['orderId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_customer',
    description:
      'כל ההיסטוריה של סועד אחד לפי שם או טלפון: כל ההזמנות שלו (כל אחת עם פירוט המחיר שורה-שורה), כמה הוזמן בסך הכל, ' +
      'כמה שילם בפועל, כמה עוד פתוח, מתי הזמין לראשונה ולאחרונה, כמה הזמנות בוטלו, והערות קבועות של לין עליו (VIP, העדפות). ' +
      'זה הכלי לשאלה "כמה היא שילמה לי עד היום" ו"מה אני יודעת על הלקוח הזה".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'שם הלקוח/ה או טלפון, מלא או חלקי' },
        includeOrders: { type: 'boolean', description: 'לצרף את פירוט ההזמנות המלא, ברירת מחדל true' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'list_customers',
    description:
      'כל הסועדים של העסק, ממוינים: לכל אחד כמה הזמנות, כמה הוזמן בסך הכל (totalBilled), כמה שילם בפועל (totalCollected), ' +
      'כמה עוד חייב (outstanding), מתי הזמין לראשונה ולאחרונה ומה המנות שהוא הכי מזמין. ' +
      'sortBy=billed → "מי הזמין הכי הרבה כסף אי פעם"; sortBy=collected → "מי שילם הכי הרבה"; sortBy=outstanding → "מי חייב הכי הרבה"; ' +
      'sortBy=orders → "מי מזמין הכי הרבה פעמים"; sortBy=recent → "מי הזמין לאחרונה". הראשון ברשימה הוא התשובה ל"הכי".',
    parameters: {
      type: 'object',
      properties: {
        sortBy: {
          type: 'string',
          enum: ['billed', 'collected', 'outstanding', 'orders', 'recent'],
          description: 'לפי מה למיין, מהגבוה לנמוך. ברירת מחדל billed',
        },
        limit: { type: 'number', description: `כמה סועדים להחזיר, ברירת מחדל 20, מקסימום ${MAX_CUSTOMERS}` },
        withDebtOnly: { type: 'boolean', description: 'רק מי שנשאר לו תשלום פתוח' },
      },
      required: [],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'list_orders',
    description:
      'רשימת הזמנות ממוינת, לשאלות של "הכי": ההזמנה הכי גדולה, ההזמנות האחרונות, כל ההזמנות בטווח תאריכים. ' +
      'sortBy=total ממיין מהסכום הגבוה ומטה, sortBy=date מהחדשה ומטה. לכל הזמנה: מזהה, שם, תאריך, סכום, סטטוס, יעד. ' +
      `מקסימום ${MAX_ORDERS} בכל פעם, ותמיד נאמר אם נחתך. הזמנות שבוטלו לא נכללות אלא אם includeCancelled=true.`,
    parameters: {
      type: 'object',
      properties: {
        sortBy: { type: 'string', enum: ['total', 'date'], description: 'total = לפי סכום, date = לפי תאריך' },
        limit: { type: ['number', 'null'], description: `כמה להחזיר, ברירת מחדל 10, מקסימום ${MAX_ORDERS}` },
        fromDate: { type: ['string', 'null'], description: 'תאריך התחלה YYYY-MM-DD, או null' },
        toDate: { type: ['string', 'null'], description: 'תאריך סיום YYYY-MM-DD, או null' },
        includeCancelled: { type: ['boolean', 'null'], description: 'לכלול הזמנות שבוטלו, ברירת מחדל false' },
      },
      required: ['sortBy', 'limit', 'fromDate', 'toDate', 'includeCancelled'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_dish_demand',
    description:
      'כל המנות שהוזמנו בטווח תאריכים, מהמבוקשת ביותר ומטה, עם כמות מדויקת ובכמה הזמנות הופיעה. ' +
      'בלי טווח - כל ההיסטוריה. לשאלות "מה הכי נמכר" או "כמה מטבוחה יצאה החודש".',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: ['string', 'null'], description: 'תאריך התחלה YYYY-MM-DD, או null' },
        toDate: { type: ['string', 'null'], description: 'תאריך סיום YYYY-MM-DD, או null' },
      },
      required: ['fromDate', 'toDate'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_dish_cost',
    description:
      'כמה עולה להכין מנה: עלות המנה הבודדת, עלות התבנית כולה, עלות ל-100 גרם, ופירוט כמה עולה כל מרכיב ' +
      'ומאיזה ספק. מבוסס על ספר המתכונים ומחירי חומרי הגלם. אם למרכיב אין מחיר - זה נאמר במפורש ולא מוסתר. ' +
      'בלי שם מנה מחזיר את כל המנות שיש להן מתכון.',
    parameters: {
      type: 'object',
      properties: { dishName: { type: ['string', 'null'], description: 'שם מנה או חלק ממנו, או null לכל המנות' } },
      required: ['dishName'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_financial_summary',
    description:
      'תמונת הכסף בטווח תאריכים: כמה חויב, כמה נגבה בפועל, כמה עוד פתוח ואצל מי, כמה הוצאות נרשמו ומה נשאר נטו. ' +
      'בלי טווח - כל ההיסטוריה. לשאלות "כמה הכנסתי החודש" או "מי עוד לא שילם".',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: ['string', 'null'], description: 'תאריך התחלה YYYY-MM-DD, או null' },
        toDate: { type: ['string', 'null'], description: 'תאריך סיום YYYY-MM-DD, או null' },
      },
      required: ['fromDate', 'toDate'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'read_state',
    description:
      'קריאה ישירה של כל חלק במאגר הנתונים לפי נתיב, לכל שאלה שאין לה כלי ייעודי. ' +
      'נתיב ריק מחזיר את רשימת המפתחות הקיימים; "settings" מחזיר את ההגדרות; "menu.extras.0" מחזיר איבר. ' +
      'קריאה בלבד - הכלי הזה לא משנה כלום. תוצאה ארוכה נחתכת, ותמיד נאמר במפורש שהיא נחתכה.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'נתיב מופרד בנקודות, למשל "settings.deliveryWindows" או "" לשורש' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    strict: true,
  },
];

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function customerMatches(customer, query) {
  const digits = query.replace(/\D/gu, '');
  const name = normalized(customer.name);
  const phone = typeof customer.phone === 'string' ? customer.phone.replace(/\D/gu, '') : '';
  if (digits.length >= 4 && phone.includes(digits)) return true;
  return query !== '' && name.includes(query);
}

/** Strip the withheld fields wherever an order object is handed out. */
function withheldStripped(value) {
  if (Array.isArray(value)) return value.map(withheldStripped);
  if (!isRecord(value)) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (WITHHELD_ORDER_FIELDS.has(key)) continue;
    output[key] = withheldStripped(nested);
  }
  return output;
}

function readPath(root, path) {
  const segments = String(path ?? '')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  let current = root;
  const walked = [];
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, walked: walked.join('.'), missing: segment };
      }
      current = current[index];
    } else if (isRecord(current)) {
      if (!(segment in current)) {
        return { found: false, walked: walked.join('.'), missing: segment };
      }
      current = current[segment];
    } else {
      return { found: false, walked: walked.join('.'), missing: segment };
    }
    walked.push(segment);
  }
  return { found: true, value: current };
}

function describeShape(value) {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (isRecord(value)) return { type: 'object', keys: Object.keys(value) };
  return { type: value === null ? 'null' : typeof value };
}

function createMeyReadTools({ repository }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  async function loadState() {
    const current = await repository.loadState();
    return isRecord(current?.data) ? current.data : {};
  }

  const handlers = {
    async get_order_full({ orderId }) {
      const wanted = String(orderId ?? '').trim();
      if (wanted === '') return { error: 'צריך מזהה הזמנה' };
      const state = await loadState();
      const order = ordersOf(state).find((candidate) => String(candidate.id ?? '') === wanted);
      if (!order) return { error: `לא נמצאה הזמנה עם מזהה ${wanted}` };
      return {
        order: withheldStripped(fullOrder(order)),
        // why the total is what it is, line by line, against the price list
        pricing: orderPriceBreakdown(order, state.menu),
        customerNotes: customerMetaFor(state, order),
      };
    },

    async get_customer({ query, includeOrders }) {
      const q = normalized(query);
      if (q === '') return { error: 'צריך שם או טלפון לחיפוש' };
      const state = await loadState();
      const matches = customerLedger(state).filter((customer) => customerMatches(customer, q));
      if (matches.length === 0) return { count: 0, customers: [], note: 'לא נמצא סועד תואם.' };

      const wantOrders = includeOrders !== false;
      const allOrders = ordersOf(state);
      const customers = matches.slice(0, MAX_CUSTOMERS).map((customer) => {
        const own = allOrders.filter((order) => customerKey(order) === customer.key);
        // Lin's standing notes about this diner (panel customers screen + remember_note)
        const meta = own.length > 0 ? customerMetaFor(state, own[own.length - 1]) : { vip: false, notes: '' };
        const base = { ...customer, vip: meta.vip, notes: meta.notes || null };
        if (!wantOrders) return { ...base, orderIds: customer.orderIds.slice(0, MAX_ORDERS) };
        const orders = own
          .slice(-MAX_ORDERS)
          .map((order) => ({ ...withheldStripped(fullOrder(order)), pricing: orderPriceBreakdown(order, state.menu) }));
        return { ...base, orders, ordersTruncated: customer.orderIds.length > orders.length };
      });
      return { count: matches.length, customers };
    },

    async list_customers({ sortBy, limit, withDebtOnly }) {
      const state = await loadState();
      let customers = customerLedger(state);
      if (withDebtOnly === true) customers = customers.filter((c) => c.outstandingMinorUnits > 0);
      const order = CUSTOMER_SORTS[sortBy] ? sortBy : 'billed';
      customers = [...customers].sort(CUSTOMER_SORTS[order]);
      const count = customers.length;
      const requested = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_CUSTOMERS) : 20;
      const page = customers.slice(0, requested).map(({ orderIds: _ids, ...customer }) => customer);
      return {
        count,
        returned: page.length,
        truncated: count > page.length,
        sortedBy: order,
        note: `הרשימה ממוינת לפי ${CUSTOMER_SORT_LABELS[order]}, מהגבוה לנמוך — הראשון הוא ה"הכי".`,
        customers: page,
      };
    },

    async list_orders({ sortBy, limit, fromDate, toDate, includeCancelled }) {
      const state = await loadState();
      const from = typeof fromDate === 'string' && fromDate.trim() !== '' ? fromDate.trim() : null;
      const to = typeof toDate === 'string' && toDate.trim() !== '' ? toDate.trim() : null;
      const rows = ordersOf(state)
        .filter((order) => includeCancelled === true || String(order.status ?? '') !== 'בוטלה')
        .filter((order) => {
          const date = typeof order.date === 'string' ? order.date : '';
          if (from && date < from) return false;
          if (to && date > to) return false;
          return true;
        })
        .map((order) => {
          const money = orderMoney(order);
          return {
            id: order.id ?? null,
            name: typeof order.name === 'string' ? order.name : null,
            date: typeof order.date === 'string' ? order.date : null,
            time: typeof order.time === 'string' && order.time !== '' ? order.time : null,
            status: typeof order.status === 'string' ? order.status : null,
            place: order.pickup === true ? 'איסוף עצמי' : (typeof order.hotelName === 'string' && order.hotelName) || (typeof order.place === 'string' && order.place) || null,
            totalMinorUnits: money.totalMinorUnits,
            collectedMinorUnits: money.collectedMinorUnits,
            outstandingMinorUnits: money.outstandingMinorUnits,
            paid: money.paid || null,
          };
        });
      rows.sort((a, b) =>
        sortBy === 'total'
          ? (b.totalMinorUnits ?? -1) - (a.totalMinorUnits ?? -1)
          : String(b.date ?? '').localeCompare(String(a.date ?? '')),
      );
      const requested = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_ORDERS) : 10;
      const page = rows.slice(0, requested);
      return { count: rows.length, returned: page.length, truncated: rows.length > page.length, sortBy, orders: page };
    },

    async get_dish_demand({ fromDate, toDate }) {
      const state = await loadState();
      const demand = dishDemand(state, { fromDate: fromDate || null, toDate: toDate || null });
      const dishes = demand.dishes.slice(0, MAX_DISHES);
      return {
        ...demand,
        dishes,
        sortedBy: 'quantity',
        note: 'המנות ממוינות מהמבוקשת ביותר ומטה — הראשונה היא הנמכרת ביותר בטווח.',
        returned: dishes.length,
        truncated: demand.dishes.length > dishes.length,
      };
    },

    async get_dish_cost({ dishName }) {
      const state = await loadState();
      const result = dishCosts(state, { nameFilter: dishName ? String(dishName) : '' });
      if (result.count === 0) {
        return {
          count: 0,
          dishes: [],
          note: 'אין מתכון תואם בספר המתכונים, ולכן אי אפשר לחשב עלות. בלי מתכון אני לא מנחשת מחיר.',
        };
      }
      const dishes = result.dishes.slice(0, MAX_DISHES);
      return { count: result.count, returned: dishes.length, truncated: result.count > dishes.length, dishes };
    },

    async get_financial_summary({ fromDate, toDate }) {
      const state = await loadState();
      const summary = financialSummary(state, { fromDate: fromDate || null, toDate: toDate || null });
      const unpaid = summary.unpaidOrders.slice(0, MAX_ORDERS);
      return {
        ...summary,
        unpaidOrders: unpaid,
        unpaidTruncated: summary.unpaidOrders.length > unpaid.length,
        expenses: summary.expenses.slice(0, MAX_ORDERS),
        note:
          summary.unreadableTotals > 0
            ? `שימי לב: ב-${summary.unreadableTotals} הזמנות שדה הסה"כ לא ניתן לקריאה כמספר, והן לא נספרו בהכנסה.`
            : undefined,
      };
    },

    async read_state({ path }) {
      const state = await loadState();
      const result = readPath(state, path);
      if (!result.found) {
        const at = readPath(state, result.walked);
        return {
          error: `אין "${result.missing}" בנתיב "${result.walked || 'השורש'}"`,
          availableKeys: at.found ? describeShape(at.value).keys ?? null : null,
        };
      }
      const safe = withheldStripped(result.value);
      const serialized = JSON.stringify(safe, null, 2) ?? 'undefined';
      if (serialized.length <= MAX_STATE_CHARS) {
        return { path: String(path ?? ''), shape: describeShape(safe), value: safe };
      }
      return {
        path: String(path ?? ''),
        shape: describeShape(safe),
        truncated: true,
        note: `הערך גדול מדי להחזרה מלאה (${serialized.length} תווים). זה המבנה בלבד — אפשר לרדת לנתיב ספציפי יותר.`,
        preview: `${serialized.slice(0, MAX_STATE_CHARS)}…`,
      };
    },
  };

  // Every amount leaves with its dollar and dirham strings attached, so the
  // model quotes money instead of converting it in its head.
  const labelled = Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, async (args) => withCurrencyLabels(await handler(args))]),
  );

  return { definitions: READ_TOOL_DEFINITIONS, handlers: labelled, names: Object.keys(labelled) };
}

module.exports = {
  createMeyReadTools,
  READ_TOOL_DEFINITIONS,
  MAX_CUSTOMERS,
  MAX_DISHES,
  MAX_ORDERS,
  MAX_STATE_CHARS,
  WITHHELD_ORDER_FIELDS,
};
