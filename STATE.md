# STATE — batmelech (updated: 2026-08-19, PROJECT HANDED TO LIN)

## Now (start here in a new session)
PROJECT CLOSED AND HANDED OVER (2026-08-19). Everything Moshe ordered is built,
tested, deployed, live-verified. No open engineering tasks. Lin operates the
panel using her illustrated PDF manual (המדריך-של-לין.pdf — 15 pages, real
panel screenshots; source: scratchpad lin-guide-v2.html of session
fa280757-3b5a-4fbd-abdd-e76934527089, regenerate via headless Chrome).

Open items are CONTENT/DECISIONS on Moshe & Lin's side, not code:
- Mains/fish/desserts recipes await Lin's quantities (or ask for
  internet-standard proportions like the salads got).
- Delivery windows + holiday menus are mechanisms — they fill real windows,
  dishes and prices in Settings.
- Real dish photography + kashrut certificate — Moshe's explicit hold.
- Moshe undecided: add גזר מגורד / סלט ירוק / טאבולה as customer-visible
  catalog dishes.
- KNOWN WEAKNESS (approved, deferred): מיי can't take an order properly —
  doesn't ask date/pickup, froze once on a delete request. Orders go in
  through the panel until fixed.
- Nice-to-have roadmap leftovers (NOT ordered, don't start unprompted):
  copy-last-year holiday menu, multi-currency display, image compression,
  dish of the week, capacity simulation, inline-edit-everywhere rollout.

## Session close 2026-08-19 (final)
- **Order deletion** shipped: edit screen bottom section, two-step confirm,
  versioned save (`deleteOrderFromStore` in order-editor.ts, requestId
  `web-order-delete`), recoverable via Settings restore. Verified live on the
  מיי test order — server history showed exactly 13→12 orders.
- **Past service dates excluded** from default shopping list + preparation
  views (`dubaiTodayIso` filter); past dates stay selectable, labeled "(עבר)".
- Lin's PDF manual delivered (also in ~/Downloads/המדריך-של-לין.pdf).

## Session close 2026-08-18 evening (food-costing module shipped)
- Seeded via `scripts/seed-recipes.js` / `seed-recipes-2.js` /
  `seed-spice-prices.js` — idempotent, run INSIDE the app container
  (`railway ssh --service app -- node scripts/...`) because Postgres has no
  public URL. SSH key is added temporarily and REMOVED after every run.
- Products: 53 invoice-based + 28 Rimon spices (rimon.ae/he/collections/spices)
  + celery/OJ/bulgur/breadcrumbs/rice(20kg@150)/semolina. Israel-suitcase items
  (₪≈AED) recorded under the rimon listing. Water = 0 AED, insignificant.
- Recipes: 12 from Moshe's exact quantities + 9 more per Lin's ingredient
  lists with standard internet proportions (Moshe: "היא מבשלת בעין, לך לפי
  מתכון מהאינטרנט"). White-cabbage spec numbers verified live: 7.12/0.71/1.78.
- Mobile: admin shell bottom-bar + עוד sheet; decoy 404 responsive (styling only).
- Kimi (second CLI agent) was stopped mid-session after it reverted/wiped
  parallel work twice — see memory note.

## Shipped 2026-08-18 evening — food-costing module (Claude session, Kimi stopped)
- **Product library** (`web/src/domain/product-library.ts`, screen at
  /settings/product-library): Nesto/Lulu/Rimon pack listings, receipt price
  always wins, kosher→Rimon lock, liter/מ"ל unit family (never converts to
  weight), per-listing price HISTORY (cap 30) + visible last-updated date,
  bulk JSON import section, quick quantity→cost + receipt→correction calculators.
- **Recipe costing** (`recipe-costing.ts`): exact-rational math rounded once,
  per-portion / per-100g / 100-250g salad ladder, optional finishedYieldGrams
  on recipes (real batch weight wins). White-cabbage spec example is a test:
  7.12/kg, 0.71/100g, 1.78/250g.
- **Name-based join**: recipe ingredient ids are screen-generated — costing,
  shopping-list procurement and the report match products by NAME as fallback
  (id wins). `productLibraryMap`/`lookupProduct` in product-library.ts.
  CAUTION: the dual-key map duplicates entries in .values() — iterate raw
  `loadProductLibrary(store).entries` for enumeration.
- **Inline price definition**: an unpriced ingredient row in the recipe editor
  shows a pack/unit/price mini-form; the product rides into store.productLibrary
  through the same recipes save (pendingProducts state).
- **Cost report** (/cost-report, linked from insights+settings): per dish
  (margin where a direct sale price exists), per order (single-order
  buildPreparationPlan trick keeps attribution), per week, monthly expenses vs
  revenue, missing-data panel. Partial data flagged חלקי, never invented.
- **Seeded data**: 53 products from Lin's real Nesto invoices (verified against
  10 receipt PDFs) via the import UI; water at 0 AED, meat/chicken kosher-only
  on Rimon. Recipes guidance changed: record EVERY meaningful ingredient
  (oil/sugar/mayo); shopping list stays clean via the insignificant flag.
- Suites at ship: server 599, web 848, customer-site 5 — green.

## Merged this session — batch4 into main (2026-08-18)
Claude's in-progress `origin/wip/batch4-2026-08-14` branch was merged directly to
`main`, conflicts resolved, full suites green, and deployed live:
- **Shabbat/yom tov site closure** — `server/shabbat-calendar.js`,
  `customer-site/src/components/shabbat-closure.tsx`, blocks checkout during Shabbat/chag.
- **Manual invoice issuing** — `server/business-data/issue-invoice.js`,
  `web/src/screens/new-invoice-form.tsx`; staff can issue an invoice tied to an order
  or free-form.
- **Business digests for Mey** — `server/telegram/business-insights.js`; Sunday weekly
  digest + Wednesday prep forecast, integrated into `delivery-scheduler.js`.
- **Plata (פלטה) rental lifecycle** — `web/src/domain/plata.ts`; count, deposit, status,
  pickup/collection tracking in the order editor and deliveries screen.
- **Customer outreach messages** — `web/src/domain/outreach-messages.ts`; deposit request,
  Google review request, and reorder-invite WhatsApp drafts for Lin.

## Done this session — delivery-photos gallery
- `server/business-data/delivery-photos-route.js`: staff-only `GET /api/delivery-photos`,
  safe field set only, sorted by `deliveryProofAt` desc.
- `web/src/screens/delivery-photos-screen.tsx`: grid gallery with empty state
  "עדיין אין תמונות מסירה", linked from Deliveries screen header.
- Route mounted behind decoy gate; `/api/delivery-photos` added to `PROTECTED_PREFIXES`.
- Tests: `tests/delivery-photos-route.test.js` + `web/src/screens/delivery-photos-screen.test.tsx`.

**Test state:** server 598 pass / 0 fail / 1 skipped, web 832 pass / 0 fail.

## Now — next wave (remaining approved roadmap v3 items, content-independent)
1. ~~Block-a-customer flag~~ — DONE.
2. ~~Closed-day calendar toggle~~ — DONE.
3. ~~Minimum order amount for Abu Dhabi~~ — DONE.
4. ~~Weekly automatic backup to email~~ — DONE.
5. ~~Delivery-photos gallery~~ — DONE.
6. Copy-last-year holiday menu.
7. Multi-currency display USD/EUR/AED.
8. Auto image compression on upload.
9. Dish of the week spotlight.
10. Capacity simulation "can I take 3 more?".

## Previously — build session 2026-08-18
The three ordered flagships from roadmap v3 are BUILT, DEPLOYED and LIVE-VERIFIED,
plus several mid-session asks from Moshe. Details below.

## Shipped this session (2026-08-18, build session — all deployed + live-verified)

### 1. WhatsApp intake flagship (docs/whatsapp-intake-spec.md — fully built)
- **Whole-conversation parsing**: `server/ai/whatsapp-chat.js` parses WhatsApp
  "Export chat" .txt (iOS+Android formats), strips timestamps/media/system lines +
  directional marks into a "Sender: text" transcript. All grounding runs against
  that transcript. Message limit raised 6000→24000 end to end.
- **Panel intake** (`/admin` → import review screen): paste text/whole thread,
  upload the exported .txt, or upload a screenshot (vision transcription via
  `server/ai/openai-chat-image.js`; the route returns the transcript it reviewed
  and the UI shows/stores THAT). Prompt is conversation-aware + any language.
- **Follow-up onto an existing order** (spec E): order editor (edit mode) has
  "פענוח הודעת המשך" → import review with the order as baseDraft → returns to the
  SAME order's edit screen with a delta list ("חלות: 3 ← 5") for approve-then-save.
- **Drafted reply** (spec D): `/api/ai/order-reply` + ReplyDraftBox in the editor —
  reply in the CUSTOMER's language, prices come only from the panel's own pricing
  engine, numeric grounding guard rejects any invented number. Lin's voice stored
  in `settings.waReplyStyle`, editable in Settings → Mey section.
- **Phone-only via Mey** (spec F): forwarded text → Mey tool
  `build_order_from_whatsapp`; exported .txt sent to the Telegram group → handled
  deterministically (webhook document branch), never through agent.reply. Both run
  `server/telegram/whatsapp-intake.js`: catalog projected server-side from live
  state.menu, order saved status חדשה source `mey-whatsapp`, notes carry items/
  unknowns/missing + original conversation; reply includes summary + copyable
  customer reply + panel link. Weekday-lunch items intentionally NOT in the Mey
  catalog (no reliable names in overrides) — they surface as unknownItems.
- **Groups** (spec G): deterministic signal detection adds a warning suggesting
  group-name + duplicate flow. **Memory** (spec H): `order.intakeConversation`
  (same preservation rule as mey* fields — NEVER add to OrderDraft/serialize);
  returning-customer autofill by phone fills name/hotel with an explicit warning.

### 2. Mey wide permissions + audit/undo/freeze (Moshe mid-session: "שליטה כמעט על הכל")
- `server/telegram/mey-audited-actions.js`: update_order_details (whitelisted
  fields), delete_order, edit_menu_item (add/remove/rename, carries itemIds +
  settings.out through renames), set_extra_price, set_base_prices. EVERY write
  appends to `settings.meyAuditLog` (cap 30) with the exact previous value;
  `undo_last_change` / panel undo revert any entry precisely. Creations from
  WhatsApp intake are audited too (undo deletes them).
- **Emergency freeze**: anyone in the chat (or Mey herself on "עצרי הכל"/suspicion)
  can freeze via `freeze_writes`; ALL her writes are blocked while frozen; undo
  still works; UNFREEZING IS PANEL-ONLY (`/api/mey/audit/freeze`) so a compromised
  chat can't lift its own freeze. Mey tool count now 17 (mey-tools.test.js).
- Panel: Settings → "מיי — יומן פעולות ובקרה" (`web/src/components/
  mey-audit-section.tsx`): audit list w/ per-entry undo, freeze toggle, waReplyStyle.

### 3. Kitchen mode (מצב מטבח)
- `https://www.batmelech.ae/kitchen` — SEPARATE low-privilege login (user lin /
  pass lin123; env BM_KITCHEN_USER/BM_KITCHEN_PASS on Railway, code default same).
  Scoped cookie (derived secret — can never be replayed as a staff session, tested).
  Kitchen session can ONLY: read a whitelisted prep projection (`/api/kitchen/state`
  — no names/phones/payments/notes leave the server) and toggle prepDone
  (`/api/kitchen/prep-toggle`). Asset bridge serves the bundle's static files to
  kitchen sessions; extension-less /app paths stay decoy-gated (tested).
- Board: huge type, tap-to-mark-done (same prepDone map as the preparation screen),
  30s auto-refresh, screen wake lock, date chips, progress counter. Admin variant
  at /admin/kitchen (linked from the preparation screen).

### 4. Drag-to-order menu (first concrete case of the inline+drag philosophy)
- Settings → מחירון ותפריט: drag handle + up/down arrows reorder dishes
  (`moveCatalogItem` in settings-catalog.ts). Category array order IS the site
  display order: site pages follow the live catalog order (`orderByCatalog` in
  customer-site catalog-context; shabbat-order already followed live merge order).

### 5. Order-editor pricing UX (Moshe mid-session)
- **Manual price always wins**: MAIN_OVERAGE/SIDE_OVERAGE/DESSERT_UNCLASSIFIED/
  PRICING_ERROR demote to warnings when a DELIBERATE manual total is typed
  (`demotePriceAvailabilityIssues`; a total equal to the computed suggestion does
  NOT count as manual and never unblocks an unpriced overage). Explicit manual-
  price field added next to the % discount.
- **Suggested price is the default**: the total auto-fills and follows the computed
  price until the operator touches the field (then it's theirs; mismatch warning
  asks for explicit confirmation). Footer shows the manual total as the charged
  amount with the computed one secondary.

### 6. Site localization he/en/fr (Moshe mid-session; roadmap deferral overridden by him)
- Hebrew = source of truth at `/site`; native English for AMERICAN JEWS at
  `/site/en`; native French for FRENCH JEWS at `/site/fr`. NOT translation —
  Shabbat not Saturday, Chabbat not samedi (his explicit rule).
- Infra: `customer-site/src/locale-context.tsx` (device-language auto-detect on
  first visit, explicit choice remembered in localStorage `bm-locale`), language
  switcher in nav (עב|EN|FR), per-locale meta + hreflang, `dish-names.ts`
  dictionary keyed by CANONICAL HEBREW names (all catalog/stock/cart/order keys
  stay Hebrew; `CartLine.displayName` is display-only; WhatsApp handoffs include
  Hebrew names in parentheses so Lin always understands).
- **בדיקת סף**: `customer-site/src/localization.test.ts` (vitest, `npm test` in
  customer-site) bans translationese and Hebrew-script leaks per locale. The
  english.zip/france.zip sketches were used as tone references only; facts they
  invented (EAKC cert, Gush Katif) were REJECTED — Hebrew won.

### 7. Security fix (found during live verification, fixed + verified same hour)
- `/api/mey` and `/api/invoices` were missing from decoy-auth PROTECTED_PREFIXES →
  reachable anonymously (invoice list was empty in prod; mey surface exposed <1h).
  Fixed + regression test. **Lesson: every new /api/* mount behind the gate MUST be
  added to PROTECTED_PREFIXES — the gate is allowlist-based.**

### Test/deploy state at session end
Server 435 tests, web 643, customer-site 5 (threshold) — all green. ~5 deploys via
`railway up --service app --detach`, each live-verified (kitchen login flow, gate
coverage, site locales verified in a real browser locally + bundle hash live).

### Not real-world-tested yet
- Mey's new tools + WhatsApp intake in the REAL Telegram group (no synthetic
  message was posted to avoid group noise). First real use = first live test.
- OTA/env unaffected (no mobile app in this project).

## Deferred / open after this session (SUPERSEDED — see "Now" at the top;
## flagships listed here were later built in wave 2; the rest folded into the
## nice-to-have leftovers list)

## Shipped in the second wave (2026-08-18 ~05:00, all deployed + live-verified)
Moshe: "everything is for now except real photos." Built, tested, deployed, verified:
- **Customer tracking page** (`/t/<orderId>/<sig>`, server/track/): signed HMAC link
  (derived 'tracking-scope' secret), server-rendered trilingual status page
  (timeline, courier ETA when fresh, proof photo after delivery, NO PII/prices),
  generic 404 on anything invalid; staff mint endpoint `/api/tracking-link/<id>`
  (gated) + copy button in the order editor's edit-mode section.
- **Site concierge chat** (server/ai/concierge-*, customer-site concierge-chat.tsx):
  public POST /api/site/concierge, 20/15min/IP, answers in the visitor's language
  from live-catalog knowledge + fixed facts only, number-grounding guard; floating
  widget on every site page, 3 locales.
- **Deliveries map + drag route** (leaflet dep in web/): numbered pins + polyline
  from hotel coords, OSM tiles; manual drag route override persisted per date in
  `settings.routeOverrides` with "חזרה לסדר המוצע"; route-order.ts applyRouteOverride.
- **Delivery time windows** (server/delivery-windows.js): settings.deliveryWindows
  [{key,start,end,capacity}], public availability endpoint, checkout window picker
  (3 locales, fail-open), race-safe capacity 409 inside the save-retry loop, admin
  editor section in Settings (`/api/settings/delivery-windows`).
- **Jewish holidays** (server/holidays/): pure Intl Hebrew calendar (keyed by ICU
  month NAMES — leap-year safe; verified live: Rosh Hashanah 2026-09-12), public
  /api/site/holidays, holiday menus CRUD (gated /api/holidays) stored in
  settings.holidayMenus with publish windows + order cutoffs, admin section, festive
  site section on home (3 locales, dishes → cart with canonical Hebrew names).
- **Kitchen v2** (Moshe: statuses, everything one-tap, simplest UI): per-dish stage
  cycle on tap — התחלתי להכין → מוכן → ארוז ('packed' stored as boolean true so the
  preparation screen still sees completed; intermediates are strings in prepDone —
  operational-state now tolerates them); orders board with one-tap status chips;
  /api/kitchen accepts kitchen OR staff session; projection now includes
  name/time/hotelName (still no phones/payments/notes).
- **Orders screen**: in-place editing (name/date/time/total, pencil→input→✓/Esc)
  via bounded applyOrderFieldEdit; Excel export of the filtered table; group frames
  now UNMISSABLE (thick colored border + tinted surface + side ribbon, stable color
  per group name).
- **Excel exports** (services/table-export.ts CSV+BOM) on customers + finance;
  **new-order browser notifications** (bell in the shell, 60s poll, primed silently).
- **SEO/AEO**: trilingual sitemap with hreflang (42 URLs), llms.txt languages
  section, X-Robots-Tag noindex added to /app (was already on /admin//orders/admin/
  /kitchen), robots disallows /kitchen + /t; PROTECTED_PREFIXES extended with
  /api/holidays + /api/tracking-link (+ regression test lists all staff prefixes —
  REMEMBER: every new gated /api/* mount must be added there).
- Suites at ship: server 495, web 673, customer-site 5; all builds green.

### Open after wave 2 (SUPERSEDED — consolidated into "Now" at the top)

## Older context below (2026-08-14)

## מיי identity awareness SHIPPED (2026-08-14 evening)
Every message to מיי now carries a sender line ([השולח: name @username], injected by
webhook-route/mey-agent — system data, not user text). Persona register per person:
Lin (direct boss, no username → default) warmest — endearments/flowers/hearts;
@balmin55 (Felix) delivery-manager mode, concise; @ogind2858 (Moshe) technical boss —
internals/tools talk allowed; "Mr Quackson" in a message = admin code word → full
robotic/technical mode until another speaker. Boundaries explicitly unchanged by
identity — no speaker unlocks out-of-toolset actions. Deployed + verified up.

## Batch 3 SHIPPED (2026-08-14 evening, deployed + live-verified)
Four approved items, built by 4 parallel agents, merged + deployed, verified live (curl:
computed status + reopensOn in /api/site/status, CSP headers present on /site, page renders
clean under CSP in a real browser screenshot — fonts/images/banner all load):
- **Date-aware ordering close**: `settings.orderingClosedUntil` (YYYY-MM-DD Dubai, exclusive)
  — closing via מיי or the panel now means "closed until the upcoming Sunday", reopen is pure
  computation (`effectiveOrderingOpen` in `business-actions.js`), no cron. Legacy
  `orderingOpen` boolean still honored as fallback. Customer banner + מיי both state the
  reopen day. NOTE live state at ship time: `orderingOpen:false, reopensOn:null` — that's the
  LEGACY manual close from before this feature (site not launched yet, intentional); first
  time someone closes via the new path it gets a real date.
- **חשבוניות admin screen**: browse/search all invoices, download PDF, resend by email
  (rate-limited). `web/src/screens/invoices-screen.tsx`, `server/business-data/
  invoice-browse-route.js`.
- **Sold-out badges** on weekdays/shabbat-order/shabbat-extras from live `outOfStockNames`
  (tolerant name matching — site's hardcoded names vs admin catalog names; fails OPEN on
  status-fetch failure, never blocks purchases). `customer-site/src/components/
  out-of-stock-badge.tsx`.
- **CSP on `/site`** (`server/react-app-route.js`, opt-in `securityHeaders` param — ONLY the
  public /site mount, admin untouched): script-src 'self', fonts.googleapis/gstatic,
  supabase + randomuser images, iconify API connect-src, frame-ancestors 'none' + nosniff +
  referrer-policy. Hosts verified against the actual built bundle.
Verified: 390 server + 596 web tests, both builds, deploy SUCCESS.

## Now — Felix delivery coordination SHIPPED (2026-08-14, deployed + live-verified)
Felix (Lin's husband, does all Friday deliveries himself) now has מיי as his delivery
dispatcher. Designed with Opus, built by 6 parallel agents + main-thread integration, merged
`f6ec5d0`, deployed, webhook live-verified (synthetic update → 200, clean logs). What shipped:
- **Proactive scheduler** (`server/telegram/delivery-scheduler.js`, in-process setInterval,
  60s tick, Dubai-timezone): morning digest at 08:00 (deliveries in suggested ROUTE order +
  multi-stop Google Maps link), lead reminder 90min before each delivery (grouped by
  destination), check-in prompt 40min before (inline keyboard: בדרך/מגיע בזמן/מתעכב), late
  escalation 15min past. Idempotency: claim-before-send timestamp markers ON the order
  (meyLeadNudgeAt etc.) via the optimistic-concurrency save — restart-safe, never
  double-sends (a crash between claim and send DROPS one message by design, never doubles).
  Kill switch: Railway env `MEY_DELIVERY_REMINDERS` (currently `on`). Scheduler messages are
  deterministic Hebrew templates (`delivery-messages.js`), never through agent.reply().
- **Inline-keyboard callbacks** (`callback-handler.js`): callback_data `d|<action>|<token>`
  (8-hex meyToken per order — order IDs exceed Telegram's 64-byte cap). מתעכב triggers caring
  delay-advice + offer to DRAFT a customer message (draft-only — the never-message-customers
  boundary is unchanged and restated in the persona).
- **Voice**: Whisper transcription (he), transcript echoed back (`🎤 "..."` + reply) so
  drive-time mis-transcriptions are visible. `transcribe-voice.js`.
- **Photo proof-of-delivery**: upload to R2 first (`r2-storage.js`, @aws-sdk/client-s3, key
  `proof/<date>/<orderId>-<ts>-<rand>.jpg` — random suffix because the bucket is public),
  then 6-rule order resolution (reply-to > caption-name > sole-במשלוח > sole-awaiting-reply >
  sole-remaining > ask-with-buttons via settings.meyPendingProof). Auto-advances to נמסרה
  with one-tap undo restoring exact prior status (`statusBeforeProof`).
- **Live/one-shot location** captured to `settings.meyCourierLocation` (display only).
- **מיי tools**: +get_delivery_day (read), +set_delivery_checkin (narrow write: checkin
  state/ETA/note only) — total 9 tools. Persona: Felix is "המלך שלה" for deliveries; always
  concrete (name+hotel+time+nav link); extracts ETA from Waze phrases; search-first rules.
- **Admin delivery command center** (`deliveries-screen.tsx`): numbered suggested route order
  (`route-order.ts` — time-first, nearest-neighbor tie-break via hotel coords, NO external
  API; researched VROOM/OR-Tools, rejected as fleet-scale overkill), progress strip
  (delivered X/Y, current, next), full-route nav button (plain Google Maps /dir/ URL, no
  key), check-in badges, proof-photo links; read-only proof Section in order editor.
- **Customer checkout hotel search**: existing UAE-bounded Nominatim route
  (`server/hotels/hotel-search-route.js`) now mounted PUBLICLY (before decoy gate, has own
  rate limit) — checkout offers מלון (live search) / כתובת אחרת toggle; site orders now carry
  hotelName/hotelAddress/hotelLatitude/hotelLongitude/hotelProviderId (UAE-bounds validated)
  — feeds route ordering automatically.
- All new state = optional fields in the bm_state JSON blob, zero migration. **HARD RULE
  (enforced by test): the mey*/courier*/deliveryProof* fields must never be added to
  OrderDraft/serializeOrderDraft** — their absence from the draft is what preserves them
  through admin edits.
Verified: 367 server + 581 web tests green, both builds, deploy SUCCESS, webhook 200.
**Not yet real-world-tested: an actual Friday.** First live Friday will reveal noise level —
if the group gets too chatty for Lin, split Felix into his own chat (chatId is a constructor
arg everywhere, config-only change).

## Recently done (2026-08-14) — full site gap audit + fix batch
Moshe asked what Lin needs to be "perfect." He'd separately asked Lin the same question via
מיי, but that answer isn't retrievable — מיי/Telegram (`server/telegram/`) is fully stateless
(`store: false`, no conversation log anywhere). Ran a live two-agent browser scan instead
(customer site + admin panel, real login, desktop + mobile viewport) and fixed everything
buildable in one batch (5 parallel agents + main-thread integration), all merged to `main` and
deployed same day. Verified before merge: `tsc` clean on both frontend apps, 220/221 server
tests + 557/557 admin tests pass, both builds succeed, key fixes confirmed live in a real
browser (cart persistence, unified nav, 404, checkout date/time+currency, scroll-reveal).

**Shipped:**
- Cart persists to `localStorage` (`customer-site/src/cart-context.tsx`) — survives refresh,
  direct URL, new tab.
- `/shabbat-extras` now uses the same standard nav/header as every other page — **Moshe
  explicitly reversed the prior deliberate exception** ("top nav must be identical everywhere,
  including the menu"); don't reintroduce a bespoke header here again without asking first.
- Scroll-reveal (`components/reveal.tsx`) no longer gets stuck permanently invisible after a
  jump-scroll — added a direct `getBoundingClientRect` check on mount as a fallback to the
  IntersectionObserver.
- Real 404 page for unknown `/site/*` URLs (`pages/not-found.tsx`), wired into the router.
- Checkout has required delivery date + time fields (previously missing entirely), passed
  through to the order and into the WhatsApp handoff message. `server/site-order-route.js`,
  `pages/checkout.tsx`.
- Checkout states payment method inline (cash on delivery / bank transfer / Bit / PayBox — the
  real values already used in the admin's order editor, no online payment yet).
- USD currency labeling site-wide (`components/currency-note.tsx`).
- Admin Settings screen gained ordering-open/closed + site-banner controls (previously only
  מיי could see/set `settings.orderingOpen`/`settings.siteBanner` — Lin can now see and
  override them from the panel itself, same fields, same save path).
- Admin Settings' demo-data load/delete buttons gated behind `?dev=1` — gone from Lin's normal
  flow.
- Preparation/deliveries/labels screens no longer default to the earliest date in the data
  (which was pinned to a stale 07.08 demo order) — new `web/src/domain/service-dates.ts`
  picks the soonest non-past date in Asia/Dubai instead.
- Order editor heading shows the customer's name instead of the raw order UUID.
- Shopping-list screen shows an honest empty state ("no recipes defined yet") instead of a
  silent zero when 0 of 66 dishes have a recipe.
- מיי persona fix (deployed same-day as a standalone hotfix ahead of the rest): she has full
  live API access via `search_orders` but wasn't told to rely on it — asked Lin/Moshe for a
  raw order number when told "פליקס בדרך לקטי סוזנה" instead of searching. Persona now
  explicitly requires resolving the customer by name via `search_orders` first, and if truly
  ambiguous, asking by date/hotel/amount — never by ID.

**Investigated, deliberately not changed:**
- The `localStorage` order-PII finding (`batmelech-orders-v1`/`bm-sync-*`, written by the
  legacy `index.html`/`app.html` manager) — confirmed load-bearing: it's the ONLY channel
  between `bm-sync.js` and the legacy app (see Gotchas), and its "never lose the local copy"
  conflict-safety behavior is deliberately tested (`tests/bm-sync.test.js`). Dropping or
  encrypting it would break real functionality for a threat model (same-origin JS reading it)
  that encryption doesn't actually solve — the session cookie needed to decrypt would be sent
  automatically by the same script anyway. **The real gap: `/site` has NO Content-Security-
  Policy at all**, while the two smaller public routes do (`server/customer-order-route.js`,
  `server/public-landing-route.js`). That, combined with the public site sharing an origin
  with the admin's cache, is the actual amplifier. Next real fix, in order of leverage:
  (1) serve the customer site on a separate hostname from admin — kills the whole class of
  risk, needs a real infra/DNS decision from Moshe; (2) add a CSP to `/site` as defense in
  depth (needs browser verification, can break fonts/icons/images — not done live during this
  pass since other agents were actively editing that area).
- 4 "demo" orders in live Postgres (`demo1`-`demo4`) — NOT fake/test data. Code comment in
  `app.html` confirms: "real cases from the Word file" Moshe supplied as reference material,
  loaded into the live DB at some point via the Settings "load demo data" button. Their dates
  are NOT the real historical delivery dates — they're auto-computed as "next Friday from
  whenever load was clicked" (`demo1`-`3` landed on 2026-08-07, already past; `demo4` landed
  on 2026-08-28, artificially in the future). **Moshe confirmed: keep all 4, don't delete.**
  Do not treat them as safe-to-purge seed data in a future pass.

## batmelech.ae DNS — false alarm, tools in this sandbox gave a wrong read
Mid-session (earlier tonight), curl + DNS-over-HTTPS lookups run from this environment showed
`batmelech.ae` resolving to an AEserver parking-page IP with HTTPS closed, and Railway's
`domain_status` API showed the custom domain `Verified: no`. Moshe checked live in a fresh
private tab and confirmed the real site loads fine — sandbox DNS quirk, not real. Don't trust
this environment's raw `curl`/DNS lookups against batmelech.ae again; verify through Moshe or
the Chrome browser tool instead. Railway dashboard still shows the custom domain unverified —
cosmetic, not an active emergency.

## Recently done (2026-08-14, Shabbat menu split + מיי)
Built and deployed same day, live on the Railway domain above.

**Shabbat is now two distinct pages, not one page wearing two hats:**
- `/shabbat-order` — unchanged $230 package builder (salads/first/main/side/dessert, quota +
  overage pricing). `customer-site/src/pages/shabbat-order.tsx`.
- `/shabbat-extras` (nav label "חיזוקים לסופ״ש") — NEW standalone a-la-carte royal menu, built
  from a reference design Moshe supplied (`~/Downloads/custom-shabbat-order/`, not committed —
  it's a mockup, not source). Own sticky header (small logo + back-to-home), not the generic
  PageHero — deliberate, this page is meant to feel like its own dignified screen, not a
  sub-section. Salads (real photos, $6.25 ea) and first courses (real photos, $25 ea) are
  individually addable with visible qty-stepper state. The "royal" section (mains + all the old
  meat-tray/special upsells) is intentionally photo-less premium cards — matches the reference,
  no real photography exists for those dishes yet (see photography gap below), and photo-less
  premium cards read as intentional there, not broken. Desserts are shown as a photo teaser
  linking to the $230 package (no standalone price exists for them — did NOT invent one).
  `customer-site/src/pages/shabbat-extras.tsx`.
- **Pricing note:** salad/first/main à-la-carte prices reuse the existing "extra unit beyond
  package quota" prices (Moshe-sourced numbers, repurposed) — did not invent new numbers for
  anything without an existing price anchor.

**Nav + header rebuilt (was flagged as broken/cramped on mobile):**
- `customer-site/src/components/nav.tsx` — single flex row, never stacks, regardless of
  viewport (root cause of the mobile mess was `flex-col md:flex-row` collapsing to a vertical
  stack with everything centered). Logo (small, links home) always right in RTL flow, nav
  centered (3 links only: יום חול / שבת קודש / חיזוקים לסופ״ש), phone+cart compact icon-only on
  mobile (phone number text hidden below `md`) grouped left. Verified on a genuinely narrow
  real viewport (~500px) via a live screenshot, not just code review.
- Trimmed top nav from 7 links to 3; גלריה/כשרות/עלינו/אירועים/בית dropped from the header but
  still fully reachable from the footer (`footer.tsx` `QUICK_LINKS`, already had most of them,
  added בית + חיזוקים לסופ״ש).

**מיי (Mey) — Telegram AI assistant for Lin, live and tested:**
- `server/telegram/` (mey-agent.js, mey-tools.js, mey-persona.js, send-message.js,
  webhook-route.js). OpenAI Responses API with function-calling, model from `OPENAI_MODEL`
  (`gpt-5.4-mini`), key from `OPENAI_API_KEY` (Lin's own key, already on Railway, was
  provisioned but never wired to code until now).
- **Full read** (orders/customers/menu-overrides/settings via `search_orders`,
  `get_recent_orders`, `get_menu_and_settings`). **Bounded write, 4 direct-execute actions,
  no confirmation step** — widened once tonight (order status, explicitly approved by Moshe
  to skip confirmation), still a deliberate boundary otherwise, don't widen further without
  his sign-off: `set_item_stock` (adds/removes a name from `settings.out`, the SAME list the
  admin's existing out-of-stock UI already reads — did NOT invent a parallel field, see
  Gotchas), `set_ordering_open`, `set_site_banner`, `set_order_status` (only the 5 known
  values the admin panel already uses: חדשה/אושרה/במשלוח/מוכנה/נמסרה,
  `business-actions.js`). Everything else (price, menu structure, any message that goes out
  to real customers, order item/qty edits) she can only suggest — Lin does it herself.
- Backend for the last two: `web/src/domain/store.ts` `LegacySettingsSchema` gained
  `orderingOpen`/`siteBanner`; `server/business-actions.js` has the load-mutate-save-with-retry
  helpers (same pattern as `site-order-route.js`); new public `GET /api/site/status` exposes
  all three read-only. Customer-site now consumes it (`site-status-context.tsx`,
  `components/site-banner.tsx`): a sitewide banner (custom message, or a default "not
  accepting orders" notice when closed) and checkout refuses to submit while ordering is
  closed. Confirmed live: Lin closed ordering via Mey, banner appeared on batmelech.ae
  immediately. Sold-out badges on individual menu items using `outOfStockNames` still not
  wired into weekdays/shabbat-extras — lower priority, add if it comes up.
- Webhook: public route (Telegram must reach it), gated by a random path secret
  (`TELEGRAM_WEBHOOK_SECRET`, set on Railway + in `~/Documents/creds/batmelech-telegram.txt`)
  plus a hard chat_id check against the known "הזמנות" group — anything else is silently
  dropped. Registered live: `curl .../setWebhook?url=https://app-production-e89e.up.railway.app/api/telegram/webhook/<secret>`
  (pointed at the Railway domain, not batmelech.ae — see the DNS issue above).
- **Tested live**: posted a synthetic Telegram update to the webhook, confirmed 200s and no
  server errors in Railway logs. Registering the webhook also delivered a handful of pending
  updates from before registration — a few unexpected מיי replies may show up in the group
  when Moshe/Lin next open it; that's from this test, not a bug.
- **Not done**: proactive reminders (Moshe asked for "delivery needs to go out" / "someone
  ordered a now-out-of-stock item" nudges). Deliberately not built — no clear trigger spec for
  delivery-timing exists in the order model, and guessing wrong on an operational reminder for
  a real business is worse than not having it. The out-of-stock-order case is well-specified
  enough to build on request (periodic scan of new orders vs `settings.out`); ask Moshe for the
  delivery-timing rule before building that half.
- Test coverage: `tests/business-actions.test.js`, `tests/site-status-route.test.js` (13 tests,
  all passing). The agent/webhook layer itself is untested (would need mocking OpenAI +
  Telegram — judged lower value than shipping given the bounded, low-blast-radius tool set).

**Reference repo checked per Moshe's ask ("Israel Restaurant" / `KBRglobal/Israeli_resturant`):**
cloned to scratchpad, inspected, deleted after. Turned out to be a *different* project
("Dubai Kosher E-Commerce Platform", Drizzle/Postgres, WhatsApp checkout, Telr payment) — no
Telegram bot, no AI layer in it at all, contrary to what Moshe remembered. It DOES have the
same out-of-stock/ordering-closed/banner pattern already (Drizzle `siteSettings` singleton +
`productStockOverrides` table) — used as design validation for the pattern above. It also has
a lightweight CRM (`customers`, `customerNotes`, `customerTags`, `activityLog`) — not built
here, but a good future idea if Lin wants to track repeat customers/preferences through מיי.

## Next

### Roadmap v3 — full collected/approved/rejected list lives in docs/product-roadmap-v3.md
Collection-first rule (Moshe, explicit): collect ideas, build ONLY after he says build.
Governing philosophy he chose: inline-edit everything (no edit screens) + drag-and-drop
across the whole system.

### Approved by Moshe (2026-08-18, explicit "כן") — build next
- Full safety net: every saved state change keeps a history snapshot server-side, with an
  admin UI to browse recent versions and restore one in a click ("גם אם תמחקי הכל בטעות,
  שום דבר לא הולך לאיבוד"). Constraint: new table must NOT match the bm_state% name pattern
  (state-repository schema validator throws on unexpected bm_state% relations) — use a plain
  name like state_snapshots with its own migration, per server/business-data/ pattern.

### Blocked on real content from Moshe/Lin — do NOT fabricate, ask/wait instead
- Kashrut page never names the certifying body, rabbi, or certificate — a hard dealbreaker for
  an observant guest. Waiting on the real certification info ("טרם קיבלנו את הכשרות" —
  Moshe confirmed this isn't ready yet, not just unwritten).
- No real food photography anywhere (all placeholder/"תמונה זמנית" or stock-feeling images) —
  same category as kashrut, needs real assets, not invented ones.
- Testimonials on the home page aren't linked to anything verifiable (no Google/Instagram) —
  needs real review links from Lin.
- The 5 experience pages + events page carry zero pricing signal — needs real price anchors
  from Moshe, don't invent numbers.

1. **Big scoped ask from Lin (via Mey) — Moshe said "עוד לא" on 2026-08-14, deferred, do NOT
   start without his go-ahead. When approved: every action gated behind confirm-with-Moshe
   first:** Panel features wanted: edit an existing order (change items/qty without
   cancel+recreate), richer order status pipeline (בטיפול/בישול/ארוז/נשלח), better
   search/filter (date, status, repeat customer, payment method), a day/shift view sorted by
   time, load alerts, a daily digest, a change-history/audit log, and basic inventory
   *quantities*. Mey permissions wanted, ALL behind a new confirmation flow (today's tools
   execute immediately): change order status, edit order details, add/remove menu items,
   update inventory quantities, send an automatic customer message on status change/delay,
   CSV export. Priority: (1) edit order (2) order status (3) search/filter (4) change history.
   Real brainstorm session, not a quick add-on — expands Mey's bounded-write boundary.
2. Ziina: Settings-screen key field (UI only, backend exists) + Payment Intent/checkout button
   — Moshe said "לא" on 2026-08-14 (needs Lin's own Ziina key anyway). Deferred until he asks.
3. SSR/prerendering for the customer site (AEO/crawler gap, noted below).
4. Verify the decoy-login work from the prior session is actually deployed + working live —
   last note said "third deploy about to go out," never independently re-verified.
5. R2 proof-photo polish (custom domain instead of rate-limited pub-*.r2.dev, thumbnails) —
   only if Friday usage shows the need.

## Recently done (2026-08-13/14, newest first)
- Checkout: split phone into a country-code dropdown (+971/+972/+1/+44) + digits, to stop
  UAE/Israel prefix mix-ups. Added a self-pickup option (no delivery fee, no address required)
  — the intake API previously required a non-empty address unconditionally, which would have
  silently dropped pickup orders from the admin panel; fixed in the same pass.
  `customer-site/src/pages/checkout.tsx`, `server/site-order-route.js`.
- Cart became a small persistent floating button (was a full-width bar scoped to one page only
  — items added elsewhere in the site were invisible once you left that page). Also fixed a
  sitewide layout bug: `.page-transition`'s CSS animation held a `transform` via
  `fill-mode: both` even after finishing, which breaks `position: fixed` for every descendant
  on any page taller than the viewport — silently mispositioned every fixed bar on long pages.
  One-line fix in `customer-site/src/index.css` (dropped `both`), fixes it sitewide.
- Menu editing shipped and deployed: Settings → מחירון ותפריט now really edits (prices, dish
  names, add/remove dishes). `docs/menu-source-of-truth-2026-08-14.md` has the exact pricing
  Moshe dictated live, cross-checked against `DEFAULT_SETTINGS_CATALOG`.
- SEO/AEO pass: alt text, per-page meta on route change, sitemap.xml + llms.txt, Kashrut FAQ
  block, `/checkout` noindex.
- Full design-consistency pass: shared `PageHero`, fixed wrong-subject images, deepened hero
  gradient, full footer everywhere.
- New React customer site (home, weekday menu, Shabbat package builder, cart + checkout, story,
  events, 5 experience pages, gallery, kashrut, legal) — source in `customer-site/`, built
  output in `site/`.

## Gotchas / do-not-redo
- **`.page-transition` (customer-site/src/index.css) must never use `animation-fill-mode: both`
  or `forwards` while animating `transform`** — any fill-mode that holds the end-keyframe state
  keeps a `transform` applied indefinitely, which silently breaks `position: fixed` for every
  descendant on any page taller than the viewport (the element ends up positioned relative to
  the animated ancestor, not the real viewport). Cost hours to find tonight because the symptom
  looked like "fixed bars only appear once scrolled all the way down," not an obvious CSS bug.
- The admin's out-of-stock concept already exists as `settings.out: string[]` (item **names**,
  not a boolean field on the catalog item) — matched against `catalog.categories` names, shown
  in the order editor (`web/src/screens/order-editor-screen.tsx`) and toggled in the Settings
  screen (`settings-backup-screen.tsx`, `readSettingsDraft`/`applySettingsToStore` in
  `settings-backup.ts`). Almost duplicated this tonight with a new `inStock` boolean on
  `CatalogItem` before finding the existing mechanism — reuse `settings.out`, don't add a
  second, competing source of truth for the same concept.
- customer-site's package builder (`shabbat-order.tsx`) and weekdays menu still have their OWN
  hardcoded copy of dish names/prices, disconnected from the admin catalog — known, accepted,
  deliberately deferred gap (site wasn't live before tonight; still not fully synced now).
- `PageHero` is the standard hero **every** page uses — no exceptions. The old `/shabbat-extras`
  carve-out (its own bespoke sticky header, "stand alone, dignified") was **removed on
  2026-08-14** on Moshe's explicit instruction that the top nav must be identical on every page,
  menu links included. `/shabbat-extras` now renders `PageHero` like the rest of the site; its
  old hero copy (the "כבודה בת מלך פנימה" quote + the Kosher/Chef/Royal stat row) lives on as
  `PageHero` children. Don't reintroduce a page-specific header anywhere.
- Before touching `DEFAULT_EXTRA_ROWS`: several entries that look like stale duplicates (two
  vegetable-soup rows, `סט עריכה`, `תוספת יין`, the standalone weekend-challah-schnitzel row)
  are locked in by explicit assertions in `settings-catalog.test.ts` (~line 53) — deliberate,
  not leftovers.
- `'תוספת 4 סלטים לבחירה'` is NOT a purchasable extra — `isAutomaticChargeName`-reserved in
  `order-total.ts`, computed from salad-selection quantity. Adding it manually throws
  "reserved for automatic pricing" by design.
- Never mount an alias path overlapping a real credential value (`/linaya` was tried and
  scrapped — Moshe is folding "linaya" into Lin's real username).
- `/admin` is DELIBERATELY not a real login page — never "fix" it to show a real login form,
  401, or any hint auth exists. Looking suspicious to a real 404 is a regression.
- Never put `BM_USER`/`BM_PASS`/`BM_SESSION_SECRET` in a URL or clickable link.
- Chrome browser-automation (`mcp__claude-in-chrome__*`) cannot fill native Basic Auth popups
  or use URLs with embedded credentials — this was the actual reason the old Basic Auth
  mechanism had to go.
- The decoy gate / generic-404 split (`decoy-auth.js` `PROTECTED_PREFIXES`) is load-bearing —
  don't merge the two decoy pages/endpoints "to simplify," that reopens every random 404
  site-wide to login attempts.
- `contentRoot` in `server.js` is the WHOLE repo checkout, not a curated `public/` — the final
  `express.static(contentRoot)` catch-all has its own explicit `hasValidSession` check,
  independent of `isProtectedPath`. Re-run `tests/server-security.test.js` ("never gets repo
  source files as static content") if the gate scoping is ever touched again.
- `/site` and `/app`/`/admin` both go through `createReactAppRouter`. `/site` is mounted BEFORE
  the decoy gate (public); root `/` decides where to send visitors via
  `hasValidSession(request, SESSION_SECRET)`, not route order.
- Railway MCP `deploy` tool ignores .gitignore, tars 350MB+, 502s/hangs. Use
  `railway up --service app --detach` (CLI) instead.
- customer-site is its own Vite/React app (React 19, react-router 7, Tailwind v4).
  `vite.config.ts` builds straight into `../site` — `npm run build` inside `customer-site/` is
  the only step needed for content changes.
- TastyIgniter / ERPNext / Odoo were researched and explicitly rejected — Moshe wants the
  existing Node/Postgres system extended, not replaced. Don't re-propose an external system.
- `server/state/state-repository.js` schema-drift-validates an EXACT Postgres table/column list
  at every boot — throws on any unexpected `bm_state%`-named relation. New tables must avoid
  that naming pattern entirely (see `server/business-data/` for the established pattern:
  plain names, own migration, completely outside that validator). New fields inside the
  existing `bm_state` JSON blob are safe (schema-drift only checks SQL structure, not JSON
  contents) — that's how tonight's `orderingOpen`/`siteBanner`/מיי work was added with zero
  migration needed.
