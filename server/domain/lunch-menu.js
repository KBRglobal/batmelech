'use strict';

// The weekday lunch menu (מטעמי ימי חול), as dictated by Moshe on
// 2026-08-14 — see docs/menu-source-of-truth-2026-08-14.md.
//
// This is the server-side twin of DEFAULT_LUNCH in
// web/src/domain/settings-catalog.ts, in the same order, with the same
// keys, variant keys and names. The order matters: both the panel's
// buildAIOrderCatalog and מיי's buildIntakeCatalog derive catalog IDs from
// the item's INDEX (`lunch:2`, `lunch:3:1`, `lunch-addon:4`), so a review
// produced against one must read identically against the other. A test
// parses the web file and fails loudly on drift.
//
// Prices here are only the fallback for a lunch row the stored menu does
// not price; the live menu always wins when it carries a number.
//
// `aliases` is what the customer actually types. A weekday order arrives as
// "אני רוצה קובה", never as "מנת קובה סלק ביתית", and without an alias the
// dish falls out of the catalog entirely — which is exactly how a kubbeh
// order once reached the panel with no cost on it.
const LUNCH_MENU = [
  {
    key: 'baguette',
    name: 'בגט טוניסאי אותנטי',
    priceUsd: 22,
    aliases: ['בגט טוניסאי', 'בגט טונה', 'טוניסאי'],
    variants: [],
    addon: null,
  },
  {
    key: 'schnitzel-roll',
    name: 'בגט/חלת שניצל ישראלי',
    priceUsd: null,
    aliases: [],
    variants: [
      { key: 'baguette', label: 'בבגט', priceUsd: 25, aliases: ['בגט שניצל', 'שניצל בבגט'] },
      { key: 'challah', label: 'בחלה — סופ"ש בלבד', priceUsd: 28, aliases: ['חלת שניצל', 'שניצל בחלה'] },
    ],
    addon: null,
  },
  {
    key: 'kubeh',
    name: 'מנת קובה סלק ביתית',
    priceUsd: 35,
    aliases: ['קובה', 'קובה סלק', 'מנת קובה', 'קובה ביתית'],
    variants: [],
    addon: null,
  },
  {
    key: 'schnitzel-plate',
    name: 'שניצל בצלחת',
    priceUsd: null,
    aliases: [],
    variants: [
      { key: 'single', label: 'אישית', priceUsd: 35, aliases: ['שניצל בצלחת אישית', 'מנת שניצל אישית'] },
      { key: 'couple', label: 'זוגית', priceUsd: 60, aliases: ['שניצל בצלחת זוגית', 'מנת שניצל זוגית'] },
      { key: 'family', label: 'משפחתית — כולל 2 תוספות', priceUsd: 145, aliases: ['שניצל בצלחת משפחתית', 'מנת שניצל משפחתית'] },
    ],
    addon: null,
  },
  {
    key: 'couscous',
    name: 'ספיישל קוסקוס',
    priceUsd: 35,
    aliases: ['ספיישל קוסקוס', 'קוסקוס עם מרק ירקות'],
    variants: [],
    addon: { name: 'מנת מפרום ביתי', priceUsd: 20, aliases: ['מפרום', 'מנת מפרום'] },
  },
];

module.exports = { LUNCH_MENU };
