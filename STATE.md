# STATE — batmelech (updated: 2026-08-14 03:10)

## Now (in progress) — invoicing + payments build, mid-flight
Moshe explicitly rejected installing an external ERP/OSS repo for this (asked directly, confirmed:
extend the existing Node/Postgres system only). Building in increments, each committed once tests
pass. Code for this whole feature is written and defensive (every new route 503s cleanly if its
env var isn't set — nothing here can break the site if left unconfigured).

Shipped and live:
- Order email field (checkout + admin order editor) — `web/src/domain/order-editor.ts`,
  `customer-site/src/cart-context.tsx`.
- Invoice legal settings in admin Settings screen (business name, TRN, address, AED/USD) —
  `web/src/domain/settings-backup.ts` + screen. Lin fills these in herself.
- Customer-site checkout now POSTs orders to `/api/site/orders` (public, rate-limited) which
  appends straight into the same bm_state `orders[]` the admin reads — **this replaces the planned
  BM1-payload approach entirely**; site orders now show up in the admin Orders screen automatically,
  no retyping. WhatsApp message still sends too (primary channel, unaffected).

Written, committed but NOT yet live/configured (this session's WIP, uncommitted at last save):
- `server/business-data/` — new, isolated from the bm_state schema-drift-validated system
  (plain tables: `payment_credentials`, `invoices`, `invoice_number_seq` — NOT `bm_state*`-prefixed,
  so the strict validator in state-repository.js never sees them).
  - `secret-box.js` — AES-256-GCM encrypt/decrypt for Lin's Ziina key. Needs `BM_SECRETS_KEY` env
    (32 random bytes, base64) — NOT SET on Railway yet.
  - `repository.js` — payment_credentials/invoices tables + sequential invoice numbering.
  - `invoice-pdf.js` — renders a VAT invoice PDF (pdf-lib). **English only, on purpose** — pdf-lib's
    standard fonts have no Hebrew glyphs; a garbled Hebrew PDF is worse than a correct English one,
    and English is FTA-accepted. VAT line only shown if a TRN is set; VAT is treated as
    inclusive-in-total (5%). Currency comes straight from the settings toggle, no FX conversion —
    Lin's own convention (she prices in whatever currency she wants and picks the matching label,
    no exchange-rate math happening anywhere).
  - `send-invoice-email.js` — Resend, HTML template in Hebrew (branded, RTL), PDF attached.
    `FROM_ADDRESS` is `invoices@batmelech.ae` — **needs a verified Resend domain, not done yet**
    (see Gotchas).
  - `invoice-trigger.js` — wraps `stateRepository.saveState` (does NOT touch the tested
    state-repository/service/route files) so ANY successful save — admin editor, site checkout,
    backup restore — checks for orders that just flipped `paid` from not-'כן' to 'כן' with a valid
    email, and fires an invoice async (non-blocking, never fails the caller). Idempotent via
    `hasInvoiceForOrder` (checks the `invoices` table, not the order itself).
  - `ziina-key-route.js` — `/api/settings/ziina-key` (admin-only, write-only: POST saves encrypted,
    GET only returns `{configured: boolean}`, never the value). **No admin UI field wired to this
    yet** — needs a small addition to the Settings screen.
- `server.js` — wired all of the above; `pool`/`stateRepository` creation moved earlier so the
  public `/api/site/orders` route can use it before the Basic Auth wall.
- `package.json` — added `pdf-lib`, `resend`.
- All 196 server tests + 548 web tests still pass. Build clean on all three apps.

## Blocked on (external, not code)
1. **Resend domain for batmelech.ae.** The existing Resend account (`maktuba-resend.txt`) is on
   the free plan — 1 domain only, already used by `maktuba.app`. Adding `batmelech.ae` needs either
   a $20/mo Pro upgrade on that account, or a separate new Resend account (Moshe has to create that
   one himself — account creation isn't something Claude does). Moshe's call, not decided yet.
2. **DNS for batmelech.ae is NOT at GoDaddy** — it's managed at aeserver.com (UAE .ae registrar).
   Moshe is logging in himself in a Chrome tab Claude opened; once logged in, add whatever SPF/DKIM
   records Resend's domain API returns for batmelech.ae.
3. **Ziina API key** — Lin already has a Ziina account. She pastes her own key into the (not yet
   built) Settings field once it exists; Claude/Moshe never see the raw value, only "configured: yes/no".
4. Once 1–3 land: set `RESEND_API_KEY` (new/upgraded key) and `BM_SECRETS_KEY` (generate fresh,
   32 random bytes base64) as Railway env vars on the `app` service.

## Next (after the invoicing/payments build lands)
1. Wire the Settings screen's Ziina-key field (UI only — backend route already exists).
2. Ziina Payment Intent creation + checkout button on customer-site (needs Lin's key first).
3. Real food/venue photography for everything still tagged "תמונה זמנית".
4. Resume `wip/auth-boundary` branch when picking that work back up.
5. SSR/prerendering for the customer site — see gap noted below, still open.

## Recently done (2026-08-13/14, newest first)
- SEO/AEO copy + image pass: every hero photo and content image across all 14 pages now has
  descriptive Hebrew alt text (was empty/missing on most — real image-search and accessibility
  gap). Short keyword-rich intro copy added to Weekdays and Shabbat Order (previously thin pages).
  Kashrut page got an FAQ block (Q&A reusing only already-approved facts — helps AI answer engines
  extract facts, doesn't invent new claims). Canonical link, og:url, og/twitter title+description,
  and robots meta now update on every route change (were frozen on the homepage before — told
  crawlers all 13 other pages were duplicates of `/`, a real indexing bug). `/checkout` now sends
  `noindex,nofollow` (transactional page, no search value).
- SEO/AEO baseline: OG/Twitter tags + Restaurant JSON-LD in index.html, per-page title/meta on
  route change, sitemap.xml + llms.txt for the new site, robots.txt references the sitemap.
  Known gap: SPA client-rendering means crawlers that don't execute JS (most AEO/AI bots) still
  see near-empty HTML — real fix needs SSR/prerendering, not done.
- Full design-consistency pass (many small iterative fixes, see git log for detail): every page
  now shares one `PageHero` component — same big floating cream-wordmark logo, same
  backdrop-blur title card, same nav pill + phone badge, only the photo and the color it lets
  through differ. Fixed images that showed the wrong subject (generic table image on a chicken
  dish, indoor Shabbat table in the Desert gallery, Kashrut's certificate bleeding into Legal's
  hero). Deepened the hero gradient's upper zone so the logo stays legible even on light photos
  (Kashrut's was failing). Full footer (logo, nav, contact, Instagram, legal, allergen note) now
  on every page, not just Home/Weekdays. Shabbat headline now matches Weekdays' "מטעמי X" pattern.
- Fixed a real bug found while shipping: `/site` had never actually been public — fell through to
  the Basic Auth wall, so no site could ever go live even with files in the repo. Root now sends
  anonymous visitors to `/site/`; staff with saved Basic Auth land in `/app/today`.
- New React customer site: home, weekday menu, Shabbat package builder (live pricing), editable
  cart + checkout, story, events, 5 experience pages, gallery, kashrut, legal. Source in
  `customer-site/`, built static output committed to `site/`. Old temp scribble archived to
  `site-legacy-scribble/`.
- Parked unfinished auth-boundary work (session/csrf/argon2) to branch `wip/auth-boundary`.

## Gotchas / do-not-redo
- `/site` (customer site) and `/app` (admin) both go through `createReactAppRouter` — static +
  SPA fallback. `/site` is mounted BEFORE the Basic Auth wall (public); root `/` decides where to
  send visitors via `hasValidBasicAuth(request)`, not by route order.
- Railway MCP `deploy` tool ignores .gitignore, tars 350MB+ incl. node_modules, 502s/hangs. Use
  `railway up --service app --detach` (CLI) instead — .gitignore-aware, fast (~1-2 min build).
- customer-site is its own Vite/React app (React 19, react-router 7, Tailwind v4). `vite.config.ts`
  builds straight into `../site` (outDir) — `npm run build` inside `customer-site/` is the only
  step for content changes, no server.js touch needed.
- PageHero (`customer-site/src/components/page-hero.tsx`) is the ONE hero component every page
  must use — do not give a page its own bespoke hero again, that's exactly what broke continuity
  twice today. Gradient recipe and rationale documented in `BRAND.md`.
- TastyIgniter (OSS restaurant ordering) and ERPNext/Odoo (full ERP) were both researched and
  explicitly rejected — Moshe wants the existing Node/Postgres system extended, not replaced. Don't
  re-propose an external system without him asking again.
- `server/state/state-repository.js` schema-drift-validates an EXACT table/column/constraint list
  (`bm_state`, `bm_state_capability`, `bm_state_requests`, `bm_state_versions`) at every boot — it
  will throw and crash startup if it sees ANY unexpected `bm_state%`-named relation. Any new table
  MUST avoid that naming pattern entirely (see `server/business-data/` — `payment_credentials`,
  `invoices`, `invoice_number_seq`, plain names, own migration, completely outside that validator).
  Never try to extend the bm_state system itself for a new feature; it's deliberately rigid.
