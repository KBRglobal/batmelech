# Recipes v2 — Product Library & Procurement (Moshe, 2026-08-18 early morning)

Builds on the recipes-screen redesign (in flight). Collected verbatim from
Moshe's messages; build order comes after the current wave lands.

## Product library (ספריית מוצרים)
Per purchasable ingredient/product:
- Pack size (משקל/כמות האריזה) and unit
- Price per pack, derived price per kg / per unit
- Supplier and last-updated date
- Manual price correction allowed ("לפי קבלה") — a hand-typed price wins and
  is stamped with its own date

## Fixed price sources (exactly two suppliers)
1. Nesto Dubai
2. Rimon Kosher Supermarket

Kosher rule: if a product is kosher-available ONLY at Rimon — auto-select
Rimon regardless of price.

Default supplier by category (Moshe's examples — editable per product):
- Fish → Nesto
- Meat → Rimon
- Breadcrumbs (פירורי לחם) and the like → Rimon

## Shopping list upgrades
- Show HOW MANY PACKS to buy (ceil of required quantity / pack size), not
  just total weight
- Show the price at each supermarket side by side and the cheaper total
  basket
- Waste (%) is applied BEFORE purchase quantities (buy enough pre-cleaning)
- Insignificant-ingredient flag: excluded from the shopping list entirely
- Gram↔kg unify in aggregation (already in the v1 redesign); units that
  cannot combine (יחידה) stay separate lines

## Quick manual price+quantity entry (Moshe, explicit)
- Type a quantity + price manually and get the cost immediately: e.g.
  "120 ק"ג בשר" or "12 ק"ג פירורי לחם" → shows what it costs from the stored
  per-kg price of the chosen supplier.
- Reverse direction too: type what was actually paid for a quantity (from a
  receipt) → the per-kg/per-unit price updates with today's date as a manual
  correction.

## Costing & reporting
- Estimated cost per recipe and per sold product; price-vs-cost margin
- Cost & profit report by dish, by order, and by week (ties into insights)
- Base-recipe sharing (e.g. one sauce used by several dishes) with variants
- Recipe change history with restore (state history already snapshots
  every save — surface it per recipe)
- Preview of the shopping-list effect before saving a recipe
- Anomaly checks: implausible quantity, missing unit, zero yield

## Data notes
- All inside the bm_state JSON blob (settings/productLibrary or a new plain
  table per business-data pattern if it outgrows the blob) — decide at build
  time; zero disruption to recipes Moshe/the bot are entering right now.
- Prices are entered by staff (or later a price-import flow) — the system
  never invents a price.
