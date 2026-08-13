# STATE — batmelech (updated: 2026-08-13 23:10)

## Now (in progress)
- Nothing in flight. Customer site v1 is live in production at www.batmelech.ae.

## Recently done (last ~10, newest first)
- 2026-08-13 Fixed a real bug found while shipping: `/site` had never actually been public — it
  fell through to the Basic Auth wall, so no site could ever go live even though files existed in
  the repo. Root now sends anonymous visitors to `/site/`; staff with saved Basic Auth still land
  in `/app/today`. Deployed via `railway up` (the MCP deploy tool uploaded the full repo incl.
  node_modules — 356MB — and got stuck/502'd twice; CLI `railway up` respects .gitignore and
  worked). Verified live: `/`, `/site/*` deep links, `/new-order` public; `/orders/admin` still 401.
- 2026-08-13 Real photos swapped in where we have them: kubbe salad + pickles (from the old
  site's shoot, in `site-legacy-scribble/assets/food-*.jpg`). Every other dish/menu photo (still
  Sleek stock placeholders) now shows a "תמונה זמנית" badge live on the site.
- 2026-08-13 New React customer site: home, weekday menu, Shabbat package builder (live pricing),
  editable cart + checkout, story, events, 5 experience pages, gallery, kashrut, legal. Orders
  submit as a WhatsApp message. Source in `customer-site/`, built static output committed to
  `site/`.
- 2026-08-13 Old temporary `/site` scribble (kubbe/AED content) archived to `site-legacy-scribble/`.
- 2026-08-13 Parked unfinished auth-boundary work (session/csrf/argon2, untracked on main) to
  branch `wip/auth-boundary` — was blocking full typecheck/build, not safe to deploy as-is.

## Next
- Real food/venue photography for everything still tagged "תמונה זמנית" (most dishes, all 5
  experience pages, testimonials, gallery) — Sleek stock/placeholder for now.
- Checkout sends a plain readable WhatsApp message. It does NOT yet write into the hidden BM1
  payload format `order-form.html` uses (zero-width unicode encoding), so new-site orders don't
  auto-parse into the admin order-import-review screen yet — needs a follow-up pass if wanted.
- Resume `wip/auth-boundary` when picking that work back up.

## Gotchas / do-not-redo
- `/site` (customer site) and `/app` (admin) both go through `createReactAppRouter` — static +
  SPA fallback so client-router deep links don't 404/401. `/site` is mounted BEFORE the Basic Auth
  wall in server.js (public); everything else after it is gated. Root `/` decides where to send
  visitors by checking `hasValidBasicAuth(request)` directly, not by route order.
- Railway MCP `deploy` tool tars the whole given directory, ignoring .gitignore — with
  node_modules committed locally (customer-site/, web/, root) that's 350MB+ and it 502s or hangs.
  Use `railway up --service app --detach` (CLI) instead — it's .gitignore-aware and fast.
- customer-site is its own Vite/React app (mirrors `web/`'s stack: React 19, react-router 7,
  Tailwind v4, TypeScript). `vite.config.ts` builds straight into `../site` (outDir) — `npm run
  build` inside `customer-site/` is the only step, no server.js changes needed for content-only
  updates.
- Considered adopting TastyIgniter (OSS restaurant ordering, PHP/MySQL) instead of hand-building
  cart/checkout — real allergen/options support, but wrong stack (separate server, doesn't talk to
  the existing Node/Postgres ledger system). Moshe chose: build the frontend in-stack, keep feeding
  the existing WhatsApp pipeline. Don't re-propose TastyIgniter without a stack-integration plan.
