import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { LocalIcon } from './local-icon.tsx'

// Supplier invoice archive: Lin uploads the invoices she receives (PDF or
// photo) and they are stored in the plan's cloud storage, grouped by month.
// Files are viewed through the authenticated API — no public links.

const ArchiveFileSchema = z.object({
  key: z.string(),
  size: z.number().nonnegative(),
  uploadedAt: z.string().nullable().or(z.date().transform((d) => d.toISOString())),
})

const ArchiveSchema = z.object({ files: z.array(ArchiveFileSchema) })

type ArchiveFile = z.infer<typeof ArchiveFileSchema>

const ARCHIVE_QUERY_KEY = ['bat-melech', 'invoice-archive'] as const
const MAX_FILE_BYTES = 10 * 1024 * 1024

function fileLabel(key: string): string {
  const base = key.split('/').pop() ?? key
  // key shape: <timestamp>-<random>-<original-name>
  const withoutStamp = base.replace(/^\d+-[a-f0-9]+-/u, '')
  return withoutStamp || base
}

function monthLabel(key: string): string {
  const month = key.split('/')[1] ?? ''
  const [year, monthNumber] = month.split('-')
  if (!year || !monthNumber) return month
  const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
  return `${names[Number(monthNumber) - 1] ?? monthNumber} ${year}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function loadArchive(): Promise<readonly ArchiveFile[]> {
  const response = await fetch('/api/settings/invoice-files', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`archive load failed: ${response.status}`)
  return ArchiveSchema.parse(await response.json()).files
}

export function InvoiceArchiveSection() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const archiveQuery = useQuery({ queryKey: ARCHIVE_QUERY_KEY, queryFn: loadArchive })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      const response = await fetch('/api/settings/invoice-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fileBase64, fileName: file.name }),
      })
      if (response.status === 413) {
        throw new Error('חבילת האחסון מלאה — יש לרכוש הרחבה במסך ההגדרות')
      }
      if (!response.ok) throw new Error('ההעלאה נכשלה, נסי שוב')
    },
    onSuccess: () => {
      setMessage({ kind: 'success', text: 'החשבונית נשמרה בארכיון' })
      void queryClient.invalidateQueries({ queryKey: ARCHIVE_QUERY_KEY })
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      const response = await fetch('/api/settings/invoice-files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ key }),
      })
      if (!response.ok) throw new Error('המחיקה נכשלה')
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ARCHIVE_QUERY_KEY }),
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  })

  const onFileSelected = (file: File | undefined) => {
    setMessage(null)
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ kind: 'error', text: 'הקובץ גדול מדי — עד 10MB' })
      return
    }
    uploadMutation.mutate(file)
  }

  const files = archiveQuery.data ?? []
  const byMonth = new Map<string, ArchiveFile[]>()
  for (const file of files) {
    const month = file.key.split('/')[1] ?? ''
    byMonth.set(month, [...(byMonth.get(month) ?? []), file])
  }
  const months = [...byMonth.keys()].sort().reverse()

  return (
    <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LocalIcon name="ph:file-text-bold" className="text-xl text-accent" />
          <h2 className="text-xl font-black text-primary">ארכיון חשבוניות ספקים</h2>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            onFileSelected(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <LocalIcon name="ph:cloud-arrow-up-bold" className="text-lg" />
          {uploadMutation.isPending ? 'מעלה…' : 'העלאת חשבונית'}
        </button>
      </div>
      <p className="mt-2 text-xs font-bold text-muted-foreground">
        קובץ PDF או צילום. הקבצים נשמרים בענן המאובטח ונספרים בחבילת האחסון.
      </p>

      {message !== null && (
        <p
          className={`mt-3 rounded-2xl border-2 p-3 text-xs font-black ${
            message.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
          }`}
        >
          {message.text}
        </p>
      )}

      {archiveQuery.isPending ? (
        <p className="mt-5 text-xs font-bold text-muted-foreground">טוען את הארכיון…</p>
      ) : archiveQuery.isError ? (
        <p className="mt-5 text-xs font-bold text-rose-700">הארכיון אינו זמין כרגע</p>
      ) : files.length === 0 ? (
        <p className="mt-5 text-xs font-bold text-muted-foreground">אין עדיין חשבוניות בארכיון — ההעלאה הראשונה תופיע כאן.</p>
      ) : (
        <div className="mt-5 space-y-6">
          {months.map((month) => (
            <div key={month}>
              <h3 className="text-sm font-black text-muted-foreground">{monthLabel(`invoices/${month}/x`)}</h3>
              <ul className="mt-2 space-y-2">
                {(byMonth.get(month) ?? []).map((file) => (
                  <li
                    key={file.key}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <LocalIcon name="ph:file-text-bold" className="shrink-0 text-lg text-accent" />
                      <span className="min-w-0 truncate text-sm font-bold text-primary" dir="ltr">
                        {fileLabel(file.key)}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-muted-foreground" dir="ltr">
                        {formatSize(file.size)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={`/api/settings/invoice-files/file?key=${encodeURIComponent(file.key)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-primary transition-colors hover:bg-secondary"
                      >
                        צפייה
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('למחוק את החשבונית מהארכיון? פעולה זו אינה ניתנת לביטול.')) {
                            deleteMutation.mutate(file.key)
                          }
                        }}
                        className="inline-flex min-h-9 items-center rounded-xl border border-rose-100 bg-rose-50 px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                      >
                        מחיקה
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
