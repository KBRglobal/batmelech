# STATE — batmelech (updated: 2026-08-14 07:10)

## Now — full site gap audit for "what does Lin need to be perfect" (2026-08-14)
Moshe said he'd asked Lin (via Mey) what's missing. Turns out that answer isn't retrievable:
Mey/Telegram (`server/telegram/`) is fully stateless — `store: false` on every OpenAI call,
no conversation log anywhere in the DB, filesystem, or code. If Lin answered, it only ever
existed live inside Telegram, unlogged. Ran a live two-agent browser scan instead (customer
site + admin panel, real login, both desktop-code-review and mobile viewport where possible)
and folded every finding into **Next** below, priority-ordered.
One flagged item was checked and ruled a false alarm: it looked like `/` might expose the
admin order board to logged-out visitors, but that was session contamination (two scan agents
shared one Chrome profile). Confirmed via a credentials-omitted fetch: logged-out `/` correctly
redirects to `/site`, never to `/admin`. Real (lower-urgency) finding instead: real order PII
(name/phone/hotel) sits unencrypted in `localStorage` under keys `batmelech-orders-v1` /
`bm-sync-*`, written by the legacy `index.html`/`app.html` manager app. Since `localStorage` is
origin-scoped, not path-scoped, that data is technically readable by any script running on any
`/site/*` public page on the same origin — not a public leak today, but worth encrypting or
moving server-side eventually.

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

### From the 2026-08-14 gap audit — revenue/trust blockers (do first)
- 26/30 images on `/shabbat-order` (the flagship $230 builder) show a "תמונה זמנית" placeholder
  badge — the page customers actually book from looks unfinished.
- Cart is wiped on any page refresh, direct URL, or new tab (React state only, nothing
  persisted) — customer loses their order silently.
- Checkout has no delivery date/time field at all — a customer cannot say which Shabbat or
  what time. No field is `required` either — worth confirming submit can't go out empty.
- Kashrut page never names the certifying body, rabbi, or certificate — a hard dealbreaker for
  an observant guest deciding whether to trust the kitchen.
- `/shabbat-extras`'s only nav control (the back link in its bespoke sticky header) sits under
  the site banner once scrolled — visitor has no way off the page.
- Unknown `/site/*` URLs render a blank white page — no 404 text, no nav, no way out (unlike
  `/admin`, which has a real 404).
- `weekdays`/`shabbat-order`: scroll-reveal cards (`opacity-0` + IntersectionObserver) can get
  stuck permanently invisible after a jump-scroll (hash link, back/forward restore) — confirmed
  reproducible, not a one-off.
- Payment method is never stated during ordering — flow ends as a WhatsApp message with no
  in-flow mention of how/when to actually pay (ties into Ziina items below).

### From the same audit — operational friction for Lin (admin panel)
- No ordering-open/closed toggle or site-banner field anywhere in the admin Settings screen —
  only Mey can set/see them (`/api/site/status` is read-only from the customer-site's side too).
  Lin can't see or override site state from the panel itself.
- Settings screen shows "load/delete demo data" buttons next to real backup/restore — confusing
  for a non-technical operator, and the live DB may currently still hold demo seed orders
  (an order bon showed `demo4` as its order ID — worth confirming the demo data was ever purged).
- Preparation / deliveries / labels screens default to a fixed past date (07.08.2026) instead of
  today or next Friday — Lin has to change it by hand every time.
- Shopping-list feature computes 0 ingredients — 0 of 66 dishes have a recipe defined. Built but
  dormant until someone enters recipes.
- Order editor's page heading shows the raw order UUID instead of the customer's name.

### From the same audit — trust/business polish (medium)
- No real food photography anywhere (all placeholder or stock-feeling images).
- Testimonials on the home page aren't linked to anything verifiable (no Google/Instagram).
- Prices shown in `$` throughout a Dubai business — reads as ambiguous against AED.
- The 5 experience pages + events page carry zero pricing signal (no "from $X/person", no
  minimum guests) — dead-end into a quote request with no anchor.
- `og:image` is a relative path and the logo, not food — WhatsApp link previews (the actual
  order channel) will show no image, or the wrong one.

0. **"Ordering closed" needs to become date-aware, not a plain on/off.** Moshe's ask: closing
   should specifically mean "can't order for the upcoming Friday," with an automatic reopen
   every Sunday for the next cycle — not an indefinite closed state someone has to remember to
   flip back. Today `orderingOpen`/`set_ordering_open` (Mey + `business-actions.js` +
   `/api/site/status` + the customer-site banner/checkout-gate) is a plain boolean with no date
   logic at all. Needs real design: what "Friday" means exactly (this Friday vs. next?), what
   happens to the boolean at Sunday, whether it's a stored reopen-date vs. a recurring rule
   computed from `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Dubai'})` (already used
   elsewhere in this repo for Dubai-local dates, e.g. `site-order-route.js`
   `dubaiDateString`). Don't just bolt a date check onto the existing boolean without thinking
   this through with Moshe first.
1. **Big scoped ask from Lin (via Mey), Moshe said "approve, but every action needs to verify
   with me first" — needs its own real design session, not started tonight (context ran out):**
   Panel features wanted: edit an existing order (change items/qty without cancel+recreate),
   richer order status pipeline (בטיפול/בישול/ארוז/נשלח, not just today's binary), better
   search/filter (date, status, repeat customer, payment method), a day/shift view sorted by
   time, load alerts (too many orders in one time window), a daily digest (order count, meal
   count, top items), a change-history/audit log, and basic inventory *quantities* (not just
   in/out). Mey permissions wanted, ALL gated behind a new confirm-with-Moshe-first step (new
   architecture — today's 3 tools execute immediately, no confirmation flow exists):
   change order status, edit order details, add/remove menu items, update inventory quantities,
   send an automatic customer message on status change/delay, export data to CSV. Priority
   order if not all fits: (1) edit order (2) order status (3) search/filter (4) change history.
   Start this as a proper brainstorm, not a quick add-on — it's a real expansion of Mey's
   bounded-write boundary, which was a deliberate safety choice earlier tonight.
2. Wire sold-out badges on individual menu items using `outOfStockNames` (banner + closed-gate
   already wired, this piece wasn't).
3. Decide with Moshe the exact trigger rule for delivery-timing reminders, then build that half
   of מיי's proactive nudges.
4. Wire the Settings screen's Ziina-key field (UI only — backend route already exists).
5. Ziina Payment Intent creation + checkout button on customer-site (needs Lin's own Ziina key).
6. Real food/venue photography — still needed everywhere tagged "תמונה זמנית", now also for
   every royal-section item on `/shabbat-extras` if Moshe wants photos there eventually.
7. R2 upload pipeline (bucket/creds provisioned, nothing built on top — see Gotchas).
8. Admin screen to browse/search/resend past invoices (still only an automatic background email).
9. SSR/prerendering for the customer site (AEO/crawler gap, noted below).
10. Verify the decoy-login work from the prior session is actually deployed + working live —
    last note said "third deploy about to go out," not independently re-verified tonight.

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
- `PageHero` is the standard hero every page should use — **except** `/shabbat-extras`, which
  intentionally has its own bespoke sticky header per Moshe's explicit ask that it "stand alone,
  dignified," not feel like a generic sub-page. Don't "fix" it to use PageHero.
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
