# Menu source of truth — dictated by Moshe, 2026-08-14

This is the canonical menu/pricing data, given directly by Moshe in chat (not transcribed
from an image, not guessed). Every price is USD unless stated. This document is the seed
for the shared menu catalog (`bm_state.menu`) that both the admin panel and the customer
site must read from — see `STATE.md` for the architecture decision.

## Weekday menu (מטעמי ימי חול, זמין בימים א'-ה')

### בגט/חלת שניצל ישראלי
Bread choice, customer picks at order time:
- בגט — $25
- חלה — $28

Description/ingredients: שניצל פריך, פיקנטי, חציל מטוגן, צ'רשי (cheese). Served with
homemade pickles (מוגש לצד חמוצים ביתיים).

Also available as a plate (שניצל בצלחת), 3 sizes:
- מנה אישית — כ-3 יח' שניצל — $35
- מנה זוגית — כ-6 יח' שניצל — $60
- מנה משפחתית — זוג+ילד, כ-13 יח' שניצל (תלוי בגודל היחידות) — $145

Plate requires a side choice: אורז לבן / פסטה אדומה / פסטה נקיה.
Family size includes 2 side choices; extra sides available for additional payment.
Note: quantity is approximate, can vary with unit size — show as a note on the item.

### בגט טוניסאי אותנטי — $22
בגט פריך במילוי אריסה (חריפות בינונית), טונה, ביצים קשות, תפוח אדמה רך, לימון בלאדי,
צלפים. מוגש עם חמוצי הבית.

### קובה סלק ביתית — $35
5 יח' קובה עבודת יד במילוי בשר בקר טחון, במרק סלק חמוץ-מתוק עשיר עם עשבי תיבול טריים.
מוגש עם אורז לבן חם וחמוצים ביתיים.

### ספיישל קוסקוס — $35
קוסקוס עננים (רך) לצד מרק ירקות עשיר עם מבחר ירקות טריים ומנת עוף. מוגש עם חמוצים
ביתיים. אפשר להוסיף מפרום ביתי — $20.

### משלוח — $15 קבוע, בכל דובאי (already matches customer-site — no bug here)

---

## Shabbat couple package (מטעמי שבת) — base $230

Business-style couple meal, dishes to choose.

### Included in the base package
- ערכת הדלקת נרות שבת
- זוג חלות ביתיות
- כוס לקידוש + מיץ ענבים
- צלחות, סכו"ם, מפיות (חד"פ)
- פלטה (חד"פ Shabbat hotplate) — **shared inventory across ALL Shabbat orders, only 11
  units exist total**. Order #12 onward for that Shabbat = out of stock. Deposit: **$70**
  (roughly what a replacement plata costs). Disclaimer to show customer: no guarantee the
  hotel will allow bringing it in; bringing/using it is the customer's own responsibility.

### Salads — choose 4, included in base price (17 total options)
כרוב לבן קלאסי, כרוב סגול במיונז, סלט קולסלאו, מטבוחה בחריפות עדינה, צ'ילי טריפולטאי,
משויה מרוקאית, חמוצי מסייר, טחינה, סלק מבושל, גזר מרוקאי מבושל, חציל במיונז, חציל
מטוגן, פלפלים קלויים, עגבניות שרי חריפות, פלפל חריף צלוי, סלט ביצים, סלט תפוח אדמה.

### First course — choose 1, included (מנה ראשונה)
- זוג פילה דג בר ים טרי, עם רוטב לבחירה: חריימה **או** מרוקאי
- **או** קציצות דגים ברוטב מרוקאי

### Main course — choose 1, included (עיקרית), 6 options
קציצות בשר ברוטב אדום עשיר / קציצות בשר עם אפונה וארטישוק / קציצות בשר ברוטב בצל
וערמונים / טבחה עוף אדומה עם שעועית / תביל עוף מרוקאי עם גרגירי חומוס / טבחה עוף צהובה
עם תפוח אדמה.

Main comes with a side, choose 1, included: אורז לבן / אורז פרסי עם עשבי תיבול / קוסקוס
(ללא מרק קוסקוס).

### Upsells (extras, priced add-ons)
| Item | Price |
|---|---|
| צלי בקר פרוס ברוטב פטריות וערמונים (ל-4 אנשים) | $150 |
| מפרום ביתי של אמא (זוגי) | $40 |
| טבחה בשר אדומה עם אפונה ותפוח אדמה (ל-2-3 אנשים) | $100 |
| רולדת בשר פריך לצד רוטב פטריות עשיר | $100 |
| מגש שניצלים זוגי, 13-15 שניצלים | $100 |
| מגש תפוחי אדמה קריספיים | $30 |
| מגש נוסף — אורז / קוסקוס / פסטה אדומה | $25 |
| צלחת פתיחה — זיתים וחמוצים | $15 |
| צלחת חריפים | $15 |
| עוד 4 סלטים לבחירה | $25 |
| חומוס ישראלי | $15 |
| חלה נוספת | $10 |
| מנת ילדים — פסטה אדומה עם שניצלונים | $35 |
| ספיישל הבית — סיר קובה סלק בתוספת אורז (ל-4 אנשים) | $125 |

---

## Known gaps this document is meant to close (from the code audit)

- Admin panel: `extraFishFilletMinorUnits` = $30, but this document never confirmed a
  standalone "extra fish fillet" upsell price — needs to be re-derived from the first
  course choice, not invented separately (see build notes).
- Customer-site's `SALAD_EXTRA_PRICE = $6.25` flat and `FIRST_EXTRA_PRICE = $25` /
  `MAIN_EXTRA_PRICE = $45` flat rates do not appear anywhere in this dictation — Moshe did
  not confirm an "extra salad/first/main beyond the included count" price during this
  session. Do not assume the old customer-site numbers are correct; ask before encoding.
- `'תוספת 4 סלטים לבחירה'` — this dictation gives it as $25 (see Upsells table),
  contradicting the admin panel's current `SUPERSEDED_MANUAL_EXTRAS` block on that exact
  name. The block needs to be reconciled, not silently overridden either way — ask Moshe.
