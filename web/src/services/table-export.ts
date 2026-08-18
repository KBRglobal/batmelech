// Excel export for any table (roadmap #9). CSV with a UTF-8 BOM — Excel
// opens it directly with Hebrew intact, no library and no build weight.

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/u.test(text)) return `"${text.replace(/"/gu, '""')}"`
  return text
}

export function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  return '\ufeff' + lines.join('\r\n')
}

export function downloadTable(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
