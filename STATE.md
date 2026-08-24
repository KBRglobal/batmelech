# STATE — batmelech (updated: 2026-08-24 07:00)

## Now (in progress)
- ROOT DOMAIN TLS BROKEN (found 2026-08-24): batmelech.ae serves Railway's
  wildcard cert — every browser shows a security warning on the root domain
  (www.batmelech.ae is fine, cert valid). Cause: Railway custom domain never
  verified — DNS at registrar AEserver (rrpproxy NS) has apex A 69.46.46.44
  instead of the required CNAME 80xdnueu.up.railway.app. Plan: move DNS to
  Cloudflare (Moshe's standard) — needs AEserver client-area login (account
  email Linasulin07@gmail.com, saved in Chrome; Moshe must click Login).
  DNS inventory to replicate: apex A (-> proxied CNAME flattening), www CNAME
  cgzhau1p.up.railway.app, TXT _railway-verify=6fa4...; no MX.
- Remote-session merge landed (ca5c68d): Aug-22 cloud work (billing fixes —
  schnitzel side charged, kubbeh; dish-key unification; Mey full-business
  read) merged into local main with Aug-20 order-editor/prep work. One test
  fixture conflict resolved; 888 web + 637 server tests green. NOT yet
  deployed — prod still runs the Aug-20 build; needs Moshe's OK + railway up.
- Old unmerged cloud branch claude/meal-orders-management-system-vdi81y
  (Aug 6): QR codes on vouchers/stickers/flyer + hebcal calendar. Calendar
  exists on main; QR feature does not. 18 days stale, unmergeable as-is —
  re-implement if Moshe wants it, then delete the branch.
- Octypo fleet monitor no longer uses the batmelech Telegram bot (secrets
  deleted from that repo) — Mey's chat gets Bat Melech notifications only.

## Recently done (last ~10, newest first)
- 2026-08-19 Clean root domain (ee1e607): site serves at batmelech.ae/* via
  SITE_PAGE_REGEX mount before the decoy gate; /site page URLs 301 to root
  (assets/files keep /site); dynamic router basename; canonical/hreflang/
  sitemap/llms.txt/robots all point at root. SOURCE of sitemap/llms.txt is
  customer-site/public/ — the vite build overwrites site/ copies.
- 2026-08-19 Railway CLI session died mid-session (their auth had an outage,
  HTTP 500 on device authorization). Recovered via browserless pairing +
  Moshe's CLI login. INVENTORY gap still open: no valid persisted token.
- 2026-08-19 Mobile polish sweep (43cf53d, from 4 audit agents): hero glass
  card removed on phones (text directly on photo + drop-shadow per BRAND.md),
  all CTA pills right-sized, radii scaled down at 390px, compact shabbat-order
  bottom bar, two-row nav, footer 2-col + phone RTL fix + no stray cream band,
  weekdays badge/allergy corner collision fixed, contrast fixes, 44px tap
  targets, iOS: no focus auto-zoom (viewport maximum-scale=1) and chat sheet
  tracks visualViewport so the keyboard never covers the input.
- 2026-08-19 Mobile + allergy round: chat is a full bottom sheet on phones
  (dvh height, header close button, 16px input so iOS stops zooming,
  safe-area padding, toggle hidden while open and on the three bottom-bar
  pages: shabbat-order/extras/checkout); nav header is two rows on mobile
  (links were clipped); allergen coverage in knowledge — full ingredient
  inventory + explicit list of dishes with no recorded recipe, prompt rule
  for real allergy answers. Verified by Playwright screenshots at 390px+1366px.
- 2026-08-19 Concierge follow-ups (this session): geography rule — model places
  hotels itself (Five Palm → Dubai → $15), never "not sure" on known UAE spots;
  WhatsApp handoff is a styled clickable button (AssistantBubble strips raw
  numbers/links, prompt tells model not to spell them; customer-site rebuilt).
- 2026-08-19 Full business knowledge for both assistants (be86443):
  - `server/ai/site-knowledge.js` — one shared knowledge base from live state:
    business facts mirroring the customer site (kashrut, payment, delivery
    fees, Thursday 18:00 cutoff, 24h cancellation, events, plata), package
    rules (couple = 4 salads / 2 fish fillets / 1 main / 1 side / dessert /
    2 challot, site extra prices), live menu with itemMeta descriptions/
    allergens/heating, ordering status + banner + sold-out + closed dates +
    delivery windows + Abu Dhabi minimum, active holiday menus, and dish
    ingredients from state recipes (names only — quantities/costs never leak).
  - Site concierge now answers from that full block (was: 5 facts + bare menu).
  - Mey: 3 new tools — get_business_knowledge (same block), get_dish_recipe
    (full quantities/yield), search_products (supplier pack prices);
    get_menu_and_settings now also returns deliveryWindows/holidayMenus/
    closedDates/minOrderAbuDhabi. Persona: "check tools before saying IDK".
  - set_item_stock now validates names against the real menu: inexact name
    writes NOTHING and returns similar candidates ("כרוב אדום" → asks
    לבן or סגול), per Moshe's explicit ask. Exact-canonical match auto-fixes
    spelling; names only in settings.out stay restorable.
- 2026-08-19 Order deletion + past-service-date filters (6b5307f, 9f788dd)
- 2026-08-18 Food-costing module: product library, recipe costing, cost report (fd9b62e)
- 2026-08-18 batch4 merged: Shabbat closure, invoices, Mey digests, plata, outreach
- 2026-08-18 Delivery-photos gallery

## Next
- Deploy to Railway after Moshe approves; live-verify concierge + Mey answers.
- CONTENT (Moshe/Lin, not code): mains/fish/desserts recipe quantities;
  fill real delivery windows + holiday menus; real dish photos + kashrut cert.
- Moshe undecided: add גזר מגורד / סלט ירוק / טאבולה as catalog dishes.
- KNOWN WEAKNESS (approved, deferred): Mey can't take an order properly —
  doesn't ask date/pickup; orders go in through the panel until fixed.
- Nice-to-have leftovers (NOT ordered): copy-last-year holiday menu,
  multi-currency, image compression, dish of the week, capacity simulation.

## Gotchas / do-not-redo
- Knowledge/business facts in `site-knowledge.js` MIRROR the customer site's
  hardcoded copy (fees $15/$55, Thursday 18:00, $6.25/$25/$45 extras) — if the
  site copy changes, change that file too (single list, commented).
- Site vs panel price mismatch (pre-existing, deliberate handling): site
  builder charges extra salad $6.25 / first $25 / main $45; panel charges
  salad block $25 + single $7 / fish unit $30. Customer-facing knowledge
  quotes SITE numbers only.
- Two holiday schedules coexist by design: closure = Israeli observance
  (shabbat-calendar.js), holiday-menu calendar = Diaspora (hebrew-calendar.js).
- Recipes are keyed by stable itemId; display-name join via
  preparationCatalog.items + menu.itemIds (see displayNamesByItemId).
  Recipe ingredient ids are screen-generated — product join falls back to NAME.
- Concierge grounding: every number the model says must appear verbatim in the
  knowledge block (openai-order-reply.allowedNumberTokens) — new facts with
  numbers must be added there, not in the prompt.
- Seeds run INSIDE the app container (`railway ssh --service app`), Postgres
  has no public URL; SSH key added temporarily and REMOVED after.
- Lin's PDF manual: המדריך-של-לין.pdf (regenerate from scratchpad
  lin-guide-v2.html, session fa280757, headless Chrome).
- Mey wide permissions are audited + undoable; freeze released panel-only.
- Suites: `npm test` at repo root = server tests (608). Web/customer-site
  have their own suites under web/ and customer-site/.
