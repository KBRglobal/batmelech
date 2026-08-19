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
const {
  ORDER_FIELD_VALIDATORS,
  deleteOrder,
  editMenuItem,
  freezeWrites,
  isWritesFrozen,
  setBasePrices,
  setExtraPrice,
  undoMeyChange,
  updateOrderDetails,
} = require('./mey-audited-actions');
const { buildSiteKnowledge, displayNamesByItemId } = require('../ai/site-knowledge');

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
      'ואם הן סגורות - באיזה תאריך הן נפתחות מחדש (reopensOn), הודעת הבאנר הנוכחית באתר, ' +
      'חלונות המשלוח המוגדרים, תפריטי החגים, תאריכים סגורים ומינימום הזמנה לאבו דאבי.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_business_knowledge',
    description:
      'מחזיר את כל בסיס הידע של העסק כפי שהאתר מציג אותו: מה כלול בארוחה הזוגית (כולל כמה דגים), ' +
      'מחירי תוספות, דמי משלוח, אמצעי תשלום, כשרות, מדיניות ביטולים, אירועים פרטיים, תפריט חי עם תיאורים, ' +
      'מרכיבי מנות, סטטוס הזמנות ותפריטי חג. זה הכלי לכל שאלה כללית על העסק, האתר, מחירים או מנות - ' +
      'תשתמשי בו במקום להגיד שאת לא בטוחה.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_dish_recipe',
    description:
      'מחזיר את המתכון המלא של מנה מספר המתכונים: מרכיבים עם כמויות ויחידות, אחוז פחת ותפוקה (מנות לתבנית). ' +
      'מקבל שם מנה או חלק ממנו ומחזיר את כל המתכונים התואמים. זה הכלי לשאלות "מה יש בתוך" או "ממה מורכב".',
    parameters: {
      type: 'object',
      properties: {
        dishName: { type: 'string', description: 'שם המנה או חלק ממנו' },
      },
      required: ['dishName'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'search_products',
    description:
      'מחפש במאגר המוצרים (חומרי הגלם): שם, קטגוריה, ומחירי אריזה אצל כל ספק (נסטו/לולו/רימון), ' +
      'כולל מחיר ידני אם הוגדר. לשאלות על מחירי חומרי גלם וספקים. חיפוש ריק מחזיר את כל המוצרים.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'שם מוצר או חלק ממנו; ריק לכל המוצרים' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_item_stock',
    description:
      'מסמנת מנה כאזלה מהמלאי או מחזירה אותה למלאי. הכלי מאמת את השם מול התפריט האמיתי: ' +
      'אם השם לא קיים בתפריט, שום דבר לא נכתב והכלי מחזיר את המנות הדומות (candidates). ' +
      'אם חזר בדיוק מועמד אחד - תקראי שוב עם השם המדויק. אם חזרו כמה - תשאלי למה התכוונו ' +
      '(למשל: "יש שני כרובים בתפריט - לבן או סגול?") ורק אחרי תשובה תסמני.',
    parameters: {
      type: 'object',
      properties: {
        itemName: { type: 'string', description: 'שם המנה כפי שנכתב לך; עדיף מדויק כמו בתפריט' },
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
    name: 'build_order_from_whatsapp',
    description:
      'בונה טיוטת הזמנה משיחת וואטסאפ שלין העבירה. מקבלת את הטקסט המלא של השיחה או ההודעה (אפשר כמה הודעות, כולל תיקונים), ' +
      'מפענחת מנות/כמויות/תאריך/שעה/מלון מול התפריט החי בלבד, שומרת הזמנה חדשה בסטטוס "חדשה" לבדיקה בפאנל, ' +
      'ומחזירה: סיכום, מה חסר, טיוטת תשובה ללקוח (להעתקה — לין שולחת בעצמה), וקישור להזמנה. ' +
      'להשתמש רק כשלין מעבירה שיחה/הודעה של לקוח ומבקשת לבנות ממנה הזמנה.',
    parameters: {
      type: 'object',
      properties: {
        conversationText: {
          type: 'string',
          description: 'הטקסט המלא של השיחה או ההודעה מהלקוח, בדיוק כפי שהועבר',
        },
      },
      required: ['conversationText'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'update_order_details',
    description:
      'מעדכנת פרטים בהזמנה קיימת: שם, טלפון, אימייל, כתובת, מלון (place), תאריך (YYYY-MM-DD), שעה (HH:MM), הערות, ' +
      'קבוצה, סכום (total), מקדמה (deposit), אמצעי תשלום, שולם (כן/לא), סטטוס. שולחים רק את השדות שמשתנים. ' +
      'כל שינוי נרשם ביומן וניתן לביטול עם undo_last_change. חפשי קודם עם search_orders לוודא את ההזמנה הנכונה.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'מזהה ההזמנה (id)' },
        fields: {
          type: 'object',
          description: 'רק השדות לעדכון. למשל {"time": "15:00", "total": 320}',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
            place: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string' },
            notes: { type: 'string' },
            group: { type: 'string' },
            total: { type: 'number' },
            deposit: { type: 'number' },
            payMethod: { type: 'string' },
            paid: { type: 'string', enum: ['כן', 'לא'] },
            status: { type: 'string', enum: KNOWN_ORDER_STATUSES },
          },
          additionalProperties: false,
        },
      },
      required: ['orderId', 'fields'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'delete_order',
    description:
      'מוחקת הזמנה. המחיקה נרשמת ביומן וניתנת לשחזור מלא עם undo_last_change או מהפאנל. ' +
      'לפני מחיקה תמיד תוודאי עם search_orders שזו ההזמנה הנכונה, ותאשרי מול מי שביקש בציון שם הלקוח.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'מזהה ההזמנה (id)' },
      },
      required: ['orderId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'edit_menu_item',
    description:
      'עורכת את התפריט עצמו: הוספת מנה, הסרת מנה, או שינוי שם מנה באחת הקטגוריות ' +
      '(salads/firsts/mains/sides/desserts). כל שינוי נרשם ביומן וניתן לביטול.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'remove', 'rename'], description: 'הפעולה' },
        category: { type: 'string', enum: ['salads', 'firsts', 'mains', 'sides', 'desserts'] },
        name: { type: 'string', description: 'שם המנה המדויק' },
        newName: { type: ['string', 'null'], description: 'שם חדש (רק ל-rename)' },
      },
      required: ['op', 'category', 'name', 'newName'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_extra_price',
    description: 'מעדכנת מחיר של תוספת בתשלום בתפריט (extras). נרשם ביומן וניתן לביטול.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'שם התוספת המדויק' },
        priceUsd: { type: 'number', description: 'המחיר החדש בדולרים' },
      },
      required: ['name', 'priceUsd'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'set_base_prices',
    description: 'מעדכנת את מחיר הארוחה הזוגית ו/או מחיר החלה. נרשם ביומן וניתן לביטול.',
    parameters: {
      type: 'object',
      properties: {
        couplePriceUsd: { type: ['number', 'null'], description: 'מחיר ארוחה זוגית בדולרים, או null אם לא משתנה' },
        challahPriceUsd: { type: ['number', 'null'], description: 'מחיר חלה בדולרים, או null אם לא משתנה' },
      },
      required: ['couplePriceUsd', 'challahPriceUsd'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'undo_last_change',
    description:
      'מבטלת את הפעולה האחרונה שלך (או פעולה ספציפית לפי מזהה מהיומן): מחזירה הזמנה ששונתה למצבה הקודם, ' +
      'משחזרת הזמנה שנמחקה, מוחקת הזמנה שנוצרה, ומחזירה שינויי תפריט ומחירים. עובדת גם במצב הקפאה.',
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: ['string', 'null'], description: 'מזהה פעולה מהיומן, או null לביטול הפעולה האחרונה' },
      },
      required: ['entryId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'freeze_writes',
    description:
      'הקפאת חירום: עוצרת מיד את כל יכולות הכתיבה שלך (חוץ מביטול שינויים). ' +
      'להפעיל כשמישהו כותב "עצרי הכל" או כשמשהו נראה חשוד/פרוץ. שחרור ההקפאה — רק מהפאנל, בהגדרות.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
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

// Same spirit as the site's out-of-stock matching: Hebrew geresh/gershayim
// variants and doubled spaces must not make two spellings of one dish differ.
function canonicalDishName(value) {
  return typeof value === 'string'
    ? value
        .replace(/[׳‘’ʼ]/gu, "'")
        .replace(/[״“”]/gu, '"')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLowerCase()
    : '';
}

// Every name the site can mark sold out: all menu categories, extras, lunch
// items and their variants, lunch sides — plus whatever is already in
// settings.out (so a dish renamed after being marked can still be restored).
function collectMenuItemNames(data) {
  const menu = data && typeof data.menu === 'object' && data.menu !== null ? data.menu : {};
  const settings = data && typeof data.settings === 'object' && data.settings !== null ? data.settings : {};
  const names = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim() !== '' && !names.includes(value.trim())) {
      names.push(value.trim());
    }
  };
  for (const category of ['salads', 'firsts', 'mains', 'sides', 'desserts', 'lunchSides']) {
    for (const name of Array.isArray(menu[category]) ? menu[category] : []) push(name);
  }
  for (const row of Array.isArray(menu.extras) ? menu.extras : []) {
    if (row && typeof row === 'object') push(row.name);
  }
  for (const row of Array.isArray(menu.lunch) ? menu.lunch : []) {
    if (!row || typeof row !== 'object') continue;
    push(row.key);
    for (const variant of Array.isArray(row.variants) ? row.variants : []) {
      if (variant && typeof variant === 'object') push(variant.k);
    }
  }
  for (const name of Array.isArray(settings.out) ? settings.out : []) push(name);
  return names;
}

// "כרוב אדום" should surface both "כרוב לבן קלאסי" and "כרוב סגול במיונז":
// a candidate matches when it shares a word (or a containing word) with the
// requested name, ranked by how many words it shares.
function similarMenuItemNames(requested, knownNames) {
  const requestedWords = canonicalDishName(requested)
    .split(' ')
    .filter((word) => word.length >= 2);
  if (requestedWords.length === 0) return [];
  const scored = [];
  for (const name of knownNames) {
    const nameWords = canonicalDishName(name).split(' ');
    let score = 0;
    for (const word of requestedWords) {
      if (nameWords.some((candidate) => candidate.includes(word) || word.includes(candidate))) score += 1;
    }
    if (score > 0) scored.push({ name, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => entry.name);
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

function createMeyTools({ repository, logger = console, whatsappIntake = null }) {
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
        deliveryWindows: Array.isArray(settings.deliveryWindows) ? settings.deliveryWindows : [],
        holidayMenus: Array.isArray(settings.holidayMenus) ? settings.holidayMenus : [],
        closedDates: Array.isArray(settings.closedDates)
          ? settings.closedDates.filter((v) => typeof v === 'string')
          : [],
        minOrderAbuDhabiMinorUnits:
          typeof settings.minOrderAbuDhabiMinorUnits === 'number' ? settings.minOrderAbuDhabiMinorUnits : null,
        note: 'menuOverrides מכיל רק שינויים שנעשו מברירת המחדל - לא בהכרח את כל התפריט המלא. לתמונה המלאה של האתר יש את get_business_knowledge.',
      };
    },

    async get_business_knowledge() {
      const current = await repository.loadState();
      return { knowledge: buildSiteKnowledge(current.data) };
    },

    async get_dish_recipe({ dishName }) {
      const query = normalizedQuery(dishName);
      if (query === '') return { error: 'צריך שם מנה לחיפוש' };
      const current = await repository.loadState();
      const recipes = Array.isArray(current.data.recipes) ? current.data.recipes : [];
      const nameById = displayNamesByItemId(current.data);
      const matches = [];
      for (const recipe of recipes) {
        if (!recipe || typeof recipe !== 'object' || typeof recipe.itemId !== 'string') continue;
        const displayName = nameById.get(recipe.itemId) || (typeof recipe.name === 'string' ? recipe.name : '');
        if (displayName === '' || !displayName.toLowerCase().includes(query)) continue;
        matches.push({
          dishName: displayName,
          yield: recipe.yield,
          finishedYieldGrams: recipe.finishedYieldGrams ?? null,
          ingredients: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((row) => ({
            name: row.ingredientName,
            quantity: row.quantity,
            unit: row.unit,
            wastePercent: row.wastePercent ?? null,
          })),
        });
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
      if (matches.length === 0) {
        return { count: 0, recipes: [], note: 'אין מתכון תואם בספר המתכונים - ייתכן שהמנה עוד לא הוזנה שם.' };
      }
      return { count: matches.length, recipes: matches };
    },

    async search_products({ query }) {
      const q = normalizedQuery(query);
      const current = await repository.loadState();
      const library = Array.isArray(current.data.productLibrary) ? current.data.productLibrary : [];
      const matches = [];
      for (const entry of library) {
        if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue;
        if (q !== '' && !entry.name.toLowerCase().includes(q)) continue;
        const listings = {};
        for (const supplier of ['nesto', 'lulu', 'rimon']) {
          const listing = entry.listings && typeof entry.listings === 'object' ? entry.listings[supplier] : null;
          if (!listing || typeof listing !== 'object') continue;
          listings[supplier] = {
            packSize: listing.packSize,
            packUnit: listing.packUnit,
            packPrice: typeof listing.packPriceMinorUnits === 'number' ? listing.packPriceMinorUnits / 100 : null,
            manualPricePerBaseUnit:
              listing.manualPrice && typeof listing.manualPrice.minorUnitsPerBaseUnit === 'number'
                ? listing.manualPrice.minorUnitsPerBaseUnit / 100
                : null,
          };
        }
        matches.push({
          name: entry.name,
          category: typeof entry.category === 'string' ? entry.category : '',
          kosherOnly: Boolean(entry.kosherOnly),
          supplierOverride: entry.supplierOverride ?? null,
          listings,
        });
        if (matches.length >= 60) break;
      }
      return { count: matches.length, products: matches };
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

    async build_order_from_whatsapp({ conversationText }) {
      if (!whatsappIntake || typeof whatsappIntake.intake !== 'function') {
        return { error: 'קליטת וואטסאפ לא זמינה כרגע' };
      }
      const result = await whatsappIntake.intake(conversationText);
      if (!result.ok) {
        return { error: `הקליטה נכשלה (${result.error}) — אפשר לנסות שוב או להזין בפאנל` };
      }
      return {
        ok: true,
        orderId: result.orderId,
        orderUrl: result.orderUrl,
        items: result.review.draft.items.map((item) => ({
          name: item.catalogItemName,
          quantity: item.quantity,
        })),
        customerName: result.review.draft.customerName,
        customerPhone: result.review.draft.customerPhone,
        serviceDate: result.review.draft.serviceDate,
        serviceTime: result.review.draft.serviceTime,
        deliveryLocation: result.review.draft.deliveryLocation,
        unknownItems: result.review.unknownItems.map((unknown) => unknown.sourceText),
        missingFields: result.review.missingFields.map((field) => field.field),
        replyDraftForCustomer: result.replyDraft,
        note: 'ההזמנה נשמרה בסטטוס חדשה וטעונה בדיקה בפאנל. את טיוטת התשובה לין מעתיקה ושולחת בעצמה.',
      };
    },

    // Lin types dish names from memory ("כרוב אדום" for "כרוב סגול במיונז").
    // Writing an unknown name to settings.out would silently do nothing on the
    // site, so an inexact name never writes — it returns the similar menu
    // items instead, and Mey asks which one was meant.
    async set_item_stock({ itemName, inStock }) {
      const requested = typeof itemName === 'string' ? itemName.trim() : '';
      if (requested === '') return { error: 'צריך שם מנה' };
      const current = await repository.loadState();
      const knownNames = collectMenuItemNames(current.data);
      const exact = knownNames.find((name) => canonicalDishName(name) === canonicalDishName(requested));
      if (exact === undefined) {
        const candidates = similarMenuItemNames(requested, knownNames);
        if (candidates.length === 0) {
          return {
            ok: false,
            error: `"${requested}" לא נמצא בתפריט ולא נמצאו מנות דומות. אפשר לבדוק את השמות עם get_menu_and_settings.`,
          };
        }
        return {
          ok: false,
          needsClarification: true,
          requestedName: requested,
          candidates,
          note:
            candidates.length === 1
              ? 'נמצאה מנה אחת דומה - קראי שוב לכלי עם השם המדויק הזה.'
              : 'יש כמה מנות דומות בתפריט - תשאלי למה התכוונו לפני שמסמנים.',
        };
      }
      return setItemStock(repository, exact, inStock);
    },

    async update_order_details({ orderId, fields }) {
      return updateOrderDetails(repository, orderId, fields);
    },

    async delete_order({ orderId }) {
      return deleteOrder(repository, orderId);
    },

    async edit_menu_item({ op, category, name, newName }) {
      return editMenuItem(repository, { op, category, name, newName: newName || undefined });
    },

    async set_extra_price({ name, priceUsd }) {
      return setExtraPrice(repository, { name, priceUsd });
    },

    async set_base_prices({ couplePriceUsd, challahPriceUsd }) {
      return setBasePrices(repository, { couplePriceUsd, challahPriceUsd });
    },

    async undo_last_change({ entryId }) {
      return undoMeyChange(repository, entryId || undefined);
    },

    async freeze_writes() {
      return freezeWrites(repository);
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

  // Every state-changing tool honors the emergency freeze. freeze_writes and
  // undo_last_change stay usable while frozen — stopping and reverting damage
  // must always work; unfreezing is panel-only.
  const WRITE_TOOLS = new Set([
    'set_item_stock',
    'set_order_status',
    'set_ordering_open',
    'set_site_banner',
    'set_delivery_checkin',
    'set_plata_status',
    'build_order_from_whatsapp',
    'update_order_details',
    'delete_order',
    'edit_menu_item',
    'set_extra_price',
    'set_base_prices',
  ]);

  async function writesAreFrozen() {
    const settings = await loadSettings();
    return isWritesFrozen(settings);
  }

  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name, args) {
      const handler = handlers[name];
      if (!handler) {
        return { error: `unknown tool: ${name}` };
      }
      try {
        if (WRITE_TOOLS.has(name) && (await writesAreFrozen())) {
          return { error: 'מצב הקפאה פעיל — כל הכתיבות שלך חסומות. שחרור רק מהפאנל (הגדרות). אפשר עדיין לבטל שינויים עם undo_last_change.' };
        }
        return await handler(args || {});
      } catch (error) {
        logger.error(`mey tool ${name} failed`, error);
        return { error: error instanceof Error ? error.message : 'tool failed' };
      }
    },
  };
}

module.exports = { createMeyTools, MAX_ORDERS_IN_CONTEXT };
