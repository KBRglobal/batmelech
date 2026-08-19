// Reads a WhatsApp "Export chat" file as the user hands it over: either the
// raw _chat.txt, or the .zip WhatsApp produces on iPhone (and on Android with
// media). The zip is parsed here in the browser — stored entries directly,
// deflated entries through the platform's DecompressionStream — so no library
// ships in the bundle for a file we open once.

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50

interface ZipEntry {
  readonly fileName: string
  readonly compressionMethod: number
  readonly compressedSize: number
  readonly localHeaderOffset: number
}

function findEndOfCentralDirectory(view: DataView): number {
  // the record is at the very end, before an optional comment (max 64KB)
  const start = Math.max(0, view.byteLength - 22 - 65536)
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  return -1
}

function readCentralDirectory(buffer: ArrayBuffer): readonly ZipEntry[] {
  const view = new DataView(buffer)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) return []
  const entryCount = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) break
    const compressionMethod = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const fileName = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength))
    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array | null> {
  const view = new DataView(buffer)
  const base = entry.localHeaderOffset
  if (view.getUint32(base, true) !== LOCAL_HEADER_SIGNATURE) return null
  const nameLength = view.getUint16(base + 26, true)
  const extraLength = view.getUint16(base + 28, true)
  const dataStart = base + 30 + nameLength + extraLength
  const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize)

  if (entry.compressionMethod === 0) return compressed
  if (entry.compressionMethod === 8) {
    const stream = new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return null
}

// Long exports overflow the intake limit; the order being discussed is at the
// END of the chat, so trimming keeps the newest lines whole.
export function trimConversationTail(text: string, maxLength: number): { text: string; trimmed: boolean } {
  if (text.length <= maxLength) return { text, trimmed: false }
  const tail = text.slice(-maxLength)
  const firstLineBreak = tail.indexOf('\n')
  return { text: firstLineBreak > 0 ? tail.slice(firstLineBreak + 1) : tail, trimmed: true }
}

export async function readWhatsAppExportFile(
  file: File,
  maxLength: number,
): Promise<{ text: string; trimmed: boolean } | { error: 'not_chat_export' | 'unreadable' }> {
  const lowerName = file.name.toLowerCase()
  try {
    if (lowerName.endsWith('.txt') || file.type === 'text/plain') {
      return trimConversationTail(await file.text(), maxLength)
    }
    if (lowerName.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      const buffer = await file.arrayBuffer()
      const entries = readCentralDirectory(buffer)
      const chatEntry =
        entries.find((entry) => entry.fileName.toLowerCase().endsWith('_chat.txt')) ??
        entries.find((entry) => entry.fileName.toLowerCase().endsWith('.txt'))
      if (!chatEntry) return { error: 'not_chat_export' }
      const bytes = await readZipEntry(buffer, chatEntry)
      if (!bytes) return { error: 'unreadable' }
      return trimConversationTail(new TextDecoder('utf-8').decode(bytes), maxLength)
    }
    return { error: 'not_chat_export' }
  } catch {
    return { error: 'unreadable' }
  }
}
