# Bat Melech — Sleek prompts for the five missing screens

Paste each prompt as a separate message into the existing Bat Melech Sleek project.
Use the theme Moshe already created. Do not create a new theme and do not redesign existing screens.

The WhatsApp AI paste control belongs to the existing New/Edit Order screen and is not one of these five missing screens.

---

## Prompt 1 of 5 — Preparation Summary

```text
Create exactly one new responsive application screen named "Preparation Summary" for the existing Bat Melech project.

Use the project's current theme exactly. Do not create, replace, or modify the theme. This is an operational food-order management system, not a marketing page.

Global rules:
- All visible interface copy must be Hebrew and the complete layout must be RTL.
- Never use emoji characters. Use one consistent Iconify icon family, preferably Lucide, for every navigation item, button, status, and empty state.
- Desktop at 1440px: fixed right sidebar. Tablet at 768px and mobile at 375px: compact sticky horizontally scrollable navigation.
- Existing navigation labels, in this order: היום, הזמנות, הזמנה חדשה, סיכום הכנות, משלוחים, כספים, לקוחות, הגדרות וגיבוי. Mark סיכום הכנות as active.
- Header copy: מטעמי בת מלך. Subtitle: מערכת ניהול הזמנות · מטבח ביתי אותנטי כשר.
- Use React-ready reusable patterns: AppShell, PageHeader, Button, IconButton, Select, StatCard, DataTable, ProgressBadge, EmptyState, Toast, StatusBadge.
- Show polished hover, focus, active, disabled, loading, success, error, and print states.
- Use anonymized mock data only. Do not show real customer names, phone numbers, addresses, orders, API keys, or database data.
- Do not add invented product features or marketing copy.

Screen content and behavior:

1. Page toolbar
- Page title: סיכום הכנות — {טווח נבחר}.
- Select label: מה מכינים? (יום אחד או תקופה).
- Select options:
  - השבוע הקרוב (N)
  - כל ההזמנות הקרובות (N)
  - one option for each service date formatted as {יום בשבוע} · DD.MM (N)
- Changing the select updates every statistic, table, order card, and delivery row on the screen.
- Button with printer icon: הדפסה. It prints only the current preparation summary and hides the sidebar, navigation, and controls.
- Button with copy icon: העתקת הסיכום. It copies a formatted preparation summary and then shows a success toast: הועתק.
- Button with receipt-text icon: הדפסת בונים לכל ההזמנות. It prints one ticket per selected order. Disabled when there are no selected orders; error toast: אין הזמנות להדפסה.
- Button with tags icon: מדבקות לשקיות. It opens the existing Labels screen. That screen already contains חזרה לסיכום, הדפסת המדבקות, and minus/plus quantity controls per customer, so do not duplicate it here.

2. Context helper
- Multi-date selection text: מתחת לכל מנה מופיע הפירוט לפי ימים — כמה לכל יום.
- Single-date selection text: נגיעה על שורה מסמנת שהמנה מוכנה — הסימונים נשמרים ליום הזה.

3. Statistics grid
Show these cards in this exact order:
- הזמנות
- מוכן with value X/Y, only for a single date
- ימי אספקה, only for a multi-date range
- ארוחות זוגיות
- חלות
- עריכה (איש)
- סה״כ הכנסות
- נשאר לגבות
For a multi-date range, also show one compact line: חלות לפי יום: DD.MM: N · DD.MM: N.

4. Preparation tables
Only show a section when it has data.

Section: סלטים להכנה
- Columns: סלט, הוזמן, פינוק, סה״כ.
- Include a final total row: סה״כ סלטים.

Sections: מנות ראשונות, עיקריות, תוספות, קינוחים
- Columns: מנה, כמות.

Single-date interaction:
- Every preparation row is clickable and has a real circle-check icon state.
- Clicking toggles ready/not ready and updates the X/Y progress badge.
- Ready rows become muted with a line through the item name.
- Keyboard focus and Enter/Space behavior must be visible in the design.

Multi-date interaction:
- Rows are not checkable.
- Under every dish name, show a compact per-day breakdown such as א׳ 14.08 · 3, ו׳ 19.08 · 5.

Section: אקסטרות
- Columns: מה, כמות, למי, יום only for multi-date, הערה.
- Rows are checkable only for a single date.

Section: תפריט צהריים
- Same columns as אקסטרות.
- Rows are never checkable and do not count toward preparation progress.

Section: הערות חשובות
- Show customer-labelled notes for heat level, first-course notes, main-course notes, allergies, and general preparation instructions.
- Notes must be visually prominent but calm, not alarm-like unless they describe an allergy.

5. Delivery and pickup table embedded in the summary
Section title: לוח משלוחים ואיסופים.
- Columns: יום only for multi-date, שעה, שם, לאן, טלפון, תשלום.
- Name includes a status badge.
- Destination displays איסוף עצמי, destination name, or —, with address below when present.
- Phone is a clickable tel link.
- Payment displays one of: שולם, לגבות N$, מקדמה, שת״פ.
- Each delivery destination has an icon-only navigation action with tooltip ניווט.
- Button above the table with send icon: שליחת המסלול לשליח. It copies the route and opens WhatsApp recipient selection.

6. Order cards
Section title: כרטיסי הזמנה (N).
- Show one compact preformatted order summary card per selected order.
- Preserve clear visual hierarchy for customer, service date, dishes, delivery, payment, and notes.

7. Empty states
- No dated orders: אין עדיין הזמנות עם תאריך. ברגע שיהיו — כאן יופיע סיכום ההכנות המלא.
- Selected range with no active orders: אין הזמנות בתקופה הזאת.

Build the populated desktop screen plus representative mobile behavior inside the same responsive screen. Do not create additional screens.
```

---

## Prompt 2 of 5 — Deliveries

```text
Create exactly one new responsive application screen named "Deliveries" in the existing Bat Melech project.

Use the existing project theme and the exact same RTL application shell, typography, spacing, cards, sidebar, mobile navigation, button variants, and Iconify/Lucide icon family already used by the project. Do not create or modify the theme. Never use emoji characters. All visible copy must be Hebrew. Use anonymized mock customer data only.

Existing navigation labels: היום, הזמנות, הזמנה חדשה, סיכום הכנות, משלוחים, כספים, לקוחות, הגדרות וגיבוי. Mark משלוחים as active.

Build a real operational route board with these exact controls and states:

1. Header and filter
- Page title: משלוחים — {טווח נבחר}.
- Select label: משלוחים ליום.
- Options:
  - השבוע הקרוב (N)
  - כל ההזמנות הקרובות (N)
  - one option per service date formatted {יום בשבוע} · DD.MM (N)
- Counts exclude cancelled orders.

2. Route actions
Show only when at least one delivery exists:
- Primary button with send icon: שליחת המסלול לשליח בוואטסאפ. It copies the complete route and opens WhatsApp recipient selection.
- Secondary button with copy icon: העתקת המסלול. Success toast: הועתק.
- Helper copy: לוחצים, בוחרים את השליח באנשי הקשר — והוא מקבל את כל התחנות עם ניווט, טלפונים וכמה לגבות.

3. Statistics
Show three stat cards:
- משלוחים
- איסוף עצמי
- לגבות בדרך

4. Ordinary delivery stop card
Each stop has:
- Prominent route sequence number.
- Time and customer name: {שעה} · {שם}, or name only when time is missing.
- Status badge.
- Payment state: לגבות N$, שולם, or blank.
- Destination name, optional address, and service date when the selected range includes multiple dates.
- Button with navigation icon and label ניווט; opens Google Maps.
- Conditional phone link with phone icon.
- Conditional icon-only WhatsApp button with tooltip וואטסאפ; opens this customer's chat without prefilled text.
- Icon-only edit button with tooltip עריכת הזמנה; opens the order editor.

5. Grouped delivery stop card
Visually distinguish a shared stop with a restrained accent border.
- One sequence number.
- Group name with users icon.
- Group-level collection total or שולם.
- Unique destinations and first navigable address.
- One member row per order with time, customer name, status, optional date, and individual amount to collect.
- One shared navigation button using the first valid destination.
- One phone link per group member who has a phone.
- Do not add WhatsApp or edit buttons to individual grouped members.

6. Pickup section
Section title: איסוף עצמי (N).
Each pickup card shows:
- Customer name.
- Status badge.
- Payment or collection state.
- Conditional phone link.
- Icon-only edit button with tooltip עריכת הזמנה.

7. Empty states
- No dated orders: עדיין אין הזמנות עם תאריך. ברגע שיהיו — כאן יופיע כל יום המשלוחים: תחנות, ניווט ושליחת מסלול לשליח.
- No deliveries and no pickups in the selected range: אין משלוחים בתקופה הזאת.
- Pickups exist but no deliveries: אין משלוחים בתקופה הזאת — רק איסופים עצמיים.
- Hide route action buttons and route helper when no deliveries exist.

Status presentation:
- מוכנה: positive green.
- אושרה and במשלוח: warm accent.
- נמסרה: muted.
- חדשה: urgent but not visually aggressive.
- Cancelled orders do not appear.

Design desktop 1440px, tablet 768px, and mobile 375px as one responsive React-ready screen. On mobile, delivery actions must remain thumb-friendly and no table may overflow without an intentional horizontal-scroll treatment. Do not create additional screens.
```

---

## Prompt 3 of 5 — Finance

```text
Create exactly one new responsive application screen named "Finance" in the existing Bat Melech project.

Reuse the current project theme and application shell exactly. Do not modify the theme. Full Hebrew RTL interface. Never use emoji; use the existing Iconify/Lucide icon family. Use anonymized mock data only. This is an operational view for a small food business, not an accounting suite, so keep it exceptionally clear and simple.

Existing navigation labels: היום, הזמנות, הזמנה חדשה, סיכום הכנות, משלוחים, כספים, לקוחות, הגדרות וגיבוי. Mark כספים as active.

1. Month control
- Label: חודש.
- Select options formatted MM.YYYY.
- Changing the month immediately updates every total and table.
- Do not invent date-range filters, export buttons, charts, invoices, or accounting features.

2. Page heading
- כספים — MM.YYYY.

3. Statistics grid
Show five cards in this exact order:
- הכנסות
- הוצאות (קניות)
- נשאר ביד
- ארוחות זוגיות
- עוד לא נגבה
- Use a positive color when נשאר ביד is zero or above and a negative color when below zero.

4. Daily finance card
Title: לפי ימים.
Helper copy: בעמודת «הוצאות» מקלידים כמה עלו הקניות לאותו שישי — והרווח מתעדכן לבד.

Table columns:
- יום
- הכנסות
- הוצאות ($)
- רווח

Behavior:
- One row for every active order date or expense-only date in the selected month.
- The expense cell contains a decimal numeric input with placeholder 0.
- Editing an expense autosaves and immediately recalculates that day's profit, total expenses, and total remaining profit.
- Zero or invalid values are treated as no expense.
- Show visible focus, editing, saving, saved, and validation-error states without adding a manual Save button.
- Final row label: סה״כ.
- Currency uses readable English numerals followed by $.
- Profit is positive color when zero or above and negative color when below zero.

5. Top customers card
Title: הלקוחות הגדולים של החודש.
- Show only when the selected month has active orders.
- Show up to five ranked rows.
- Each row contains rank number, customer name, and total order value.
- No customer-management actions belong in this card.

6. Empty state
When there are no dated orders and no expense entries, show only a clean empty state with finance icon and this exact copy:
- עדיין אין נתונים.
- ברגע שיהיו הזמנות — כאן יופיע כמה נכנס, כמה יצא, וכמה נשאר ביד.

Build one responsive React-ready screen for desktop 1440px, tablet 768px, and mobile 375px. On mobile, transform the daily table into readable stacked rows if needed instead of shrinking the text. Do not create additional screens and do not add functionality that is not listed here.
```

---

## Prompt 4 of 5 — Customers

```text
Create exactly one new responsive application screen named "Customers" in the existing Bat Melech project.

Reuse the project's current theme, application shell, RTL layout, typography, spacing, cards, button variants, and existing Iconify/Lucide icon family. Do not create or modify the theme. Never use emoji characters. All visible copy is Hebrew. Use anonymized sample names and masked phone numbers only.

Existing navigation labels: היום, הזמנות, הזמנה חדשה, סיכום הכנות, משלוחים, כספים, לקוחות, הגדרות וגיבוי. Mark לקוחות as active.

1. Search
- Live search input at the top.
- Placeholder: חיפוש לקוח לפי שם או טלפון...
- Include a search icon inside the input.
- Search matches customer name, phone, and saved notes.
- Provide clear focus and clear-search states.

2. Customer card list
Sort VIP customers first, then all other customers by most recent order.

Every customer card contains:
- Customer name, or ללא שם if missing.
- Conditional VIP badge with star icon and text VIP.
- Conditional badge הזמנה קרובה when an active current/future order exists.
- Lifetime order total aligned opposite the name; hide it when zero.
- Metadata: N הזמנות · אחרונה: DD.MM.
- Conditional clickable phone link.

3. Customer actions
- Primary button with rotate/copy icon: הזמנה חדשה כמו הקודמת.
  - It creates a new draft from the customer's latest order.
  - The new draft has no order ID, no deposit, and payment state לא.
  - Success toast: הועתק — אפשר לערוך ולשמור כהזמנה חדשה.
- Conditional button/link with message-circle icon: וואטסאפ. It opens the customer's chat.
- VIP toggle button:
  - Inactive label: סימון VIP.
  - Active label: להסיר VIP.
  - Show both visual states without using emoji stars.

4. Customer notes
- One autosaving text input or compact textarea per customer.
- Placeholder: הערות על הלקוח: אלרגיות, העדפות, מה תמיד מזמין...
- Show neutral saving and saved feedback without a manual Save button.
- Allergy text should receive a subtle but clear warning treatment.

5. Order history disclosure
- Collapsed by default.
- Label: כל ההזמנות (N).
- Expanded history is newest first.
- Each order row shows full formatted date, status badge, optional bold total, and optional זוגית ×N.
- Each row has a button: פתיחה. It opens that order for editing.

Status badge values:
- חדשה
- אושרה
- מוכנה
- במשלוח
- נמסרה
- בוטלה
Use icons only from the chosen Iconify set; do not insert emoji into status text.

6. Empty states
- No customers: ספר הלקוחות נבנה לבד מההזמנות. ברגע שתהיה הזמנה ראשונה — הלקוח יופיע כאן.
- No search result: לא נמצא לקוח שמתאים ל־«{חיפוש}».

Design one responsive React-ready screen for desktop 1440px, tablet 768px, and mobile 375px. Customer cards must stay easy to scan on mobile, with actions wrapping into a clear two-row layout when needed. Do not create additional screens or invent CRM features.
```

---

## Prompt 5 of 5 — Settings and Backup

```text
Create exactly one new responsive application screen named "Settings and Backup" in the existing Bat Melech project.

Reuse the existing project theme and application shell exactly. Do not create or alter the theme. Full Hebrew RTL interface. Never use emoji; use the same Iconify/Lucide icon family for all section headers, buttons, warnings, and states. Use anonymized mock data only and never display real customer/order data, credentials, API keys, or database connection values.

Existing navigation labels: היום, הזמנות, הזמנה חדשה, סיכום הכנות, משלוחים, כספים, לקוחות, הגדרות וגיבוי. Mark הגדרות וגיבוי as active.

Page title: הגדרות וגיבוי.

Build these seven sections in this exact order:

1. תקרת עומס
- Numeric input label: מקסימום ארוחות זוגיות לשישי (0 = בלי הגבלה).
- Integer, minimum zero, autosaves.
- Helper: כשקובעים תקרה: במסך «היום» רואים כמה מקום נשאר לכל שישי, ליד כל תאריך מופיע «X/Y זוגיות», ובטופס יש התראה כשתאריך מתמלא.
- Show editing, saving, saved, invalid, and server-error states without a manual Save button.

2. מחירון ותפריט
Helper: כאן עורכים מחירים ומנות לבד — מעלים מחיר, מוסיפים מנות לחגים, מוחקים מה שירד מהתפריט. הכול מתעדכן מיד בכל המסכים.

Always-visible autosaving numeric fields:
- מחיר ארוחה זוגית ($), value 230.
- מחיר חלה נוספת ($), value 10.
- סלטים כלולים בזוגית, value 4.
- דגים כלולים בזוגית, fixed value 2.
- מחיר פילה דג נוסף ($), value 30.

Fish-rule helper, shown directly below these fields:
בכל ארוחה זוגית כלולים שני פילטים, בכל שילוב של מרוקאי וחריימה. כל פילה מעבר לכמות הכלולה עולה 30$. מנת קציצות דגים אחת שווה למנת דג זוגית מלאה.

Collapsible menu categories with item counts:
- סלטים
- ראשונות
- עיקריות
- תוספות
- קינוחים
- אקסטרות ומחירים
- תפריט צהריים

For standard categories:
- Existing item row: fixed item name and icon-only destructive delete button with tooltip מחיקה.
- Add row: input placeholder מנה חדשה... and button הוספה with plus icon.
- Empty-name validation: כותבים קודם את שם המנה.
- Success toast: נוסף לתפריט.

For אקסטרות ומחירים:
- Each row: item name, editable decimal price, icon-only delete button.
- Add row fields: אקסטרה חדשה..., מחיר $, button הוספה.
- Do not include legacy selectable extras named תוספת מנת דג or תוספת קציצות דגים; fish surcharge is calculated only by the fish rule above to prevent double charging.

For תפריט צהריים:
- Item names and structure are fixed.
- Prices, variant prices, optional side prices, and add-on prices are editable.
- Helper: פריטי הצהריים קבועים — כאן עורכים מחירים בלבד (כולל וריאציות ותוספות).

Reset menu action:
- Destructive outlined button with rotate-back icon: חזרה לתפריט המקורי.
- Confirmation dialog: לחזור לתפריט ולמחירים המקוריים? העריכות שעשית לתפריט יימחקו (ההזמנות לא נפגעות).
- The dialog has buttons ביטול and חזרה לתפריט המקורי.
- Success toast: התפריט חזר למקור.

3. תשלומים וקישורים
- LTR URL input label: לינק תשלום (ביט / PayBox / Stripe...). Placeholder: https://...
- LTR URL input label: קישור לטופס ההזמנה ללקוחות. Placeholder: https://...
- Both trim and autosave.
- Show invalid URL, saving, saved, and server-error states.
- Do not show secret values.

4. אזל מהמלאי
- Helper: לוחצים על מנה שנגמרה — היא תסומן בטופס ההזמנה. לחיצה נוספת מחזירה אותה.
- Toggle chip for every current salad, first course, main course, side, and dessert.
- Selected out-of-stock chip is red/muted with a line through the item name and a ban icon.
- Extras and lunch items are excluded.

5. גיבוי ושחזור
This section protects real production customer and order data. Present it as a clearly separated protected area, not as a casual utility.

Actions:
- Primary button with download icon: שמירת קובץ גיבוי.
- Secondary button with copy icon: העתקת הגיבוי כטקסט.
- File picker accepting JSON.
- LTR monospace textarea placeholder: {"orders":[...]}.
- Destructive button: שחזור (מחליף את כל הנתונים הנוכחיים).

Restore states:
- Empty: אין מה לשחזר — קודם לבחור קובץ או להדביק טקסט.
- Invalid JSON: הטקסט לא תקין — זה לא קובץ גיבוי.
- Wrong schema: הקובץ לא נראה כמו גיבוי של המערכת.
- File-loaded toast: הקובץ נטען — עכשיו ללחוץ «שחזור».
- Confirmation dialog: לשחזר N הזמנות? הפעולה תחליף את M ההזמנות הנוכחיות לאחר יצירת נקודת שחזור.
- Dialog actions: ביטול and שחזור הנתונים.
- Loading state while validating and restoring.
- Success toast: שוחזר.
- Failure state must clearly say that no current data was changed.

Design safety contract:
- Never provide a button that deletes the production database.
- Restore must be represented as validated, transactional, and rollback-capable.
- A future implementation must create a restore point before replacement.
- This Sleek screen is visual only and must not call an API or write data.

6. נתוני דוגמה
- Put this entire section behind a visible badge: סביבת בדיקה בלבד.
- Buttons: טעינת נתוני הדוגמה and מחיקת נתוני הדוגמה.
- Show both buttons disabled in production mode with helper: נתוני דוגמה אינם זמינים בסביבת הייצור.
- Never imply that this action can remove real orders.

7. מצב נוכחי
Show:
- N הזמנות שמורות.
- גיבוי אחרון: {תאריך} or עוד לא נעשה.
- Synchronization state: מסונכרן, מסנכרן, or הסנכרון אינו זמין.
- Neutral helper: הנתונים מסונכרנים למערכת. גיבוי ידני מאפשר שחזור מבוקר.
- Do not claim that data is stored only in the browser; production uses server and PostgreSQL synchronization.

Create one responsive React-ready screen for desktop 1440px, tablet 768px, and mobile 375px. Long menu sections must remain usable on mobile. Destructive controls must never sit next to common autosave controls without separation and confirmation. Do not create additional screens.
```

