# Open-source implementation references

This frontend and its AI boundary intentionally use maintained open-source building blocks instead of custom infrastructure.

| Project | License | Bat Melech usage |
| --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) | MIT | Official React + TypeScript scaffold, build, and development server. |
| [React Router 7.18.2](https://github.com/remix-run/react-router) | MIT | Node 20-compatible client routing, typed route parameters, links, and nested layouts for replacing the exported placeholder anchors. |
| [Tailwind CSS 4.3.3](https://github.com/tailwindlabs/tailwindcss) | MIT | Official Vite plugin and compiler for the approved Sleek export's `@theme`, `@utility`, responsive, and print classes. |
| [Phosphor Icons](https://github.com/phosphor-icons/core) | MIT | Inspected local SVG assets exported by Sleek and bundled with the application; no emoji controls or runtime icon API calls are introduced. |
| [TanStack Query](https://github.com/TanStack/query) | MIT | Server-state cache, retry policy, and future mutation invalidation for the existing `/api/state` contract. |
| [Zod](https://github.com/colinhacks/zod) | MIT | Runtime validation for legacy state and AI structured output without stripping unknown persisted fields. |
| [Dinero.js 2.0.2](https://github.com/dinerojs/dinero.js) | MIT | Canonical USD integer-minor-unit representation and safe calculation boundaries for deterministic order pricing. |
| [fast-check 4.9.0](https://github.com/dubzzz/fast-check) | MIT | Generated invariant tests for pricing, allowance, aggregation, and concurrency edge cases. |
| [React Testing Library 16.3.2](https://github.com/testing-library/react-testing-library) | MIT | User-visible React route and component tests through accessible DOM queries instead of component internals. |
| [User Event 14.6.4](https://github.com/testing-library/user-event) | MIT | Realistic click, keyboard, and form interaction simulation for operator workflows. |
| [jsdom 26.1.0](https://github.com/jsdom/jsdom) | MIT | Node 20-compatible browser DOM used only by the frontend test runner. |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | Apache-2.0 | Server-only Responses API client and Zod Structured Outputs helper. |
| [Grocy](https://github.com/grocy/grocy) | MIT | Reference pattern for recipe yield scaling, explicit quantity units, missing-ingredient calculation, and shopping-list generation. |

## Deliberate boundaries

- Deterministic code owns prices, fish allowances, recipe scaling, preparation totals, and shopping quantities.
- AI may interpret ambiguous customer language and flag operational anomalies, but it cannot save orders or change deterministic totals.
- Ingredient quantities are aggregated only when both the ingredient identifier and unit match. No implicit unit conversion is performed.
- Recipe values remain configurable business data. The application does not invent ingredient quantities.

## Rejected direct reuse

- Runtime Iconify string loading is intentionally removed because it retrieves icon data from the public Iconify API in the browser; implemented screens use only the inspected local exports.
- [Mealie](https://github.com/mealie-recipes/mealie) is a strong product reference, but its AGPL-3.0 code is not copied into this project.
- A general unit-conversion package is intentionally not used in the first version because custom kitchen units and silent conversions can create unsafe purchasing totals.
