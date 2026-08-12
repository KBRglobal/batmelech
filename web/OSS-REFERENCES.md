# Open-source implementation references

This frontend and its AI boundary intentionally use maintained open-source building blocks instead of custom infrastructure.

| Project | License | Bat Melech usage |
| --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) | MIT | Official React + TypeScript scaffold, build, and development server. |
| [TanStack Query](https://github.com/TanStack/query) | MIT | Server-state cache, retry policy, and future mutation invalidation for the existing `/api/state` contract. |
| [Zod](https://github.com/colinhacks/zod) | MIT | Runtime validation for legacy state and AI structured output without stripping unknown persisted fields. |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | Apache-2.0 | Server-only Responses API client and Zod Structured Outputs helper. |
| [Grocy](https://github.com/grocy/grocy) | MIT | Reference pattern for recipe yield scaling, explicit quantity units, missing-ingredient calculation, and shopping-list generation. |

## Deliberate boundaries

- Deterministic code owns prices, fish allowances, recipe scaling, preparation totals, and shopping quantities.
- AI may interpret ambiguous customer language and flag operational anomalies, but it cannot save orders or change deterministic totals.
- Ingredient quantities are aggregated only when both the ingredient identifier and unit match. No implicit unit conversion is performed.
- Recipe values remain configurable business data. The application does not invent ingredient quantities.

## Rejected direct reuse

- [Mealie](https://github.com/mealie-recipes/mealie) is a strong product reference, but its AGPL-3.0 code is not copied into this project.
- A general unit-conversion package is intentionally not used in the first version because custom kitchen units and silent conversions can create unsafe purchasing totals.
