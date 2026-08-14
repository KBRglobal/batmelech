'use strict';

const { setOrderingOpen, setSiteBanner, setItemStock } = require('../business-actions');

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
    description: 'מחזיר את מבנה התפריט הנוכחי, אילו מנות מסומנות כאזל מהמלאי, האם ההזמנות פתוחות, והודעת הבאנר הנוכחית באתר.',
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
    name: 'set_ordering_open',
    description: 'סוגרת או פותחת הזמנות חדשות באתר הלקוחות.',
    parameters: {
      type: 'object',
      properties: {
        open: { type: 'boolean', description: 'true = הזמנות פתוחות, false = סגורות' },
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
      return {
        orderingOpen: settings.orderingOpen !== false,
        siteBanner: typeof settings.siteBanner === 'string' ? settings.siteBanner : null,
        outOfStock,
        menuOverrides: menu,
        note: 'menuOverrides מכיל רק שינויים שנעשו מברירת המחדל - לא בהכרח את כל התפריט המלא.',
      };
    },

    async set_item_stock({ itemName, inStock }) {
      const result = await setItemStock(repository, itemName, inStock);
      return result;
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
