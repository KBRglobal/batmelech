/*
 * Printing bons on the Brother QL-800.
 *
 * The QL-800's continuous roll is 62mm wide with a free length, and CSS cannot
 * express that: `size: 62mm auto` is invalid and silently falls back to Letter,
 * which is how 62mm bons ended up laid out on A4 pages. So every bon about to
 * be printed is laid out off-screen at the exact roll width, and the longest
 * one becomes a temporary `@page` rule that is removed again once printing
 * ends. One `@page` rule covers the whole document, so a batch prints every bon
 * at the length of its longest member.
 */

export type BonMedia = 'roll' | 'page'

export const ROLL_WIDTH_MM = 62
export const MIN_ROLL_LENGTH_MM = 40
export const MAX_ROLL_LENGTH_MM = 1_000
export const FALLBACK_ROLL_LENGTH_MM = 150
export const PAGE_RULE_ELEMENT_ID = 'bm-bon-page-rule'

const CSS_PX_PER_MM = 96 / 25.4
const PRINT_CLEANUP_TIMEOUT_MS = 3_000

/*
 * The logo file is square with wide white margins: the mark itself covers 47% of
 * its width and 56% of its height, centred, leaving 21.9% of white above and
 * below. Printing the file as-is would spend that white on the roll — and an
 * image paints its white, so it cannot simply be overlapped. So the logo is
 * drawn at LOGO_BOX_MM and pulled up into a frame exactly as tall as the mark.
 */
const LOGO_INK_HEIGHT_RATIO = 0.5617
const LOGO_TOP_MARGIN_RATIO = 0.21875
const LOGO_BOX_MM = 47
const LOGO_INK_HEIGHT_MM = Math.round(LOGO_BOX_MM * LOGO_INK_HEIGHT_RATIO * 10) / 10
const LOGO_MARGIN_MM = Math.round(LOGO_BOX_MM * LOGO_TOP_MARGIN_RATIO * 10) / 10

export const BON_MEDIA_OPTIONS: readonly {
  readonly value: BonMedia
  readonly label: string
  readonly hint: string
}[] = [
  { value: 'roll', label: 'גליל 62 מ"מ', hint: 'Brother QL-800 — אורך הבון נקבע לפי התוכן' },
  { value: 'page', label: 'דף רגיל', hint: 'מדפסת A4 רגילה' },
]

/*
 * The measuring clone and the printed bon must resolve to the same layout, so
 * every roll metric — including the ones that override a Tailwind utility on a
 * child — is emitted once per scope instead of living inside `@media print`.
 * Measuring against the screen typography reported a third more tape than the
 * bon actually needs.
 */
function rollMetrics(scope: string): string {
  return `
${scope} {
  width:${ROLL_WIDTH_MM}mm; max-width:none; box-sizing:border-box; margin:0;
  padding:3mm 3.5mm; border:0; border-radius:0; box-shadow:none;
  background:#fff; color:#000; font-size:8.5pt; line-height:1.35;
}
${scope} .bm-bon-bsd { font-size:6.5pt; margin:0; }
${scope} .bm-bon-head { padding-bottom:1.5mm; margin-bottom:1.5mm; }
${scope} .bm-bon-logo-frame { height:${LOGO_INK_HEIGHT_MM}mm; overflow:hidden; text-align:center; margin:.5mm 0 0; }
${scope} .bm-bon-logo {
  display:inline-block; width:${LOGO_BOX_MM}mm; height:${LOGO_BOX_MM}mm;
  margin:${-LOGO_MARGIN_MM}mm 0 0; vertical-align:top;
}
${scope} .bm-bon-sub { font-size:6.5pt; margin:.5mm 0 0; }
${scope} .bm-bon-meta { font-size:6.5pt; margin:0 0 1.5mm; gap:1mm; }
${scope} .bm-bon-body { font-size:8.5pt; line-height:1.4; margin:0; overflow-wrap:anywhere; }
${scope} .bm-bon-total { font-size:11pt; margin:2mm 0 0; padding-top:1.5mm; border-top-width:.5mm; }
${scope} .bm-bon-foot { font-size:8pt; margin-top:2mm; padding-top:1.5mm; }
`
}

export const BON_PRINT_CSS = `
.bm-bon-roll { position:fixed; inset-block-start:0; inset-inline-start:-200mm; visibility:hidden; }
${rollMetrics('.bm-bon-roll')}
@media print {
  body * { visibility: hidden !important; }
  .bm-bon-sheet, .bm-bon-sheet * { visibility: visible !important; }
  .bm-no-print { display: none !important; }
  html, body { margin:0 !important; padding:0 !important; background:#fff !important; }
  .bm-bon-sheet {
    position:absolute; inset-block-start:0; inset-inline-start:0;
    display:block; margin:0; padding:0; gap:0;
  }
  .bm-order-bon { break-after:page; page-break-after:always; break-inside:auto; }
  .bm-order-bon:last-child { break-after:auto; page-break-after:auto; }
  body[data-bm-bon-media="page"] .bm-order-bon {
    width:100%; max-width:none; border:0; box-shadow:none;
  }
${rollMetrics('body[data-bm-bon-media="roll"] .bm-order-bon')}
  /* The QL-800 is a monochrome thermal printer: brand maroon and muted grey
     come out as faint dither, so the roll prints in plain black. */
  body[data-bm-bon-media="roll"] .bm-order-bon,
  body[data-bm-bon-media="roll"] .bm-order-bon * { color:#000; border-color:#000; }
}
`

// The SPA keeps the last choice for the session so a printing round does not
// start over on every bon.
let lastBonMedia: BonMedia = 'roll'

export function rememberedBonMedia(): BonMedia {
  return lastBonMedia
}

export function rememberBonMedia(media: BonMedia) {
  lastBonMedia = media
}

/**
 * Lays every bon out at the exact printed roll width off-screen and returns the
 * length of roll the longest one needs, in whole millimetres. Falls back to a
 * usable length whenever the browser cannot measure (no layout engine, detached
 * nodes, nothing to print).
 */
export function measureRollLengthMm(bons: Iterable<Element> | Element | null): number {
  const nodes = bons === null ? [] : bons instanceof Element ? [bons] : [...bons]
  let pixels = 0
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    const clone = node.cloneNode(true) as HTMLElement
    clone.classList.add('bm-bon-roll')
    clone.setAttribute('aria-hidden', 'true')
    document.body.append(clone)
    pixels = Math.max(pixels, clone.getBoundingClientRect().height)
    clone.remove()
  }
  if (!Number.isFinite(pixels) || pixels <= 0) return FALLBACK_ROLL_LENGTH_MM
  // A whole extra millimetre keeps a last line from being pushed onto a second
  // strip by rounding alone.
  const millimetres = Math.ceil(pixels / CSS_PX_PER_MM) + 1
  return Math.min(MAX_ROLL_LENGTH_MM, Math.max(MIN_ROLL_LENGTH_MM, millimetres))
}

export function bonPageRule(media: BonMedia, rollLengthMm: number): string {
  return media === 'roll'
    ? `@page { size: ${ROLL_WIDTH_MM}mm ${rollLengthMm}mm; margin: 0; }`
    : '@page { size: auto; margin: 12mm; }'
}

export function printBons(media: BonMedia, bons: Iterable<Element> | Element | null) {
  const rule = document.createElement('style')
  rule.id = PAGE_RULE_ELEMENT_ID
  rule.textContent = bonPageRule(media, measureRollLengthMm(bons))
  document.head.append(rule)
  document.body.dataset.bmBonMedia = media

  const cleanup = () => {
    document.getElementById(PAGE_RULE_ELEMENT_ID)?.remove()
    delete document.body.dataset.bmBonMedia
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  window.setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS)
}
