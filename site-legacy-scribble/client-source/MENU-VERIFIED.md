# מטעמי בת מלך — the REAL menu
Source of truth: the client's own JPEG. Verified line-by-line against the AI-extracted HTML.
Currency on the original is **$** (confirmed, not AED).

## The offer
- **ארוחה זוגית / Couples' Meal — $230**
- **מארז הבדלה / Havdalah Kit — $20**
- Header: תפריט זוגי לכבוד שבת קודש · בס"ד · כשר

## סלטים טריים / Fresh Salads — **choose 4** (17 options)
כרוב לבן קלאסי · כרוב סגול במיונז · קולסלאו · מטבוחה פיקנטית · צ'ירשי טריפוליטאי ·
משוויה מרוקאית · מסייר (חמוצים) · טחינה · סלק מבושל · גזר מרוקאי מבושל · חציל במיונז ·
חציל מטוגן · פלפלים קלויים · עגבניות שרי חריפות · פלפל חריף צלוי · סלט ביצים · סלט תפו"א

## מנות ראשונות / First Courses — choose 1
- זוג פילה דג בר ים טרי ברוטב חריימה או מרוקאי
- קציצות דגים ברוטב מרוקאי

## עיקריות לשבת / Shabbat Mains — choose 1
- קציצות בשר ברוטב אדום עשיר
- קציצות בשר עם אפונה וארטישוק
- קציצות בשר בריבת בצל **וערמונים**
- טבחה עוף אדומה עם שעועית
- תבשיל עוף מרוקאי עם חומוסים
- טבחה עוף צהובה עם תפו"א

## תוספות לעיקריות / Sides — choose 1
- אורז לבן
- אורז פרסי עם עשבי תיבול
- קוסקוס עננים  → EN: "Cloud-Light Couscous"  (confirmed by Moshe 2026-07-30)

## סיום מתוק (פרווה) / Sweet Finish — choose 1
- סוכריות בקלוואה
- סופלה שוקולד

## ערכת אירוח מהודרת לשבת (included)
ערכת הדלקת נרות · זוג חלות ביתיות · כוס לקידוש ומיץ ענבים · צלחות, סכו"ם ומפיות

## משדרגים את השולחן / Upgrades
| item | price |
|---|---|
| צלי בקר פרוס ברוטב פטריות **וערמונים** (4 אנשים) | $150 |
| מפרום ביתי של אמא (זוגי) | $40 |
| טבחה בשר אדומה עם אפונה **ותפו"א** (2–3 אנשים) | $100 |
| רולדת בשר פריך **לצד רוטב פטריות עשיר** | $100 |
| מגש שניצלים (זוגי: כ-13–15 יח', תלוי בגודל) | $100 |
| מגש תפו"א קריספיים | $30 |
| מגש אורז / קוסקוס / **פסטה אדומה** | $25 |
| צלחת פתיחה (זיתים וחמוצים) | $15 |
| **צלחת חריפים** | $15 |
| תוספת 4 סלטים לבחירה | $25 |
| **תוספת חומוס ישראלי לניגוב** | $15 |
| תוספת חלה | $10 |

## ספיישל הבית / House Special
סיר קובה סלק בתוספת אורז (4 אנשים) — **$125**

## מנת ילדים / Kids
מנת פסטה אדומה ושניצלונים — **$35**

## Footer facts
- מלאי ההזמנות ופלטות החימום מוגבל — למשריינים מראש
- שירותי משלוחים ברחבי **דובאי ואבו דאבי**
- להזמנות: **+971 58 628 8776**

---

# Errors found in the AI-extracted HTML
| # | AI said | Original says | Severity |
|---|---|---|---|
| 1 | Salads "(Choose two)" | **יש לבחור 4 סוגי סלטים** — choose FOUR | **critical** — understates the offer |
| 2 | — | **צלחת חריפים $15** | **critical** — item dropped entirely |
| 3 | — | **תוספת חומוס ישראלי לניגוב $15** | **critical** — item dropped entirely |
| 4 | "Onion Jam" meatballs | onion jam **and chestnuts** | ingredient lost |
| 5 | Beef roast "Mushroom Sauce" | mushroom **and chestnut** sauce | ingredient lost |
| 6 | "Red Beef Tabkha with Peas" | peas **and potatoes** | ingredient lost |
| 7 | "Crispy Beef Roulade" | **served with rich mushroom sauce** | description lost |
| 8 | "Rice, Couscous or Pasta" | **red (tomato) pasta** | detail lost |
| 9 | Schnitzel "13–15 Pieces" | "**תלוי בגודל**" — depends on size | caveat lost |

# Other problems with the AI file
- Uses **emoji as icons** throughout (`fluent-emoji:cherry-blossom`) — against the standing rule
- Palette is generic rose (#831843 / #db2777 / #fbcfe8) — **not the client's locked brand palette**
- Tailwind loaded from CDN at runtime; logo hotlinked to a Supabase URL that can expire
- Playfair Display as the heading face — no Hebrew coverage
- No schema, no SEO, no metadata

# What this means for the website (currently WRONG)
| | site assumes | reality |
|---|---|---|
| model | à-la-carte dishes 12–80 AED | **one curated $230 Shabbat meal for two + upgrades** |
| cuisine | Iraqi-Jewish kubbe kitchen | **Moroccan / Tripolitan / Libyan** — matbucha, chershi, mechouia, mafrum, tabkha, chraimeh |
| kubbeh | 6 of 9 dishes | **one item**, the House Special |
| currency | AED | **$** |
| delivery | Dubai | **Dubai and Abu Dhabi** |
| dish names | largely inferred from photos | none of them appear on the real menu |

Her real design language is also visible in the JPEG: **pink, floral, decorative border** —
which validates the pink direction, and gives a genuine brand motif (the blossom) to use.
