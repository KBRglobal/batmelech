import { BAT_MELECH_LOGO_SRC } from '../components/brand-logo.tsx'
import { buildQrPath } from '../components/qr-code.tsx'
import type { FlyerShabbat } from '../domain/flyer-shabbat.ts'

/**
 * The community flyer: brand, one big QR to the order form, and the coming
 * Shabbat's parasha + Dubai candle-lighting. A5 portrait — two per A4 sheet
 * when the print dialog scales, and readable pinned to a community board.
 */
export function buildFlyerHtml(qrTarget: string, shabbat: Readonly<FlyerShabbat>): string | null {
  const built = buildQrPath(qrTarget)
  if (built === null) return null
  const size = built.modules + 4
  const shabbatLine = [
    shabbat.parasha,
    shabbat.candleLighting === null ? null : `הדלקת נרות בדובאי: ${shabbat.candleLighting}`,
  ].filter((part): part is string => part !== null).join(' · ')

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>פלייר — מטעמי בת מלך</title>
<style>
  @page { size: A5 portrait; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: 'Heebo', 'Arial Hebrew', 'Noto Sans Hebrew', sans-serif;
    color: #3f2a1d; background: #fff; text-align: center;
    display: flex; flex-direction: column; align-items: center;
    gap: 6mm; padding: 8mm 6mm;
  }
  .frame { border: 1.2mm double #8a5a33; border-radius: 8mm; padding: 8mm 6mm; width: 100%; }
  .bsd { text-align: left; font-size: 9pt; font-weight: 900; }
  img.logo { width: 42mm; height: 42mm; object-fit: contain; }
  h1 { font-size: 24pt; font-weight: 900; color: #8a5a33; margin-top: 2mm; }
  .sub { font-size: 12pt; font-weight: 700; margin-top: 1mm; }
  .shabbat { font-size: 13pt; font-weight: 900; color: #8a5a33; margin-top: 4mm; }
  .cta { font-size: 15pt; font-weight: 900; margin-top: 5mm; }
  svg.qr { width: 52mm; height: 52mm; margin-top: 3mm; }
  .url { font-size: 9pt; font-weight: 700; direction: ltr; margin-top: 2mm; color: #7a6a5c; }
  .foot { font-size: 11pt; font-weight: 900; color: #8a5a33; margin-top: 5mm; }
</style>
</head>
<body onload="window.print()">
  <div class="frame">
    <p class="bsd">בס"ד</p>
    <img class="logo" src="${BAT_MELECH_LOGO_SRC}" alt="מטעמי בת מלך">
    <h1>מטעמי בת מלך</h1>
    <p class="sub">מטבח ביתי אותנטי · כשר</p>
    ${shabbatLine === '' ? '' : `<p class="shabbat">${shabbatLine}</p>`}
    <p class="cta">סורקים ומזמינים אוכל ביתי לשבת</p>
    <svg class="qr" shape-rendering="crispEdges" viewBox="-2 -2 ${size} ${size}">
      <rect x="-2" y="-2" width="${size}" height="${size}" fill="#fff"></rect>
      <path d="${built.path}" fill="#000"></path>
    </svg>
    <p class="url">${qrTarget}</p>
    <p class="foot">בשם השם נעשה ונצליח!</p>
  </div>
</body>
</html>`
}

/** Opens the flyer in a print-ready window. Returns false if popups are blocked. */
export function printFlyer(qrTarget: string, shabbat: Readonly<FlyerShabbat>): boolean {
  const html = buildFlyerHtml(qrTarget, shabbat)
  if (html === null) return false
  const flyerWindow = window.open('', '_blank', 'noopener=no')
  if (flyerWindow === null) return false
  flyerWindow.document.write(html)
  flyerWindow.document.close()
  return true
}
