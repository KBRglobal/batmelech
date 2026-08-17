import { useEffect, useState } from 'react'
import { LocalIcon } from './local-icon.tsx'

/**
 * The owner's safety net inside Settings: every save the system ever made,
 * newest first, each restorable in a click. A restore creates a NEW version
 * through the same guarded save path, so restoring is itself undoable.
 */

type HistoryVersion = {
  readonly revision: number
  readonly savedAt: string
  readonly ordersCount: number | null
  readonly source: string
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly revision: number }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  'web-orders': 'עריכה בפאנל',
  'web-restore': 'שחזור',
  'web-settings': 'הגדרות',
  'web-menu': 'תפריט',
  'web-recipes': 'מתכונים',
  'web-customers': 'לקוחות',
  'web-finance': 'כספים',
  'web-deliveries': 'משלוחים',
  'web-preparation': 'הכנות',
  'web-shopping': 'רשימת קניות',
  'web-restore-backup': 'שחזור מגיבוי',
}

const TIME_FORMAT = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Dubai',
})

function sourceLabel(source: string): string {
  if (source in SOURCE_LABELS) return SOURCE_LABELS[source]!
  if (source.startsWith('site')) return 'הזמנה מהאתר'
  if (source.startsWith('web-')) return 'עריכה בפאנל'
  return 'שמירה'
}

function parseVersions(value: unknown): HistoryVersion[] {
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as { versions?: unknown }).versions
  if (!Array.isArray(rows)) return []
  const versions: HistoryVersion[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const record = row as Record<string, unknown>
    if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision)) continue
    if (typeof record.savedAt !== 'string') continue
    versions.push({
      revision: record.revision,
      savedAt: record.savedAt,
      ordersCount:
        typeof record.ordersCount === 'number' && Number.isSafeInteger(record.ordersCount)
          ? record.ordersCount
          : null,
      source: typeof record.source === 'string' ? record.source : '',
    })
  }
  return versions
}

export function StateHistorySection() {
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    fetch('/api/state/history')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data === null) {
          setLoadFailed(true)
          return
        }
        setVersions(parseVersions(data))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const restore = async (revision: number) => {
    setStatus({ kind: 'busy', revision })
    setConfirmRevision(null)
    try {
      const response = await fetch(`/api/state/history/${revision}/restore`, { method: 'POST' })
      if (!response.ok) throw new Error('restore failed')
      setReloadKey((key) => key + 1)
      setStatus({
        kind: 'success',
        message: `שוחזר בהצלחה לגרסה ${revision}. השחזור עצמו נשמר כגרסה חדשה, אז גם אותו אפשר לבטל. המסך יתרענן מיד.`,
      })
      // Every screen renders from the store, so after a restore the whole
      // panel reloads to show the restored data everywhere.
      window.setTimeout(() => window.location.reload(), 1_800)
    } catch {
      setStatus({ kind: 'error', message: 'השחזור נכשל — שום דבר לא שונה. אפשר לנסות שוב.' })
    }
  }

  return (
    <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-2xl text-primary" />
        <h2 className="text-xl font-black text-primary">היסטוריה ושחזור</h2>
      </div>
      <p className="mt-2 text-sm font-bold leading-6 text-muted-foreground">
        כל שמירה נשמרת לתמיד. גם אם משהו נמחק או השתבש בטעות — בוחרים רגע ברשימה וחוזרים אליו
        בלחיצה. שחזור אף פעם לא מוחק כלום: הוא נשמר בעצמו כגרסה חדשה.
      </p>

      {status.kind === 'success' && (
        <p role="status" className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-black text-emerald-800">{status.message}</p>
      )}
      {status.kind === 'error' && (
        <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{status.message}</p>
      )}

      {loadFailed ? (
        <p className="mt-5 rounded-2xl bg-secondary p-4 text-sm font-bold text-muted-foreground">
          לא הצלחנו לטעון את ההיסטוריה כרגע.
        </p>
      ) : versions === null ? (
        <p className="mt-5 text-sm font-bold text-muted-foreground">טוענת את ההיסטוריה...</p>
      ) : versions.length === 0 ? (
        <p className="mt-5 text-sm font-bold text-muted-foreground">עוד אין שמירות בהיסטוריה.</p>
      ) : (
        <ul className="mt-5 max-h-96 space-y-2 overflow-y-auto pl-1">
          {versions.map((version, index) => {
            const isCurrent = index === 0
            const busy = status.kind === 'busy'
            return (
              <li
                key={version.revision}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3"
              >
                <div>
                  <p className="text-sm font-black text-primary">
                    {TIME_FORMAT.format(new Date(version.savedAt))}
                    {isCurrent && (
                      <span className="mr-2 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[0.65rem] font-black text-emerald-700">המצב הנוכחי</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                    {sourceLabel(version.source)}
                    {version.ordersCount !== null && <span> · {version.ordersCount} הזמנות</span>}
                    <span> · גרסה {version.revision}</span>
                  </p>
                </div>
                {!isCurrent && (
                  confirmRevision === version.revision ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restore(version.revision)}
                        className="min-h-10 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        כן, לשחזר לרגע הזה
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevision(null)}
                        className="min-h-10 rounded-xl border border-border bg-card px-3 text-xs font-black text-primary hover:bg-secondary"
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmRevision(version.revision)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-xs font-black text-primary hover:bg-secondary disabled:opacity-50"
                    >
                      <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-base" />
                      <span>{busy && status.revision === version.revision ? 'משחזרת...' : 'שחזור'}</span>
                    </button>
                  )
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default StateHistorySection
