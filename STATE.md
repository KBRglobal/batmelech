# STATE — batmelech (updated: 2026-08-14 08:10)

## Now (in progress) — real menu editing + R2 image CDN
Menu editing shipped and deployed: Settings → מחירון ותפריט now really edits (prices, dish
names, add/remove dishes), not just displays. The editing engine
(addCatalogItem/removeCatalogItem/addCatalogExtra/updateCatalogExtraPrice/updateLunchPrice/
updateCatalogCorePrice in `web/src/domain/settings-catalog.ts`) already existed and was
already tested — it just wasn't wired to any UI. Added the two functions that were missing
(`renameCatalogItem`, `renameCatalogExtra`), same validation style as the rest.
`docs/menu-source-of-truth-2026-08-14.md` has the exact pricing Moshe dictated live —
cross-checked against `DEFAULT_SETTINGS_CATALOG`, which already matched almost everything
(the customer-site's hardcoded numbers were what was wrong, not the admin defaults — see
Gotchas, customer-site isn't live yet so that rewrite is lower priority).

**R2 infra done, upload pipeline NOT built yet:**
- Bucket `batmelech` created on Cloudflare (account `3151f4ff0858523911e2840f214b123c`),
  public managed domain `https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev`. No custom
  domain (`cdn.batmelech.ae`) — batmelech.ae isn't on Cloudflare DNS at all (zone lookup
  empty), moving nameservers needs explicit approval first, didn't touch it.
- Scoped API token `batmelech-r2` (Object Read & Write, bucket-scoped only, not the shared
  global key) — creds in `~/Documents/creds/batmelech-r2.txt`, also documented in
  `cloudflare.json`. Verified PUT/GET/DELETE working via `@aws-sdk/client-s3`.
- Mirrored as Railway env vars on the `app` service: `R2_ACCOUNT_ID`, `R2_ENDPOINT`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.
  `skip_deploys` was used — nothing in the app reads these yet, they're just staged.
- **Next actual work, not done:** no upload route, no image field on catalog items, no
  admin UI to pick/replace a dish photo, no R2-usage-vs-25GB display anywhere. This was
  infra provisioning only.

**Also queued, fully unstarted:** full per-dish CMS fields (description, ingredient
tags/allergens, on-sale flag, hot/cold, in-stock toggle — the image field belongs here too,
same schema change). AI allergy-detection layer reading the real menu (Lin has her own
OpenAI key already, ~$100/yr, logs in rarely). Telegram notification to Lin on new order. An
admin screen to browse/search/resend past invoices (currently zero invoice UI anywhere in
the panel — invoices only exist as an automatic background email).

## Now (in progress) — disguised staff login, replacing Basic Auth
Moshe's idea, built across one session, third deploy about to go out. The staff panel no longer
shows Chrome's native Basic Auth popup at all. Real entry: **`/admin`** (not indexed, not linked;
`/app` and `/orders/admin` still work as aliases). `/linaya` was tried and scrapped same session —
see Gotchas.

**Two separate decoy pages, two separate endpoints — this split is load-bearing, see Gotchas:**
- `/admin`, `/app`, `/orders/admin`, and the other real protected prefixes (`isProtectedPath` in
  `decoy-auth.js`) show `decoy-gate-page.html` when logged out. Its hidden box posts to
  `POST /api/site/access` (`decoy-login-route.js`) — the REAL two-step login (username, then
  password, same box, wrong either step or expired → fake "ההודעה נשלחה בהצלחה!"). Right twice →
  session cookie `bm_ref` (HMAC-signed, 30 days) → reload lands in `/admin/today`.
- Every OTHER 404 site-wide (typos, bot probes, literally anything unmatched) shows
  `decoy-page.html` instead. Its box posts to `POST /api/site/contact`
  (`generic-contact-route.js`) — NO login capability at all, ever; it only emails the message to
  Moshe via Resend (`traviquackson@gmail.com`, from `noreply@batmelech.ae`) and always returns the
  same fake-success shape. A random broken link can never be used to guess the real login, even by
  coincidence-typing the real username.
- Per-IP lockout on the REAL login only: 3 wrong attempts (either step) → 24h fake-success
  regardless of input, even the correct one. In-memory `Map`, resets on deploy.
- Self-service credentials: Settings → "כניסה לפאנל" section (`staff-login-section.tsx`) lets Lin
  set her own username/password, encrypted with `BM_SECRETS_KEY` (`staff_credentials` table, same
  pattern as the Ziina key). The Railway `BM_USER`/`BM_PASS` pair keeps working UNCONDITIONALLY
  alongside it — Moshe's explicit ask: changing Railway env vars must always stay a working
  recovery key. `decoy-login-route.js` checks both pairs independently per attempt (`source: 'env'
  | 'staff'` in the challenge token) and never lets a password from one pair complete the other's
  username.
- Real logout: `POST /api/auth/logout` clears `bm_ref`; sidebar button in both nav variants
  (`app-shell.tsx`).
- `app.set('trust proxy', 1)` — needed for real per-IP lockout behind Railway's edge; also fixes
  the pre-existing `/api/site/orders` rate limiter, which was silently limiting by Railway's edge
  IP for everyone before this.
- BM_USER/BM_PASS values changed at some point before this session (`lin`/`lin123` from the
  original 2026-08-06 deploy no longer work). Current values live only in Railway env vars, not in
  any memory file.

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
   Gotchas), then verify live: hit `/admin/today` logged-out (must 404-decoy, not redirect to a
   real login), do the real two-step through the actual browser popup-free flow, confirm it lands
   in the real panel. Tell Moshe the live `/admin` URL once confirmed.
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
- customer-site (`customer-site/src/pages/shabbat-order.tsx`, `weekdays.tsx`) has its OWN
  fully hardcoded, disconnected copy of the menu/prices — zero shared code with the admin
  catalog. It's not live (no customer has the link yet per Moshe), so this is lower
  priority than the admin panel, but it has REAL drift already: missing dishes (2 mains, 2
  sides, the full schnitzel-plate, couscous+mafrum), wrong extra-fillet price ($25 vs the
  confirmed-correct $30), and a flat $6.25/salad rate instead of the real $25-per-block-of-4
  + $7-lone-extra rule. `'תוספת 4 סלטים לבחירה'` is NOT a separate purchasable extra
  anywhere — it's `isAutomaticChargeName`-reserved in `order-total.ts` because it's computed
  automatically from salad-selection quantity; don't ever add it as a manual extra (tried
  once this session, `applyCatalogToStore` correctly threw "reserved for automatic
  pricing" — reverted).
- Before touching `DEFAULT_EXTRA_ROWS` again: several entries that look like stale/duplicate
  cruft on first read (two vegetable-soup rows, `סט עריכה`, `תוספת יין`, the standalone
  weekend-challah-schnitzel row) are actually locked in by explicit assertions in
  `settings-catalog.test.ts` (line ~53) — they're deliberate, not leftovers. Don't remove
  without checking that test first.
- Never mount an alias path that overlaps with a real credential value — `/linaya` was tried and
  scrapped the same session because Moshe is folding "linaya" into Lin's new real username. A path
  segment matching part of a live username/password is a leak, not a bookmark.
- The staff login is DELIBERATELY not a login page — do not "fix" `/admin` to show a real login
  form, a 401, or any hint that auth exists. The whole point is that it's indistinguishable from a
  broken link. If it ever looks suspicious to a real 404, that's a regression, not a UX bug.
- Never put `BM_USER`/`BM_PASS`/`BM_SESSION_SECRET` values in a URL, in chat as a clickable link,
  or anywhere Chrome's native Basic Auth would need them — that mechanism is gone. The only way in
  is typing the username then the password into the decoy page's message box, in that order.
- Chrome's browser-automation tool (`mcp__claude-in-chrome__*`) cannot fill native Basic Auth
  popups and refuses any URL with embedded credentials — this was the actual reason the old
  mechanism had to go if Claude needed to self-serve into the panel; keep it in mind before ever
  reintroducing a Basic-Auth-style gate.
- The gate/generic-404 split is load-bearing, not cosmetic: `createDecoyGate` only fires on
  `PROTECTED_PREFIXES` (`decoy-auth.js`) and calls `next()` for everything else, so the REAL login
  endpoint (`/api/site/access`) is only ever reachable from pages that already know a protected
  path exists. Do not merge the two decoy pages or the two endpoints back into one "to simplify" —
  that would make every random 404 site-wide login-capable again.
- Real bug hit and fixed while building this: `contentRoot` in `server.js` is the WHOLE repo
  checkout, not a curated `public/` folder. When the blanket gate got scoped to
  `PROTECTED_PREFIXES`, the final `express.static(contentRoot)` catch-all briefly became reachable
  by anyone unauthenticated — `/server.js`, `/package.json`, `/STATE.md`, etc. would have been
  served as plain static files. Caught by a regression test before deploy (see
  `tests/server-security.test.js`, "never gets repo source files as static content"). That
  catch-all now has its own explicit `hasValidSession` check, independent of `isProtectedPath` —
  if you ever touch the gate scoping again, re-run that test and think through every `app.use`
  mounted between the gate and the final catch-all, not just the ones already in the prefix list.

- `/site` (customer site) and `/app`/`/admin` (admin) both go through `createReactAppRouter` —
  static + SPA fallback. `/site` is mounted BEFORE the decoy gate (public); root `/` decides where
  to send visitors via `hasValidSession(request, SESSION_SECRET)`, not by route order.
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
