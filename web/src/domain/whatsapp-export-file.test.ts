// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readWhatsAppExportFile, trimConversationTail } from './whatsapp-export-file.ts'

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Minimal single-entry zip builder (stored or deflated), enough to mimic a
// WhatsApp "Export chat" archive.
async function deflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function buildZip(fileName: string, content: string, method: 0 | 8): Promise<File> {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(fileName)
  const raw = encoder.encode(content)
  const data = method === 8 ? await deflateRaw(raw) : raw
  const checksum = crc32(raw)

  const local = new Uint8Array(30 + nameBytes.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(8, method, true)
  lv.setUint32(14, checksum, true)
  lv.setUint32(18, data.length, true)
  lv.setUint32(22, raw.length, true)
  lv.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)

  const central = new Uint8Array(46 + nameBytes.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(10, method, true)
  cv.setUint32(16, checksum, true)
  cv.setUint32(20, data.length, true)
  cv.setUint32(24, raw.length, true)
  cv.setUint16(28, nameBytes.length, true)
  cv.setUint32(42, 0, true)
  central.set(nameBytes, 46)
  const centralOffset = local.length + data.length

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 1, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, centralOffset, true)

  const blob = new Blob([local.buffer as ArrayBuffer, data.buffer as ArrayBuffer, central.buffer as ArrayBuffer, eocd.buffer as ArrayBuffer], { type: 'application/zip' })
  return new File([blob], 'WhatsApp Chat.zip', { type: 'application/zip' })
}

const CHAT = '[19/08/2026, 10:00] לין: שלום\n[19/08/2026, 10:01] לקוחה: רוצה זוגית אחת'

describe('readWhatsAppExportFile', () => {
  it('reads a plain txt export', async () => {
    const file = new File([CHAT], '_chat.txt', { type: 'text/plain' })
    const result = await readWhatsAppExportFile(file, 24000)
    expect(result).toEqual({ text: CHAT, trimmed: false })
  })

  it('extracts _chat.txt from a stored zip export', async () => {
    const result = await readWhatsAppExportFile(await buildZip('_chat.txt', CHAT, 0), 24000)
    expect(result).toEqual({ text: CHAT, trimmed: false })
  })

  it('extracts a deflated txt entry from a zip export', async () => {
    const result = await readWhatsAppExportFile(await buildZip('WhatsApp Chat - לקוחה/_chat.txt', CHAT, 8), 24000)
    expect(result).toEqual({ text: CHAT, trimmed: false })
  })

  it('reports a zip with no txt entry as not a chat export', async () => {
    const result = await readWhatsAppExportFile(await buildZip('IMG-0001.jpg', 'not really a jpg', 0), 24000)
    expect(result).toEqual({ error: 'not_chat_export' })
  })

  it('trims long conversations to their tail, on a line boundary', () => {
    const longChat = Array.from({ length: 500 }, (_, index) => `[19/08/2026] לקוחה: הודעה מספר ${index}`).join('\n')
    const { text, trimmed } = trimConversationTail(longChat, 2000)
    expect(trimmed).toBe(true)
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text.startsWith('[')).toBe(true)
    expect(text.endsWith('הודעה מספר 499')).toBe(true)
  })
})
