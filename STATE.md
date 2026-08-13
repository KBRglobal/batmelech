# STATE — batmelech (updated: 2026-08-14 06:40)

## Now (in progress) — disguised staff login, replacing Basic Auth
Moshe's idea, fully built, tests passing, not yet deployed. The staff panel no longer shows
Chrome's native Basic Auth popup at all — anyone hitting a protected route with no session
(`/linaya`, `/app`, `/orders/admin`, `/api/state`, etc.) gets `server/auth/decoy-page.html`: a
branded 404 ("משהו התפקשש במטבח...") with a "שלחו לנו הודעה" contact box that is actually the
login form, disguised. Real path Lin uses day to day: **`/linaya`** (not indexed, not linked from
anywhere, `/app` and `/orders/admin` still work as aliases for old bookmarks).

- Two-step hidden flow, both steps use the SAME visible input box: first message = username
  (`BM_USER`), if correct the box silently resets for a second message = password (`BM_PASS`).
  Wrong at either step (or a fresh/expired session) → same fake "ההודעה נשלחה בהצלחה!" every
  real visitor would see from a normal 404 contact form. Right twice → real session cookie
  (`bm_ref`, HMAC-signed, 30 days) → reload lands in `/linaya/today`.
- `POST /api/site/contact` (public, `server/auth/decoy-login-route.js`) is the actual check.
  Response body never differs in shape between "right, continue" and "wrong" in an obvious way —
  success carries a fake ticket ref (`{status:'received', ref:'RQ-12345'}`), failure omits it.
  Both look like a normal contact-form ack in the Network tab.
- Per-IP lockout: 3 wrong attempts (either step) → that IP gets the fake-success response
  unconditionally for 24h, even with the correct credentials. In-memory `Map`, resets on deploy —
  acceptable for a lockout, not a ban.
- `server/auth/decoy-auth.js` — cookie signing (HMAC-SHA256, `BM_SESSION_SECRET`, new required
  env var, fail-closed like `BM_USER`/`BM_PASS`), `hasValidSession()`, the gate middleware
  (`createDecoyGate`) that replaced the old inline Basic Auth `app.use` block.
- `app.set('trust proxy', 1)` added — needed for real per-IP lockout behind Railway's edge; also
  fixes the existing `/api/site/orders` rate limiter, which was silently limiting by Railway's
  proxy IP for everyone before this.
- `web/src/router.tsx` `AppRouter` now also recognizes a `/linaya` basename (alongside `/app` and
  `/orders/admin`), detected from `window.location.pathname` same as the existing two.
- BM_USER/BM_PASS did NOT change in meaning, only in how they're checked — but the actual values
  changed at some point before this session (`lin`/`lin123` from the original 2026-08-06 deploy
  no longer work). Current real values live only in Railway env vars now, not in any memory file —
  do not hardcode them anywhere else.
- `BM_SESSION_SECRET` already set on Railway (production env, `app` service) via MCP, `skip_deploys`
  so it lands together with this code on the next real deploy, not before.

## Now (in progress) — invoicing + payments build
Moshe explicitly rejected installing an external ERP/OSS repo for this (confirmed: extend the
existing Node/Postgres system only). Full pipeline is coded, deployed, live-tested, and Moshe has
received and reviewed real test emails/invoices via traviquackson@gmail.com.

**Fully working and confirmed live end-to-end:**
- Order email field (checkout + admin order editor).
- Invoice legal settings in admin Settings screen (business name, TRN, address, AED/USD) — Lin
  fills these in herself.
- Customer-site checkout POSTs orders to `/api/site/orders` (public, rate-limited), appending
  straight into the same bm_state `orders[]` the admin reads — **replaces the planned BM1-payload
  approach entirely**. Site orders show up in the admin Orders screen automatically.
- `server/business-data/` — plain Postgres tables (`payment_credentials`, `invoices`,
  `invoice_number_seq`), deliberately outside the bm_state schema-drift-validated system (see
  Gotchas).
  - `secret-box.js` — AES-256-GCM encrypt/decrypt for Lin's own Ziina key.
  - `invoice-pdf.js` — branded VAT invoice PDF (pdf-lib): dark header band with logo, gold "TAX
    INVOICE" label, shaded line-item table, gold-highlighted total row, footer band. **English
    only on purpose** (pdf-lib has no Hebrew glyphs; English is FTA-accepted). VAT line only if a
    TRN is set, treated as inclusive-in-total (5%). Currency = whatever the settings toggle says,
    no FX math anywhere.
  - `send-invoice-email.js` — Resend, table-based **email-safe** HTML (no Tailwind/JS — real inbox
    clients run no JavaScript, an earlier Tailwind-CDN version from Moshe would have rendered
    broken). Warm Hebrew copy, hero photo, delivery-address callout, red no-show/re-delivery-fee
    warning, Shabbat-plata deposit/hotel-coordination note, WhatsApp + "הורדת חשבונית" (download
    invoice) buttons. Every RTL block has explicit `dir="rtl"` + `direction:rtl` (Gmail strips the
    outer `<html dir>`) and punctuation uses numeric character refs so bidi can't flip `?`/`!`.
  - `invoice-download-route.js` — public `GET /invoices/:invoiceNumber/:token.pdf`, regenerates
    the PDF on request from stored fields (no blob storage). Token-gated, not just invoice number
    (numbers are sequential/guessable — token prevents enumerating other customers' PII).
  - `invoice-trigger.js` — wraps `stateRepository.saveState` (doesn't touch the tested
    state-repository/service/route files) so ANY successful save — admin editor, site checkout,
    backup restore — checks for orders that just flipped `paid` to 'כן' with a valid email, and
    fires an invoice async, non-blocking, idempotent via the `invoices` table.
  - `ziina-key-route.js` — `/api/settings/ziina-key`, admin-only, write-only (POST saves encrypted,
    GET returns only `{configured: boolean}`). **No admin UI field wired to this yet** — next task.
- Railway env vars live: `RESEND_API_KEY` (dedicated `batmelech-sending` key, Sending-access scope,
  traviquackson@gmail.com org), `BM_SECRETS_KEY` (32 random bytes base64).
- Resend domain `batmelech.ae` — **Verified** (confirmed by a successful real send). Resend account
  upgraded to paid (Transactional Pro, ~AED 76/mo) — Moshe explicitly approved this exact charge in
  chat before it was clicked.
- Sent 3 real test invoice emails to traviquackson@gmail.com over the course of this build (design
  iteration → RTL/download-link fix); Moshe confirmed the email itself is good.

## Next
1. Deploy the decoy-login work (`railway up --service app --detach` — not the MCP deploy tool, see
   Gotchas), then verify live: hit `/linaya/today` logged-out (must 404-decoy, not redirect to a
   real login), do the real two-step through the actual browser popup-free flow, confirm it lands
   in the real panel. Tell Moshe the live `/linaya` URL once confirmed.
2. Wire the Settings screen's Ziina-key field (UI only — backend route already exists and works).
3. Ziina Payment Intent creation + checkout button on customer-site (needs Lin's own Ziina key,
   pasted into the field from step 2 — Claude/Moshe never see the raw value; Lin has the key and
   was expected to send it the day after the invoicing session).
4. Real food/venue photography for everything still tagged "תמונה זמנית".
5. Resume `wip/auth-boundary` branch when picking that work back up — note it predates the decoy
   login and targeted the OLD Basic Auth mechanism; re-check relevance before reviving it.
6. SSR/prerendering for the customer site — see gap noted below, still open.

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
- The staff login is DELIBERATELY not a login page — do not "fix" `/linaya` to show a real login
  form, a 401, or any hint that auth exists. The whole point is that it's indistinguishable from a
  broken link. If it ever looks suspicious to a real 404, that's a regression, not a UX bug.
- Never put `BM_USER`/`BM_PASS`/`BM_SESSION_SECRET` values in a URL, in chat as a clickable link,
  or anywhere Chrome's native Basic Auth would need them — that mechanism is gone. The only way in
  is typing the username then the password into the decoy page's message box, in that order.
- Chrome's browser-automation tool (`mcp__claude-in-chrome__*`) cannot fill native Basic Auth
  popups and refuses any URL with embedded credentials — this was the actual reason the old
  mechanism had to go if Claude needed to self-serve into the panel; keep it in mind before ever
  reintroducing a Basic-Auth-style gate.

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
