# Bat Melech Client Requirements — 2026-08-12

This file is the implementation contract for requirements received from the client on 2026-08-12. It supplements the legacy parity matrix. Existing functionality must not be removed merely because it is not repeated here.

## Precedence and money-safety rules

1. The newest, specific fish instruction in this document overrides older fish-extra catalog prices wherever both would charge for the same fish selection.
2. AI may propose an interpretation for operator review, but it may not calculate a price, alter an allowance, save an order, or infer a missing quantity.
3. A deterministic pricing engine must be the only source of suggested totals.
4. The same selected item must never be charged both as an automatic allowance overage and as a manual extra.
5. No production customer or order data may be deleted, seeded, rewritten, or migrated during the React rebuild.

## 1. Order and delivery date

- A new order defaults to the nearest Friday.
- When created on Friday, the default is that same Friday.
- When created after Friday, the default is the following Friday.
- The selected date is shown consistently on the home page.
- The date remains editable per order.

## 2. Brother QL-800 labels

- Preserve the existing label content and information hierarchy.
- Produce a print layout for a 62 mm-wide Brother QL-800 label roll.
- The normal Print action must use the correct label dimensions without manual adjustment on each print.
- Browser and physical-printer checks are required before this is accepted.

## 3. Dubai and Abu Dhabi hotel selection

- Hotel search must cover hotels across Dubai and Abu Dhabi.
- A selected hotel stores its display name, full address, and delivery navigation data such as coordinates or a navigation link.
- Selecting a hotel must not silently erase delivery data the operator already typed.

## 4. Separate lunch menu

Lunch orders reuse the normal customer, address/hotel, date, delivery, label, and payment infrastructure.

| Item | Variant or allowance | Price |
|---|---|---:|
| Authentic Tunisian baguette | — | $22 |
| Israeli schnitzel baguette/challah | Baguette | $25 |
| Israeli schnitzel baguette/challah | Challah; weekend only | $28 |
| Homemade beet kubeh portion | — | $35 |
| Schnitzel plate | Individual | $35 |
| Schnitzel plate | Couple | $60 |
| Schnitzel plate | Family | $145 |
| Couscous special | — | $35 |
| Homemade mafrum add-on for couscous | — | $20 |

Schnitzel-plate side choices are white rice, red pasta, and plain pasta.

- A family schnitzel plate includes two side selections.
- An extra individual side costs $15.
- An extra couple side costs $25.
- Weekend-only challah availability must be visible and validated without silently changing the operator's choice.

## 5. Linked group orders

- Multiple independent family orders can belong to one delivery group.
- Each family keeps its own customer, items, total, and order record.
- The group view shows every family separately, each order total, the group financial total, and the shared delivery destination.
- Editing one family must not mutate another family order.

## 6. Couple-meal allowances

For each couple meal, the included allowance is:

- Four ordered salads.
- Two fish fillet units, in any Moroccan/chraime combination, or one fish-cake portion consuming the same two-unit allowance.
- One main-course portion.
- One side portion.
- Either two souffles or one baklava-candy dessert portion.

Every allowance scales by the number of couple meals. Complimentary salads do not consume the ordered-salad allowance. Every excess selection must be identified explicitly before it contributes to the suggested price.

## 7. Fish pricing — latest authoritative rule

- One couple meal includes two fish fillet units.
- The two units may be one Moroccan plus one chraime, two Moroccan, or two chraime.
- Every fillet unit above `couple meals × 2` costs $30.
- With zero couple meals, every selected fillet unit costs $30.
- One fish-cake portion consumes two included fillet units, which is exactly one couple-meal fish allowance.
- Example: one couple meal plus three fillets produces one $30 overage.
- Example: two couple meals plus four fillets produces no fish overage.
- Example: zero couple meals plus one fillet produces one $30 overage.

The older manual catalog lines `תוספת מנת דג — $35` and `תוספת קציצות דגים — $70` must not also charge for fish already represented by this automatic rule. Their legacy presence remains documented until the migration removes or explicitly repurposes them.

## 8. Salad overage pricing

- Included ordered salads equal `couple meals × 4`.
- Complimentary salads are free and excluded from the allowance calculation.
- Above the allowance, each complete block of four salads costs $25.
- The remaining one to three salads cost $7 each.
- The rule repeats for every additional block of four.

Examples for one couple meal:

| Ordered salads | Extra charge |
|---:|---:|
| 4 | $0 |
| 5 | $7 |
| 6 | $14 |
| 7 | $21 |
| 8 | $25 |
| 9 | $32 |

For two couple meals, the first eight ordered salads are included and charging starts at the ninth.

## 9. Explicit extras catalog

The requested catalog contains:

| Exact client label | Price | Constraint |
|---|---:|---|
| `מרק ירקות לקוסקוס ללא עוף` | $70 | Separate item |
| `מרק ירקות לקוסקוס עם עוף` | $100 | Separate item |
| `תוספת מנת דג` | $35 | Legacy/conflicting fish line; must not double-charge and requires fish choice |
| `תוספת קציצות דגים` | $70 | Legacy/conflicting fish line; must not double-charge |
| `אורז` | $25 | Separate item |
| `פסטה אדומה` | $25 | Separate item |
| `קוסקוס` | $25 | Separate item |
| `מארז הבדלה` | $20 | Separate item |
| `סט עריכה` | $10 | Preserve the exact client label until terminology is confirmed in the UI |
| `תוספת יין` | $5 | Separate item |

Rice, red pasta, and couscous are independent catalog items, not variants of one generic side-extra row.

## 10. Custom items

- An operator can add an item that is absent from the menu.
- The required fields are item name, price, and free-text note.
- Preserve the existing quantity field because removing it would regress current behavior.
- Valid custom items appear in the order and contribute deterministically to the suggested total.

## Acceptance gates

- Every requirement has a row in the legacy parity matrix or a linked new-feature specification.
- Representative legacy orders produce identical totals in the legacy and React engines unless a requirement in this document intentionally changes the result.
- Every intentional price difference is named in a migration report before cutover.
- Saved orders round-trip without dropping unknown legacy fields.
- Concurrent or repeated saves cannot silently overwrite or duplicate an order.
- Human review is mandatory before applying an AI-interpreted customer message.
- No cutover occurs while any requirement, pricing rule, persistence safeguard, or print verification is unproven.
