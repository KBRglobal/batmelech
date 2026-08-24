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
  ordersOf,
} = require('../domain/business-queries');

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
      'אמצעי תשלום, חשבונית), פלטה, משלוח, הערות והשיחה המקורית. זה הכלי לשאלה "מה בדיוק היא הזמינה".',
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
      'כל ההיסטוריה של סועד אחד לפי שם או טלפון: כל ההזמנות שלו, כמה הוזמן בסך הכל, כמה שילם בפועל, ' +
      'כמה עוד פתוח, מתי הזמין לראשונה ולאחרונה, וכמה הזמנות בוטלו. זה הכלי לשאלה "כמה היא שילמה לי עד היום".',
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
      'כל הסועדים של העסק, מהמשלם הגדול ביותר ומטה: כמה הזמנות, כמה שילם, כמה עוד חייב, מתי הזמין לאחרונה ' +
      'ומה המנות שהוא הכי מזמין. לשאלות "מי הלקוחות הכי טובים" או "מי חייב לי כסף".',
    parameters: {
      type: 'object',
      properties: {
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
      return { order: withheldStripped(fullOrder(order)) };
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
        if (!wantOrders) return { ...customer, orderIds: customer.orderIds.slice(0, MAX_ORDERS) };
        const orders = allOrders
          .filter((order) => customerKey(order) === customer.key)
          .slice(-MAX_ORDERS)
          .map((order) => withheldStripped(fullOrder(order)));
        return { ...customer, orders, ordersTruncated: customer.orderIds.length > orders.length };
      });
      return { count: matches.length, customers };
    },

    async list_customers({ limit, withDebtOnly }) {
      const state = await loadState();
      let customers = customerLedger(state);
      if (withDebtOnly === true) customers = customers.filter((c) => c.outstandingMinorUnits > 0);
      const count = customers.length;
      const requested = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_CUSTOMERS) : 20;
      const page = customers.slice(0, requested).map(({ orderIds: _ids, ...customer }) => customer);
      return {
        count,
        returned: page.length,
        truncated: count > page.length,
        customers: page,
      };
    },

    async get_dish_demand({ fromDate, toDate }) {
      const state = await loadState();
      const demand = dishDemand(state, { fromDate: fromDate || null, toDate: toDate || null });
      const dishes = demand.dishes.slice(0, MAX_DISHES);
      return {
        ...demand,
        dishes,
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

  return { definitions: READ_TOOL_DEFINITIONS, handlers, names: Object.keys(handlers) };
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
