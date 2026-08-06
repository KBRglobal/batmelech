# Page Override — shop

> Overrides `MASTER.md` for this page. Rules here win.

## Style: APPLIED
`Vibrant & Block-based` from Master — bold, block layout, geometric, high colour contrast.
The first build ignored this and shipped a uniform rounded-card grid (generic marketplace).
This build applies it: colour blocks, big type, asymmetric rhythm, flat high-contrast surfaces.

## Colour — OVERRIDE (client-locked brand palette)
Master proposes `#EA580C` / `#2563EB` / `#FFF7ED`. **Not usable.**
The client supplied a fixed brand palette ("צבעי מותג קבועים"). Using Master's colours would
break brand compliance. Mapping instead:

| Master role | Master value | Used here | Brand name |
|---|---|---|---|
| Primary | `#EA580C` | `#8d182c` | wine |
| Secondary | `#F97316` | `#f5a83a` | orange |
| Accent/CTA | `#2563EB` | `#f5a83a` | orange (no blue in brand) |
| Background | `#FFF7ED` | `#f7ece6` | cream |
| Foreground | `#0F172A` | `#3b151a` | ink |
| Muted | `#FDF4F0` | `#edb2c1` | pink |

Master's intent — "appetizing warm primary + strong contrast" — is preserved; only the exact
hexes change. Block-based style is achieved by using these as **full colour fields**, not accents.

## Typography — OVERRIDE (script coverage)
Master proposes Playfair Display SC + Karla. **Neither has Hebrew glyphs.** This site is Hebrew-first
RTL, so they would fall back and lose all styling.
Substituted with the same personality in a Hebrew-covering pair:

| Role | Master | Used here | Why |
|---|---|---|---|
| Display | Playfair Display SC | **Suez One** | High-character Hebrew display; carries the culinary/heritage mood |
| Body/UI | Karla | **Heebo** | Clean Hebrew grotesque, full weight range to 900 for block-style type |

## Layout — APPLIED + constrained
Master pattern is `Hero-Centric + Conversion, CTA above fold`.
Additional hard constraint from the client: this is an order magnet. The hero must itself sell —
so the hero block IS the Friday-meal offer (photo + price + add), not a decorative banner.

**Non-negotiable:** food + price + add-to-cart visible with zero scrolling at 375 / 390 / 768 / 1440.
