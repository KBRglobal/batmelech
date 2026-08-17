import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { LocalIcon } from './local-icon.tsx'

// מיי's control panel inside Settings: every change she made (undo per
// entry), the emergency freeze switch (unfreezing is ONLY possible here, by
// design), and Lin's stored WhatsApp reply voice.

const AuditEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  tool: z.string(),
  summary: z.string(),
  undone: z.boolean(),
  undoable: z.boolean(),
}).passthrough()

const AuditLogSchema = z.object({
  frozen: z.boolean(),
  entries: z.array(AuditEntrySchema).max(100),
}).passthrough()

type AuditLog = z.infer<typeof AuditLogSchema>

function formatTime(at: number): string {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Dubai',
    }).format(new Date(at))
  } catch {
    return ''
  }
}

export function MeyAuditSection() {
  const [log, setLog] = useState<AuditLog | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [freezeBusy, setFreezeBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [style, setStyle] = useState('')
  const [styleState, setStyleState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/mey/audit/', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('audit fetch failed')
      const parsed = AuditLogSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('audit response invalid')
      setLog(parsed.data)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void fetch('/api/mey/audit/reply-style', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const value = (data as { style?: unknown } | null)?.style
        if (typeof value === 'string') setStyle(value)
      })
      .catch(() => {})
  }, [refresh])

  const undoEntry = async (entryId: string) => {
    setBusyEntry(entryId)
    setActionMessage(null)
    try {
      const response = await fetch('/api/mey/audit/undo', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ entryId }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = (data as { error?: unknown } | null)?.error
        setActionMessage(typeof message === 'string' ? message : 'הביטול נכשל. אפשר לנסות שוב.')
      } else {
        setActionMessage('השינוי בוטל והמצב הקודם שוחזר.')
      }
    } catch {
      setActionMessage('הביטול נכשל. אפשר לנסות שוב.')
    } finally {
      setBusyEntry(null)
      void refresh()
    }
  }

  const toggleFreeze = async (frozen: boolean) => {
    setFreezeBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch('/api/mey/audit/freeze', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ frozen }),
      })
      if (!response.ok) setActionMessage('שינוי מצב ההקפאה נכשל. אפשר לנסות שוב.')
      else setActionMessage(frozen ? 'מיי הוקפאה — כל הכתיבות שלה חסומות.' : 'ההקפאה שוחררה — מיי חזרה לעבודה.')
    } catch {
      setActionMessage('שינוי מצב ההקפאה נכשל. אפשר לנסות שוב.')
    } finally {
      setFreezeBusy(false)
      void refresh()
    }
  }

  const saveStyle = async () => {
    setStyleState('saving')
    try {
      const response = await fetch('/api/mey/audit/reply-style', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ style }),
      })
      setStyleState(response.ok ? 'saved' : 'error')
    } catch {
      setStyleState('error')
    }
  }

  return (
    <section aria-label="מיי — יומן פעולות ובקרה" className="rounded-[2rem] border border-border bg-card p-5 text-primary shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <LocalIcon name="ph:robot-bold" className="text-2xl" />
          <div>
            <h2 className="text-sm font-black">מיי — יומן פעולות ובקרה</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">כל שינוי שמיי עושה נרשם כאן וניתן לביטול בלחיצה. הקפאת חירום חוסמת את כל הכתיבות שלה; שחרור אפשרי רק מכאן.</p>
          </div>
        </div>
        {log && (
          <button
            type="button"
            disabled={freezeBusy}
            onClick={() => { void toggleFreeze(!log.frozen) }}
            className={`inline-flex min-h-11 items-center gap-2 rounded-2xl px-5 text-sm font-black disabled:cursor-wait disabled:opacity-60 ${log.frozen ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-destructive text-white hover:bg-destructive/90'}`}
          >
            <LocalIcon name={log.frozen ? 'ph:play-circle-bold' : 'ph:pause-circle-bold'} className="text-lg" />
            <span>{log.frozen ? 'שחרור ההקפאה' : 'הקפאת חירום'}</span>
          </button>
        )}
      </div>

      {log?.frozen && (
        <p role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-950">
          מיי מוקפאת כרגע — היא לא יכולה לשנות שום דבר עד שחרור מכאן.
        </p>
      )}
      {actionMessage && <p role="status" className="mt-4 rounded-2xl bg-secondary p-4 text-sm font-black">{actionMessage}</p>}

      <div className="mt-4">
        <h3 className="text-xs font-black text-muted-foreground">הפעולות האחרונות של מיי</h3>
        {loadError && (
          <p className="mt-3 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">
            לא הצלחנו לטעון את היומן. <button type="button" onClick={() => { void refresh() }} className="underline">לנסות שוב</button>
          </p>
        )}
        {log && log.entries.length === 0 && !loadError && (
          <p className="mt-3 text-sm font-bold text-muted-foreground">אין עדיין פעולות רשומות.</p>
        )}
        {log && log.entries.length > 0 && (
          <ul className="mt-3 space-y-2">
            {log.entries.map((entry) => (
              <li key={entry.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 ${entry.undone ? 'border-border bg-background opacity-60' : 'border-border bg-card'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">{entry.summary}</p>
                  <p className="mt-1 text-xs font-bold text-muted-foreground" dir="ltr">{formatTime(entry.at)}</p>
                </div>
                {entry.undone ? (
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black">בוטל</span>
                ) : entry.undoable ? (
                  <button
                    type="button"
                    disabled={busyEntry !== null}
                    onClick={() => { void undoEntry(entry.id) }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/20 bg-card px-4 text-xs font-black hover:bg-secondary disabled:cursor-wait disabled:opacity-60"
                  >
                    <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-base" />
                    <span>{busyEntry === entry.id ? 'מבטלת...' : 'ביטול השינוי'}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-xs font-black text-muted-foreground">הסגנון של לין לתשובות וואטסאפ</h3>
        <p className="mt-1 text-xs font-bold text-muted-foreground">איך טיוטות התשובה ללקוחות צריכות להישמע (למשל: חמה ואישית, בלי סלנג, לחתום "לין ממטעמי בת מלך"). נשמר פעם אחת ומשפיע על כל הטיוטות.</p>
        <textarea
          aria-label="סגנון תשובות וואטסאפ"
          value={style}
          maxLength={2000}
          onChange={(event) => { setStyle(event.currentTarget.value); setStyleState('idle') }}
          className="mt-3 min-h-24 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="עוד לא הוגדר סגנון — הטיוטות ינוסחו בסגנון חם ופשוט כברירת מחדל"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={styleState === 'saving'}
            onClick={() => { void saveStyle() }}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            <LocalIcon name="ph:floppy-disk-bold" className="text-lg" />
            <span>{styleState === 'saving' ? 'שומרת...' : 'שמירת הסגנון'}</span>
          </button>
          {styleState === 'saved' && <span className="text-sm font-black text-emerald-700">נשמר ✓</span>}
          {styleState === 'error' && <span role="alert" className="text-sm font-black text-destructive">השמירה נכשלה</span>}
        </div>
      </div>
    </section>
  )
}
