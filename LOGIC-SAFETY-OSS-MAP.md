# Bat Melech Logic-Safety OSS Map

This document maps every business-critical risk to a maintained open-source implementation or pattern before Bat Melech code is written. Repositories provide proven primitives and architecture; they do not know Bat Melech's private menu rules. Client-specific allowances and prices remain explicit, versioned business data with golden-master tests.

## Non-negotiable invariants

1. Only deterministic code may calculate money, allowances, preparation quantities, recipe scaling, or shopping quantities.
2. AI output is an untrusted review draft. It cannot write state or provide a price used for billing.
3. Every money value is represented as an integer minor-unit amount plus a currency.
4. A save with a stale base version cannot overwrite newer state.
5. Every successful state replacement preserves a recoverable pre-change version.
6. Repeating the same save request cannot create a second logical change.
7. Unknown legacy fields survive validation, merge, save, and restore.
8. A conflict is shown for human resolution; code never silently chooses one customer's order over another.
9. No production cutover occurs until legacy and React calculations are compared over the same fixtures.

## Selected foundations

| Risk area | Proven project | License | Adoption decision | Required Bat Melech proof |
|---|---|---|---|---|
| Money arithmetic | [Dinero.js](https://github.com/dinerojs/dinero.js) | MIT | Use the package with integer minor units and explicit currency. Do not implement a custom money class. | Unit and property tests prove addition, multiplication, discounts/overages, formatting, and totals never use floating-point currency math. |
| Runtime contracts | [Zod](https://github.com/colinhacks/zod) | MIT | Already installed. Use permissive schemas at the legacy storage boundary and strict schemas for commands, recipes, money, and AI output. | Malformed commands fail closed; unknown persisted fields round-trip unchanged. |
| React forms | [React Hook Form](https://github.com/react-hook-form/react-hook-form) and [resolvers](https://github.com/react-hook-form/resolvers) | MIT | Add only when the approved Sleek React components are integrated; connect one Zod schema to both validation and TypeScript inference. | Invalid quantities/prices cannot reach the save command; error focus and draft retention work on mobile and desktop. |
| Server state and cache | [TanStack Query](https://github.com/TanStack/query) | MIT | Already installed. Use explicit mutation keys and no automatic retry for state-changing requests. Invalidate/refetch only after a confirmed server version. | Network retry cannot duplicate or silently replace an order; a conflict does not mutate the cached server state. |
| Commerce workflow patterns | [Medusa](https://github.com/medusajs/medusa) core | MIT/open-core boundary | Adapt the core concepts of idempotent workflows, explicit order versions, order-change records, and reversible steps. Do not import the full commerce platform or enterprise code. | Tests cover duplicate request IDs, version conflicts, status transitions, and a full audit record for every accepted change. |
| Order lifecycle | [XState](https://github.com/statelyai/xstate) | MIT | Use a small explicit state machine only for order/delivery status transitions; do not use it for prices. | Every allowed transition is tested; impossible transitions are rejected and never persisted. |
| Change history and recovery | [PaperTrail](https://github.com/paper-trail-gem/paper_trail) | MIT | Adapt its pre-change-version, event, timestamp, actor, diff, and restore concepts to PostgreSQL. Do not copy Ruby code or add Rails. | A successful create/update/cancel stores the previous version in the same transaction; restore is tested from a disposable database before it is exposed. |
| PostgreSQL access | [node-postgres](https://github.com/brianc/node-postgres) | MIT | Already installed as `pg`. Use transactions and compare-and-swap SQL directly; adding an ORM would add risk without covering a missing primitive. | Concurrent saves yield one success and one conflict, never silent last-write-wins; rollback leaves both current state and history consistent. |
| Recipes and purchasing | [Grocy](https://github.com/grocy/grocy) | MIT | Adapt recipe yield scaling, explicit purchase/stock units, missing-recipe warnings, and aggregation of an existing shopping-list item. | Same ingredient and unit aggregate; different units remain separate; missing/duplicate/invalid recipes are visible and never guessed. |
| Calculation fuzzing | [fast-check](https://github.com/dubzzz/fast-check) | MIT | Add as a development dependency for property-based and model-based tests of pricing, merge, state machines, and races. | Thousands of generated combinations preserve nonnegative totals, allowance monotonicity, immutability, idempotency, and merge symmetry where applicable. |
| AI message interpretation | [OpenAI Node SDK](https://github.com/openai/openai-node) | Apache-2.0 | Use the official server-only Responses API client, `responses.parse`, Zod Structured Outputs, `store: false`, zero SDK retries, and a bounded timeout. | Catalog-only IDs, verbatim evidence, paid-extra verification, ambiguity reporting, refusal handling, no logs, and zero persistence dependency. |
| AI request throttling | [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | MIT | Apply one authenticated-staff quota before the provider call; return a sanitized response and never retry a blocked request. | Request 31 in the configured 15-minute window cannot reach OpenAI or persistence; the response carries `429` and `no-store`. |
| Hotel geocoding | [Pelias](https://github.com/pelias/pelias) | MIT | Define a provider adapter around Pelias-compatible GeoJSON autocomplete/search. Store stable provider ID, label, full address, latitude, and longitude. Never bind business state to one hosted vendor. | Dubai/Abu Dhabi bounds, hotel/venue type, operator confirmation, typed-data preservation, and provider outage fallback are tested. |
| Map display | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause | Use only if the approved design includes a map; coordinates and navigation links remain usable without it. | Selected marker matches saved coordinates; the order still works when map tiles fail. |
| Delivery optimization | [VROOM](https://github.com/VROOM-Project/vroom) | BSD-2-Clause | Future server-side optimizer for vehicles, capacity, priority, service duration, and time windows. Suggestions remain editable and never change orders. | Every job appears exactly once or in an explicit unassigned list; locked stops/time windows are preserved. |
| Travel-time matrix | [OSRM](https://github.com/Project-OSRM/osrm-backend) | BSD-2-Clause | Future routing adapter for road durations/distances supplied to VROOM; never use straight-line distance as a delivery promise. | Invalid coordinates and unreachable routes are explicit; matrix dimensions and stop identities are verified before optimization. |

## Bat Melech rules that no repository can supply

These rules come only from `CLIENT-REQUIREMENTS-2026-08-12.md` and must be encoded as named deterministic functions with examples from the client:

- Two fish fillet units per couple meal, any Moroccan/chraime mix.
- One fish-cake portion consumes the same two-unit allowance.
- Every excess fillet unit costs exactly $30, including when no couple meal is ordered.
- Four ordered salads per couple meal; each complete excess block of four costs $25 and the remainder costs $7 per salad.
- Complimentary salads never consume the paid allowance.
- One main, one side, and either two souffles or one baklava-candy portion per couple meal.
- Exact lunch prices, variants, family-side allowance, extra-side prices, and weekend challah availability.
- Exact explicit extras and the no-double-charge boundary between automatic fish overage and legacy manual fish extras.

Each rule requires example tests, boundary tests, and generated property tests. No model response, repository default, or UI label can override these functions.

## Persistence design adapted from the selected projects

The current single-row state can be made safe without deleting or rewriting production orders:

1. `GET /api/state` returns the state plus its server version.
2. A save carries a unique request ID, the version it was based on, and the base data needed for a three-way merge.
3. The server compares the submitted base version to the current row inside a transaction.
4. If the version matches, the server archives the pre-change state and applies the update atomically.
5. If the version is stale, the server three-way merges only non-overlapping changes.
6. If both sides changed the same order or field differently, the server returns a structured conflict and writes nothing.
7. A repeated request ID returns its prior result and writes nothing again.
8. History is append-only. Restore is a new audited write, never a deletion of history.

This preserves the existing JSON document for compatibility while adding Medusa-style versioned commands and PaperTrail-style recovery. A later normalized schema is optional and cannot be a prerequisite for protecting current customers.

## AI trust boundary

The AI intake request receives only the pasted message and an explicit catalog. Its output must include catalog IDs, quantities, source evidence, ambiguities, corrections, paid-extra candidates, and confidence. The server independently checks that:

- every item ID exists in the submitted catalog;
- every quoted source fragment exists in the customer message;
- every quantity is supported by explicit source evidence;
- every paid-extra price and currency exactly match deterministic catalog data;
- the response cannot call or import persistence code;
- the operator explicitly approves the draft before a separate deterministic command can save it.

Operational AI review receives aggregated preparation/shopping data only, with customer names, phones, addresses, and raw messages removed.

## Printing boundary

[brother_ql](https://github.com/pklaus/brother_ql) confirms QL-800 support and the 62 mm endless-roll geometry, including a 696-pixel printable width at its expected raster resolution. It is GPL-3.0 and Python-based, so its code is not copied into this application. It is used only as a device/geometry reference. The implementation remains a tested 62 mm browser print stylesheet unless a separately licensed direct-print bridge is approved.

## Rejected or deferred choices

| Project/approach | Decision | Reason |
|---|---|---|
| Full Medusa installation | Reject | It would replace the working backend and data model, create a large migration, and add payment/catalog behavior Bat Melech does not need. We adapt its small safety patterns instead. |
| Mealie source code | Reject direct reuse | AGPL-3.0 is incompatible with the intended reuse boundary; Grocy provides the needed MIT recipe patterns. |
| Generic automatic unit conversion | Defer | Kitchen units can be business-specific. Silent conversions can create dangerous purchase totals; conversions require an explicit reviewed table. |
| Temporal | Defer | Excellent durable-workflow project, but operating a Temporal cluster is disproportionate for this small synchronous order system. PostgreSQL transactions and idempotent commands cover the current risk. |
| Public demo geocoder/router endpoints | Reject for production | Demo services provide no availability, privacy, or quota guarantee. Provider adapters must target an approved managed or self-hosted instance. |
| `brother_ql` code | Reject direct reuse | GPL-3.0 and Python runtime do not fit the current browser/Node deployment. Device geometry is reference-only. |
| AI-calculated totals | Prohibited | Nondeterministic output cannot be the source of a customer charge. |

## Cutover gates

- A checked-in legacy feature matrix has no unimplemented row.
- Client requirements have direct tests and no unresolved price conflict.
- All money code uses the selected money primitive and integer minor units.
- Golden legacy fixtures run through both old and new calculators; every difference is intentional and documented.
- Property tests cover pricing, allowances, merging, and state transitions.
- Conflict, retry, disconnect, browser-close, and two-device scenarios are tested without production data.
- A disposable-database restore drill proves state history is recoverable.
- Real Brother QL-800 output is physically reviewed at 62 mm.
- AI drafts are manually reviewed and cannot reach persistence directly.
- The current production route remains on the legacy UI until all gates pass.
