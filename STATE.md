# STATE — batmelech (updated: 2026-08-14 00:35)

## Now (in progress)
- Nothing in flight. Customer site v1 live at www.batmelech.ae, unified design pass shipped.

## Next (priority order, per Moshe)
1. **On-page copy pass for SEO/AEO.** Only meta tags/schema were done (see below) — the actual
   visible text (H1s, intros, product descriptions across all 14 pages) has NOT been reviewed for
   keyword coverage or fact-extractability by AI answer engines. Real per-page task, needs a fresh
   session (this one is context-exhausted).
2. **Real order-system connection — the big gap.** Checkout sends a plain WhatsApp text message
   only. It does NOT write the hidden BM1 payload (`order-form.html`'s zero-width-unicode
   encoding), so new-site orders do NOT auto-import into the admin's order-import-review screen —
   Lin would have to retype every order by hand. Two paths were discussed with Moshe:
   (a) implement the BM1 payload encoder in `customer-site/src/whatsapp.ts` so new-site orders
   flow into the EXISTING working admin pipeline (fast, stays in-stack, no new hosting) — study
   `order-form.html`'s `encodeHiddenBM1`/`buildText` functions first;
   (b) adopt TastyIgniter (real OSS restaurant ordering, PHP/MySQL) — rejected earlier as wrong
   stack (separate server, doesn't talk to the Node/Postgres ledger) unless there's an actual
   integration plan. Default to (a) unless Moshe says otherwise.
3. Real food/venue photography for everything still tagged "תמונה זמנית".
4. Resume `wip/auth-boundary` branch when picking that work back up.

## Recently done (2026-08-13/14, newest first)
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
- TastyIgniter (OSS restaurant ordering) was researched and explicitly not adopted — wrong stack.
  Don't re-propose without an integration plan; see "Next" item 1 above for the live decision.
