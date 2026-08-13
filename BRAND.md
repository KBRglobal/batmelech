# Bat Melech — Brand

## Colors

| Name | Hex | Use |
|---|---|---|
| Dark chocolate brown | `#3B151A` | primary text, dark surfaces, nav pill, footer text |
| Golden mustard | `#F5A83A` | accent — badges, highlighted word in headings, CTAs on dark |
| Deep burgundy | `#8D182C` | secondary accent — links, prices, warm CTAs |
| Antique pink | `#EDB2C1` | borders, dividers, soft highlights |
| Light cream | `#F7ECE6` | page background |

Fonts: Assistant (sans/body/heading), Playfair Display (serif, unused so far).

## Hero image overlay

Every full-bleed hero image gets a gradient overlay for text legibility. The
overlay must stay light enough in the middle that each photo's own color
comes through — blue dusk on Home, fire-orange on the BBQ page, ocean blue on
Yacht, desert amber on Desert Safari. A flat heavy brand-brown wash across the
whole image kills that variety and was reverted.

Recipe (`PageHero` component, `customer-site/src/components/page-hero.tsx`):

```css
background: linear-gradient(
  to bottom,
  rgba(59, 21, 26, 0.55) 0%,   /* #3B151A — dark enough for the nav pill up top */
  rgba(59, 21, 26, 0.06) 45%,  /* nearly clear — the photo's own color shows */
  #F7ECE6 100%                 /* fades into the page background at the bottom */
);
```

Hero title/subtitle get a drop-shadow (`drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]`)
instead of relying on the gradient alone for contrast — keeps text readable
over light or busy parts of any photo without darkening the whole image.

Exceptions (established, keep as-is):
- **Home** — `from-black/60 via-transparent to-black/80` (neutral black, not
  brand brown — preserves the hero photo's blue tone).
- **Weekdays** — `from-[#3B151A]/90 via-[#3B151A]/50 to-[#F7ECE6]` (full brand
  brown wash, intentional — this page is meant to feel warm).
