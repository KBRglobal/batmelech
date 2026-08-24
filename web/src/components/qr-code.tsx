import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * One printable QR code, rendered as a crisp SVG (vector — scales to any
 * print size without blurring). Type 0 lets the library pick the smallest
 * version that fits; error level M survives kitchen-printer smudges.
 */
export function buildQrPath(value: string): { readonly path: string; readonly modules: number } | null {
  try {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const modules = qr.getModuleCount()
    let path = ''
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
      }
    }
    return { path, modules }
  } catch {
    // Overlong value — a bon without a QR beats a bon that fails to print.
    return null
  }
}

export function QrCode({ value, caption, className }: {
  readonly value: string
  readonly caption?: string
  readonly className?: string
}) {
  const built = useMemo(() => buildQrPath(value), [value])
  if (built === null) return null
  // A quiet zone of 2 modules on every side keeps phone cameras happy.
  const size = built.modules + 4
  return (
    <figure className={className} data-qr-target={value}>
      <svg
        aria-hidden="true"
        className="mx-auto h-full w-full"
        shapeRendering="crispEdges"
        viewBox={`-2 -2 ${size} ${size}`}
      >
        <rect fill="#fff" height={size} width={size} x={-2} y={-2} />
        <path d={built.path} fill="#000" />
      </svg>
      {caption !== undefined && (
        <figcaption className="text-center font-bold">{caption}</figcaption>
      )}
    </figure>
  )
}

export default QrCode
