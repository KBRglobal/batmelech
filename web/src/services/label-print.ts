/*
 * Printing bag and preparation labels on the Brother QL-800.
 *
 * The kitchen may load any of the QL-800's 62mm rolls, and the label has to
 * match the roll exactly or the printer scales and crops it. Die-cut rolls have
 * a fixed length; the continuous roll has none, and CSS cannot express a free
 * page length (`size: 62mm auto` is invalid and falls back to Letter). So for
 * the continuous roll the labels are laid out off-screen first and the tallest
 * one sets the length of every label in the run — a document has one `@page`.
 *
 * Note the page rule must stay unnamed: Chrome ignores a named page (`page:`)
 * for labels inside the absolutely positioned sheet, and the sheet has to stay
 * out of flow so the surrounding app chrome cannot push the first label off its
 * own label.
 */

export type LabelMedia = 'die-cut-29' | 'die-cut-100' | 'continuous'

export const LABEL_WIDTH_MM = 62
export const MIN_LABEL_LENGTH_MM = 20
export const MAX_LABEL_LENGTH_MM = 300
export const FALLBACK_LABEL_LENGTH_MM = 60
export const PAGE_RULE_ELEMENT_ID = 'bm-label-page-rule'

const CSS_PX_PER_MM = 96 / 25.4
const PRINT_CLEANUP_TIMEOUT_MS = 3_000

export const LABEL_MEDIA_OPTIONS: readonly {
  readonly value: LabelMedia
  readonly label: string
  readonly hint: string
  readonly fixedLengthMm: number | null
}[] = [
  { value: 'die-cut-29', label: '62×29 מ"מ', hint: 'DK-11209 — מדבקת כתובת קטנה', fixedLengthMm: 29 },
  { value: 'die-cut-100', label: '62×100 מ"מ', hint: 'DK-11202 — מדבקת משלוח', fixedLengthMm: 100 },
  { value: 'continuous', label: 'גליל רציף 62 מ"מ', hint: 'DK-22205 — האורך נקבע לפי המדבקה המלאה ביותר', fixedLengthMm: null },
]

/*
 * Two typography sets: the 29mm label is tight enough that long names and the
 * storage guidance have to be clamped, while 100mm and the continuous roll have
 * room to breathe. The measuring pass uses the very same rules, so what is
 * measured is what prints.
 */
function labelTypography(scope: string, compact: boolean): string {
  return compact
    ? `
${scope} .bm-label-brand { font-size:8.5pt; line-height:1.1; }
${scope} .bm-label-kosher { font-size:6pt; line-height:1.1; }
${scope} .bm-label-name { font-size:10pt; margin:.8mm 0 .3mm; line-height:1.12; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
${scope} .bm-label-meta { font-size:7.5pt; line-height:1.18; overflow-wrap:anywhere; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
${scope} .bm-label-guidance { margin-top:.8mm; padding-top:.8mm; border-top:.2mm dashed #333; font-size:5.5pt; line-height:1.15; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
${scope} .bm-label-prep-details { font-size:6pt; line-height:1.12; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
`
    : `
${scope} .bm-label-brand { font-size:11pt; line-height:1.15; }
${scope} .bm-label-kosher { font-size:8pt; line-height:1.15; }
${scope} .bm-label-name { font-size:15pt; margin:2.5mm 0 1.5mm; line-height:1.15; overflow-wrap:anywhere; }
${scope} .bm-label-meta { font-size:10pt; line-height:1.35; overflow-wrap:anywhere; }
${scope} .bm-label-guidance { margin-top:2.5mm; padding-top:2mm; border-top:.3mm dashed #333; font-size:8pt; line-height:1.3; }
${scope} .bm-label-prep-details { font-size:9pt; line-height:1.3; }
`
}

function labelBox(scope: string, lengthRule: string, compact: boolean): string {
  return `
${scope} {
  width:${LABEL_WIDTH_MM}mm; ${lengthRule} box-sizing:border-box; margin:0;
  border:0; border-radius:0; padding:${compact ? '1.2mm 2.5mm' : '3mm 3.5mm'};
  display:flex; flex-direction:column; justify-content:center; gap:${compact ? '.3mm' : '.8mm'};
  overflow:hidden; break-inside:avoid; color:#000; background:#fff;
}
${labelTypography(scope, compact)}`
}

export const LABEL_PRINT_CSS = `
.bm-label-sheet { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.bm-label-card { min-width:0; overflow:hidden; border:2px dotted currentColor; border-radius:16px; padding:18px 12px; background:white; }
@media (max-width:420px) { .bm-label-sheet { grid-template-columns:1fr; } }

/* Off-screen measuring pass for the continuous roll: real width, free height. */
.bm-label-measure { position:fixed; inset-block-start:0; inset-inline-start:-200mm; visibility:hidden; }
${labelBox('.bm-label-measure', 'height:auto; min-height:0;', false)}

@media print {
  html, body { margin:0 !important; padding:0 !important; background:#fff !important; }
  body * { visibility:hidden !important; }
  .bm-label-sheet, .bm-label-sheet * { visibility:visible !important; }
  body[data-bm-print-kind="bag"] .bm-preparation-labels { display:none !important; }
  body[data-bm-print-kind="preparation"] .bm-bag-labels { display:none !important; }
  body:not([data-bm-print-kind]) .bm-preparation-labels { display:none !important; }
  .bm-label-sheet { position:absolute; inset-block-start:0; inset-inline-start:0; display:block; margin:0; }
  .bm-label-card { page-break-after:always; break-after:page; }
  .bm-label-card:last-child { page-break-after:auto; break-after:auto; }
  .bm-label-screen-only { display:none !important; }
  /* The QL-800 is a monochrome thermal printer: brand maroon and muted grey
     come out as faint dither, so a label prints in plain black. */
  .bm-label-sheet .bm-label-card, .bm-label-sheet .bm-label-card * { color:#000; }
${labelBox('body[data-bm-label-media="die-cut-29"] .bm-label-card', 'height:29mm;', true)}
${labelBox('body[data-bm-label-media="die-cut-100"] .bm-label-card', 'height:100mm;', false)}
${labelBox('body[data-bm-label-media="continuous"] .bm-label-card', 'height:var(--bm-label-length);', false)}
}
`

// The SPA keeps the loaded roll for the session — it does not change between
// two prints in the same round.
let lastLabelMedia: LabelMedia = 'die-cut-29'

export function rememberedLabelMedia(): LabelMedia {
  return lastLabelMedia
}

export function rememberLabelMedia(media: LabelMedia) {
  lastLabelMedia = media
}

export function fixedLabelLengthMm(media: LabelMedia): number | null {
  return LABEL_MEDIA_OPTIONS.find((option) => option.value === media)?.fixedLengthMm ?? null
}

/**
 * Lays every label out at the roll width with a free height and returns the
 * length the fullest one needs, in whole millimetres. Only the continuous roll
 * needs this — a die-cut roll has one true length.
 */
export function measureLabelLengthMm(labels: Iterable<Element> | null): number {
  let pixels = 0
  for (const label of labels ?? []) {
    if (!(label instanceof HTMLElement)) continue
    const clone = label.cloneNode(true) as HTMLElement
    clone.classList.add('bm-label-measure')
    clone.setAttribute('aria-hidden', 'true')
    document.body.append(clone)
    pixels = Math.max(pixels, clone.getBoundingClientRect().height)
    clone.remove()
  }
  if (!Number.isFinite(pixels) || pixels <= 0) return FALLBACK_LABEL_LENGTH_MM
  const millimetres = Math.ceil(pixels / CSS_PX_PER_MM) + 1
  return Math.min(MAX_LABEL_LENGTH_MM, Math.max(MIN_LABEL_LENGTH_MM, millimetres))
}

export function labelPageRule(media: LabelMedia, lengthMm: number): string {
  const length = fixedLabelLengthMm(media) ?? lengthMm
  return `@page { size: ${LABEL_WIDTH_MM}mm ${length}mm; margin: 0; }\n`
    + `body[data-bm-label-media="${media}"] { --bm-label-length: ${length}mm; }`
}

export function printLabels(
  kind: 'bag' | 'preparation',
  media: LabelMedia,
  labels: Iterable<Element> | null,
) {
  const rule = document.createElement('style')
  rule.id = PAGE_RULE_ELEMENT_ID
  rule.textContent = labelPageRule(
    media,
    fixedLabelLengthMm(media) === null ? measureLabelLengthMm(labels) : 0,
  )
  document.head.append(rule)
  document.body.dataset.bmPrintKind = kind
  document.body.dataset.bmLabelMedia = media

  const cleanup = () => {
    document.getElementById(PAGE_RULE_ELEMENT_ID)?.remove()
    delete document.body.dataset.bmPrintKind
    delete document.body.dataset.bmLabelMedia
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  window.setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS)
}
