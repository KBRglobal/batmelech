# STATE — batmelech (updated: 2026-08-14 02:45)

## ⚠️ batmelech.ae has never actually pointed at Railway — found and reported, not fixed
Checked because the site felt broken while testing tonight. `batmelech.ae`'s DNS (registrar:
rrpproxy.net/aeserver.com backend, an .ae-specific registrar — NOT Cloudflare, NOT GoDaddy,
no credential for it anywhere in `~/Documents/creds/`) has a plain A record to a DigitalOcean
IP serving a generic AEserver parking page over HTTP; HTTPS is closed entirely. Railway's own
custom-domain record (`domain_status` for `batmelech.ae`) shows `Verified: no`, cert stuck
`VALIDATING_OWNERSHIP`, and the CNAME it wants (`→ 80xdnueu.up.railway.app`) was never added.
This isn't a regression — it looks like it was **never** correctly configured. The real,
working site right now is only reachable via the Railway-issued domain:
`https://app-production-e89e.up.railway.app` (+ `/site`, `/admin`, etc.) — all testing tonight
was done there. **Fix needs whoever holds the .ae registrar login** (not identified — ask
Moshe) to add a CNAME `batmelech.ae → 80xdnueu.up.railway.app` (and same for `www`). This is a
real platform wall, not something skippable with an API key.

## Now (in progress) — Shabbat menu split + מיי (Mey), Lin's Telegram AI assistant
Built and deployed tonight (2026-08-14), live on the Railway domain above.

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
  `get_recent_orders`, `get_menu_and_settings`). **Bounded write, exactly 3 actions** —
  deliberate safety boundary from Moshe, don't widen without his explicit sign-off:
  `set_item_stock` (adds/removes a name from `settings.out`, the SAME list the admin's
  existing out-of-stock UI already reads — did NOT invent a parallel field, see Gotchas),
  `set_ordering_open`, `set_site_banner`. Everything else (price, menu structure, any message
  that goes out to real customers) she can only suggest — Lin does it herself.
- Backend for the last two: `web/src/domain/store.ts` `LegacySettingsSchema` gained
  `orderingOpen`/`siteBanner`; `server/business-actions.js` has the load-mutate-save-with-retry
  helpers (same pattern as `site-order-route.js`); new public `GET /api/site/status` exposes
  all three read-only. **Not yet consumed by customer-site** — no banner shown, no
  ordering-closed gate, no sold-out badge on the storefront yet. That's the concrete next step
  if this should actually affect what customers see, not just what Lin can ask about.
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
1. **Get the .ae registrar login and fix batmelech.ae's DNS** — the real domain has likely
   never worked over HTTPS. This is the highest-priority item; everything else "live" tonight
   is only live on the Railway subdomain.
2. Wire `/api/site/status` into the customer-site (banner strip, ordering-closed gate on
   checkout, sold-out badge on menu items using `outOfStockNames`) — the backend exists, the
   frontend doesn't consume it yet.
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
