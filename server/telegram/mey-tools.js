'use strict';

const {
  orderingStatus,
  setOrderingOpen,
  setSiteBanner,
  setItemStock,
  setOrderStatus,
  setDeliveryCheckin,
  setPlataStatus,
  KNOWN_ORDER_STATUSES,
  KNOWN_CHECKIN_STATES,
  KNOWN_PLATA_STATUSES,
} = require('../business-actions');
const {
  destinationLabel,
  dubaiDateString,
  navigationHref,
  orderName,
  orderStatus,
  selectDeliveryDay,
} = require('./delivery-day');

const MAX_SEARCH_RESULTS = 15;
const MAX_ORDERS_IN_CONTEXT = 200;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'search_orders',
    description: 'חיפוש הזמנות לפי שם לקוח, טלפון, אימייל, כתובת או מזהה הזמנה. מחזיר את כל הפרטים של ההזמנות התואמות.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'מחרוזת חיפוש - שם, טלפון, אימייל, כתובת או חלק מהם' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_recent_orders',
    description: 'מחזיר את ההזמנות האחרונות (הכי חדשות קודם), לצפייה כללית במה שקורה.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'כמה הזמנות להחזיר, ברירת מחדל 20' },
      },
      required: [],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'get_menu_and_settings',
    description:
      'מחזיר את מבנה התפריט הנוכחי, אילו מנות מסומנות כאזל מהמלאי, האם ההזמנות פתוחות עכשיו, ' +
      'ואם הן סגורות - באיזה תאריך הן נפתחות מחדש (reopensOn), והודעת הבאנר הנוכחית באתר.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_item_stock',
    description: 'מסמנת מנה כאזלה מהמלאי או מחזירה אותה למלאי. שם המנה חייב להיות מדויק כמו שהוא מופיע בתפריט (אפשר לבדוק קודם עם get_menu_and_settings).',
    parameters: {
      type: 'object',
      properties: {
        itemName: { type: 'string', description: 'שם המנה המדויק כפי שמופיע בתפריט' },
        inStock: { type: 'boolean', description: 'true = יש במלאי, false = אזל' },
      },
      required: ['itemName', 'inStock'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_order_status',
    description: `מעדכנת את הסטטוס של הזמנה קיימת. סטטוסים אפשריים: ${KNOWN_ORDER_STATUSES.join(', ')}. חפשי קודם עם search_orders כדי לוודא את מזהה ההזמנה הנכון.`,
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'מזהה ההזמנה (id)' },
        status: { type: 'string', enum: KNOWN_ORDER_STATUSES, description: 'הסטטוס החדש' },
      },
      required: ['orderId', 'status'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_ordering_open',
    description:
      'סוגרת או פותחת הזמנות חדשות באתר הלקוחות. סגירה היא תמיד סגירה לשבת הקרובה בלבד - ' +
      'ההזמנות נפתחות שוב לבד ביום ראשון, בלי שצריך לזכור לפתוח. פתיחה מחזירה את ההזמנות מיד.',
    parameters: {
      type: 'object',
      properties: {
        open: { type: 'boolean', description: 'false = לסגור לשבת הקרובה, true = לפתוח מיד' },
      },
      required: ['open'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_site_banner',
    description: 'מעדכנת או מנקה את הודעת הבאנר שמוצגת בראש אתר הלקוחות. שלחי null או מחרוזת ריקה כדי לנקות.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: ['string', 'null'], description: 'טקסט הבאנר, או null לניקוי' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_delivery_day',
    description:
      'מחזיר את יום המשלוחים המלא לתאריך מסוים - כל המשלוחים לפי סדר השעות, כולל אלה שכבר נמסרו. ' +
      'לכל משלוח: שם הלקוח, המלון, השעה, קישור ניווט, האם התקבלה תמונת מסירה, מה מצב הצ׳ק-אין של השליח וזמן ההגעה שמסר. ' +
      'זה הכלי לתיאום מול פליקס - תשתמשי בו לפני שאת עונה על כל שאלה או עדכון שקשור למשלוחים.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'תאריך בפורמט YYYY-MM-DD. ברירת מחדל: היום לפי שעון דובאי' },
      },
      required: [],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'set_delivery_checkin',
    description:
      'מתעדת עדכון של השליח על משלוח אחד: מצב הצ׳ק-אין (בדרך / מגיע בזמן / מתעכב), זמן הגעה משוער בדקות והערה חופשית. ' +
      'זה כל מה שהיא משנה - היא לא משנה סטטוס הזמנה, לא תשלום ולא שום דבר אחר. ' +
      'תאתרי קודם את ההזמנה הנכונה עם get_delivery_day או search_orders, ורק אז תקראי לכלי הזה עם המזהה שמצאת.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'מזהה ההזמנה (id)' },
        state: {
          type: 'string',
          enum: KNOWN_CHECKIN_STATES,
          description: 'onTheWay = בדרך, onTime = מגיע בזמן, delayed = מתעכב',
        },
        etaMinutes: {
          type: ['number', 'null'],
          description: 'תוך כמה דקות הוא מגיע, לפי מה שמסר. null אם לא מסר',
        },
        note: { type: ['string', 'null'], description: 'הערה קצרה בלשונו, או null' },
      },
      required: ['orderId', 'state', 'etaMinutes', 'note'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_plata_status',
    description:
      'מחזיר את כל הפלטות שיצאו ללקוחות ועדיין לא נסגרו - כלומר שהפיקדון עליהן עוד לא הוחזר. ' +
      'לכל אחת: שם הלקוח/ה, המלון, כמה פלטות, גובה הפיקדון, באיזה שלב היא (אצל הלקוח / מוכנה לאיסוף / נאספה), ' +
      'איפה הלקוח/ה השאיר/ה אותה ותאריך ההזמנה. זה הכלי לכל שאלה על פלטות ולתזכורת האיסוף במוצ״ש.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_plata_status',
    description:
      'לעדכן איפה הפלטה עומדת (אצל הלקוח / מוכנה לאיסוף / נאספה / הפיקדון הוחזר). ' +
      'זה כל מה שהיא משנה - היא לא משנה כמה פלטות יצאו ולא את סכום הפיקדון. ' +
      'תאתרי קודם את ההזמנה עם get_plata_status או search_orders, ורק אז תקראי לכלי הזה עם המזהה שמצאת.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'מזהה ההזמנה (id)' },
        status: {
          type: 'string',
          enum: KNOWN_PLATA_STATUSES,
          description:
            'withCustomer = אצל הלקוח, awaitingPickup = מוכנה לאיסוף, collected = נאספה, depositReturned = הפיקדון הוחזר',
        },
        note: { type: ['string', 'null'], description: 'איפה הפלטה מחכה ("בקבלה", מספר חדר), או null' },
      },
      required: ['orderId', 'status', 'note'],
      additionalProperties: false,
    },
    strict: true,
  },
];

function normalizedQuery(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function orderMatchesQuery(order, query) {
  if (query === '') return false;
  const haystack = [order.id, order.name, order.phone, order.email, order.address, order.notes]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function summarizeOrder(order) {
  return {
    id: order.id,
    date: order.date,
    name: order.name,
    phone: order.phone,
    email: order.email,
    address: order.address,
    status: order.status,
    total: order.total,
    paid: order.paid,
    payMethod: order.payMethod,
    notes: order.notes,
  };
}

// What Felix needs to hear about one stop, and what Mey needs to know to answer
// about it without guessing: where it goes, whether he already reported in, and
// whether a proof photo already closed it.
function summarizeDelivery(order) {
  return {
    id: order.id,
    name: orderName(order),
    hotel: destinationLabel(order),
    time: typeof order.time === 'string' ? order.time : null,
    status: orderStatus(order),
    navigationUrl: navigationHref(order),
    hasProofPhoto: Boolean(order.deliveryProofUrl),
    checkinState: order.courierCheckinState || null,
    etaMinutes: Number.isFinite(order.courierEtaMinutes) ? order.courierEtaMinutes : null,
    awaitingReply: Boolean(order.meyAwaitingReplySince),
    deliveredAt: order.deliveredAt || null,
  };
}

// A hotplate is closed only once its deposit is back, so everything else — still
// at the hotel, waiting at reception, already in the van — is still open business.
function isPlataOpen(order) {
  if (!order || typeof order !== 'object') return false;
  const count = Number(order.plataCount);
  if (!Number.isFinite(count) || count <= 0) return false;
  return order.plataStatus !== 'depositReturned';
}

function summarizePlata(order) {
  return {
    id: order.id,
    name: orderName(order),
    hotel: destinationLabel(order),
    date: typeof order.date === 'string' ? order.date : null,
    count: Number(order.plataCount),
    deposit: order.plataDeposit ?? null,
    status: order.plataStatus || 'withCustomer',
    pickupNote: typeof order.plataPickupNote === 'string' ? order.plataPickupNote : null,
  };
}

function createMeyTools({ repository, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  async function loadOrders() {
    const current = await repository.loadState();
    return Array.isArray(current.data.orders) ? current.data.orders : [];
  }

  async function loadSettings() {
    const current = await repository.loadState();
    return current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
  }

  const handlers = {
    async search_orders({ query }) {
      const orders = await loadOrders();
      const q = normalizedQuery(query);
      const matches = orders.filter((order) => orderMatchesQuery(order, q)).slice(-MAX_SEARCH_RESULTS);
      return { count: matches.length, orders: matches.map(summarizeOrder) };
    },

    async get_recent_orders({ limit }) {
      const orders = await loadOrders();
      const count = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_SEARCH_RESULTS) : 20;
      return { orders: orders.slice(-count).reverse().map(summarizeOrder) };
    },

    async get_menu_and_settings() {
      const current = await repository.loadState();
      const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      const menu = current.data.menu && typeof current.data.menu === 'object' ? current.data.menu : {};
      const outOfStock = Array.isArray(settings.out) ? settings.out.filter((v) => typeof v === 'string') : [];
      const ordering = orderingStatus(settings);
      return {
        orderingOpen: ordering.open,
        reopensOn: ordering.reopensOn,
        siteBanner: typeof settings.siteBanner === 'string' ? settings.siteBanner : null,
        outOfStock,
        menuOverrides: menu,
        note: 'menuOverrides מכיל רק שינויים שנעשו מברירת המחדל - לא בהכרח את כל התפריט המלא.',
      };
    },

    async get_delivery_day({ date }) {
      const current = await repository.loadState();
      const day = typeof date === 'string' && date.trim() !== '' ? date.trim() : dubaiDateString();
      const deliveries = selectDeliveryDay(current.data, day, { includeDelivered: true }).map(summarizeDelivery);
      return { date: day, count: deliveries.length, deliveries };
    },

    async set_delivery_checkin({ orderId, state, etaMinutes, note }) {
      return setDeliveryCheckin(repository, orderId, { state, etaMinutes, note });
    },

    async get_plata_status() {
      const orders = await loadOrders();
      const open = orders.filter(isPlataOpen).map(summarizePlata);
      return { count: open.length, platas: open };
    },

    async set_plata_status({ orderId, status, note }) {
      return setPlataStatus(repository, orderId, status, { note });
    },

    async set_item_stock({ itemName, inStock }) {
      const result = await setItemStock(repository, itemName, inStock);
      return result;
    },

    async set_order_status({ orderId, status }) {
      return setOrderStatus(repository, orderId, status);
    },

    async set_ordering_open({ open }) {
      return setOrderingOpen(repository, open);
    },

    async set_site_banner({ message }) {
      return setSiteBanner(repository, message);
    },
  };

  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name, args) {
      const handler = handlers[name];
      if (!handler) {
        return { error: `unknown tool: ${name}` };
      }
      try {
        return await handler(args || {});
      } catch (error) {
        logger.error(`mey tool ${name} failed`, error);
        return { error: error instanceof Error ? error.message : 'tool failed' };
      }
    },
  };
}

module.exports = { createMeyTools, MAX_ORDERS_IN_CONTEXT };
