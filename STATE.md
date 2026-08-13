# STATE — batmelech (updated: 2026-08-13 22:35)

## Now (in progress)
- Customer-facing site v1 built, pushed to branch `feat/customer-site-v1` — not merged to main yet.
  Next step: Moshe reviews live (or locally), then merge to main to go live at /site/.

## Recently done (last ~10, newest first)
- 2026-08-13 New React customer site: home, weekday menu, Shabbat package builder (live pricing),
  editable cart + checkout, story, events, 5 experience pages, gallery, kashrut, legal.
  Orders submit as a WhatsApp message. Source in `customer-site/`, built static output committed
  to `site/` (served as-is by server.js, no build step needed at deploy time).
- 2026-08-13 Old temporary `/site` scribble (kubbe/AED content) archived to `site-legacy-scribble/`,
  not deleted.
- 2026-08-13 Parked unfinished auth-boundary work (session/csrf/argon2, untracked on main) to
  branch `wip/auth-boundary` — was blocking full typecheck/build, not safe to deploy as-is.

## Next
- Moshe: review `feat/customer-site-v1` branch, decide go-live.
- Real food/venue photography — current images are Sleek's placeholder supabase URLs (some
  mismatched to dish names), not ours to depend on long-term.
- Checkout currently sends a plain readable WhatsApp message. It does NOT yet write into the
  hidden BM1 payload format `order-form.html` uses (zero-width unicode encoding) — so orders from
  the new site won't auto-parse into the admin order-import-review screen yet. Needs a follow-up
  pass if that auto-import is wanted for the new site too.
- Resume `wip/auth-boundary` when picking that work back up.

## Gotchas / do-not-redo
- customer-site is its own Vite/React app (mirrors `web/`'s stack: React 19, react-router 7,
  Tailwind v4, TypeScript). vite.config.ts builds straight into `../site` (outDir), so
  `npm run build` inside `customer-site/` is the only step needed — no server.js changes.
- server.js already statically serves the whole repo root as fallback (line ~157) — that's why
  `/site/*` "just works" with zero routing changes.
- Considered adopting TastyIgniter (OSS restaurant ordering, PHP/MySQL) instead of hand-building
  cart/checkout — real allergen/options support, but wrong stack (separate server, doesn't talk to
  the existing Node/Postgres ledger system). Moshe chose: build the frontend in-stack, keep feeding
  the existing WhatsApp pipeline. Don't re-propose TastyIgniter without a stack-integration plan.
