# Product Roadmap v3 — collected with Moshe, 2026-08-18 (night session)

Rules of this list: every item here was explicitly pitched to Moshe and marked
**yes** unless noted. Nothing gets built until Moshe says "build". Items marked
(pending) got no explicit verdict yet. Persona: customers are TOURISTS visiting
Dubai (one-off, from abroad) — not repeat locals. No payments-in-site, no
loyalty club, no Meta/WhatsApp Business API (all explicitly rejected).

## The governing philosophy (Moshe's strongest yes)
**Inline everything.** As much of the panel as possible should be editable in
place — click a field, change it, confirm — no separate edit screens. And
drag-and-drop everywhere it makes sense (menu ordering, priorities, statuses).
This applies across the whole system, and menu ordering on the site is the
first concrete case.

## Flagship features (his highest interest)
- WhatsApp intake, 20 levels up: paste a WHOLE conversation (with corrections),
  paste a SCREENSHOT (vision), voice notes (transcription infra exists), the
  system drafts a reply in the customer's language with price + what's missing,
  and the phone-only flow: forward the message to Mey in Telegram and she
  builds the order and answers with a summary.
- Kitchen mode ("מצב מטבח"): a dedicated full-screen route for a cheap wall
  tablet — today's prep in huge type, tap to mark done (prepDone exists),
  auto-refresh, screen-wake. No new hardware system.
- Jewish holidays: system knows the Hebrew calendar; per-holiday menus with
  their own dishes/prices; auto-publish window on the site; holiday order
  cutoffs; Pesach full menu swap. (Moshe's own idea.)
- Customer tracking page: signed personal link showing live status incl.
  courier-on-the-way and the delivery photo — read-only over data Felix's
  Telegram flow already writes.
- AI dish/recipe suggestions: type a dish name → full recipe + ingredients
  into the recipes screen; quantity scaling by Friday load; cost-based price
  suggestions; data-driven "your best seller deserves a holiday variant".
- Site concierge chat answering in any language from site knowledge
  (server-side OpenAI key exists).
- Delivery time windows with per-window capacity.

## Approved from the 50-idea sweep
Site/customer-facing: visual menu gallery page from catalog photos (1);
smart-basket wizard for tourists — 3 questions → proposed basket (32);
multi-currency display USD/EUR/AED (31); "dish of the week" spotlight (5);
allergen tags shown on site and bon (4); heating instructions per dish
printed on the bon (38); "how it works" page for tourists (46); drag-to-order
menu on site (45 — flagship); auto image compression on upload (48).

Panel/operations: daily deliveries map with suggested route (2); multiple
couriers with per-courier assignment (3); global search from any screen (6);
new-order browser notification (8); Excel export of any table (9); hotel
statistics — which hotels order most (11); returning-tourist autofill by
phone (12); per-category capacity caps (13); popping customer alerts like
allergies on every new order (15); Friday cooking schedule from per-dish prep
times (16); auto-generated menu PDF for WhatsApp sharing (17); quick
"sold out" toggle on the day (24); missing-fields checklist per order (25);
"urgent" flag reordering prep (28); readable activity feed (29); duplicate
detection same phone+date (37); draft orders (36); block-a-customer flag
(34); order hub — everything about one order in one screen (41); capacity
simulation "can I take 3 more?" (42); recycle bin UI over history (43);
phone-calendar (ICS) feed of deliveries (39).

Insights/finance: week-vs-week comparison (14); cancellations analysis (20);
cost vs revenue weekly (23); yearly summary (26); quick quote calculator
(27); Wednesday Telegram reminder digest (35); delivery-photos gallery (33);
copy-last-year holiday menu (30).

Infra: Google Drive backup in addition to email (44); uptime monitoring with
alerts (47); annual archive (26).

## Pending verdict (pitched, no explicit yes/no yet)
- Closed-day toggle in calendar blocking site orders for that date
- Minimum order amount for Abu Dhabi
- Weekly Saturday-night Telegram business summary
- Weekly automatic backup to email
- Google Business presence / SEO push
- Vacation package ("kosher for the whole stay")
- Per-hotel landing pages
- Shabbat clock + candle-lighting + order-cutoff countdown ("טוב אפשר" — minor)

## Explicitly rejected — do not re-pitch
Online payment/of any kind, subscriptions, loyalty/returning-customer
features, message-template library, accountant view-only link, keyboard
shortcuts, demo mode, event-lead management, packaging-supplies inventory,
print-mode for every screen, supplier-split shopping list, PWA home-screen
app, per-dish private quality notes, WhatsApp Business API/Meta anything.

## Deferred by Moshe
- Full localization HE/EN/FR — the goal, explicitly not now.
