import { useEffect, useState } from 'react'
import { z } from 'zod'
import { LocalIcon } from './local-icon.tsx'

// Delivery time windows editor inside Settings: the kitchen defines the slots
// customers can pick at checkout and how many deliveries fit in each. An
// empty list turns the feature off — checkout shows its free time field again.
// Saving replaces the full array via PUT /api/settings/delivery-windows/.

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_WINDOWS = 20
const MIN_CAPACITY = 1
const MAX_CAPACITY = 500

const WindowSchema = z.object({
  key: z.string().min(1).max(64),
  start: z.string().regex(TIME_PATTERN),
  end: z.string().regex(TIME_PATTERN),
  capacity: z.number().int().min(MIN_CAPACITY).max(MAX_CAPACITY),
})

const WindowsResponseSchema = z.object({
  windows: z.array(WindowSchema).max(MAX_WINDOWS),
}).passthrough()

interface WindowDraft {
  readonly key: string
  readonly start: string
  readonly end: string
  readonly capacity: number
}

function freshKey(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

function minutesOf(time: string): number | null {
  if (!TIME_PATTERN.test(time)) return null
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

// Mirrors the server's validateWindowsInput — the save button only enables
// what the server will accept.
function validateDraft(windows: readonly WindowDraft[]): string | null {
  if (windows.length > MAX_WINDOWS) return `אפשר להגדיר עד ${MAX_WINDOWS} חלונות`
  const sorted = [...windows].sort((a, b) => (minutesOf(a.start) ?? 0) - (minutesOf(b.start) ?? 0))
  for (const window of sorted) {
    const start = minutesOf(window.start)
    const end = minutesOf(window.end)
    if (start === null || end === null) return 'לכל חלון צריך שעת התחלה ושעת סיום'
    if (start >= end) return 'שעת ההתחלה חייבת להיות לפני שעת הסיום'
    if (!Number.isInteger(window.capacity) || window.capacity < MIN_CAPACITY || window.capacity > MAX_CAPACITY) {
      return `הקיבולת חייבת להיות בין ${MIN_CAPACITY} ל-${MAX_CAPACITY}`
    }
  }
  for (let at = 1; at < sorted.length; at += 1) {
    const previousEnd = minutesOf(sorted[at - 1].end)
    const start = minutesOf(sorted[at].start)
    if (previousEnd !== null && start !== null && start < previousEnd) {
      return 'החלונות לא יכולים לחפוף אחד את השני'
    }
  }
  return null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function DeliveryWindowsSection() {
  const [windows, setWindows] = useState<WindowDraft[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/settings/delivery-windows/', {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('delivery windows fetch failed')
        const parsed = WindowsResponseSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('delivery windows response invalid')
        if (cancelled) return
        setWindows(parsed.data.windows)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateWindow = (key: string, patch: Partial<Omit<WindowDraft, 'key'>>) => {
    setSaveState('idle')
    setWindows((current) => current.map((window) => (window.key === key ? { ...window, ...patch } : window)))
  }

  const addWindow = () => {
    setSaveState('idle')
    setWindows((current) =>
      current.length >= MAX_WINDOWS
        ? current
        : [...current, { key: freshKey(), start: '', end: '', capacity: 5 }],
    )
  }

  const removeWindow = (key: string) => {
    setSaveState('idle')
    setWindows((current) => current.filter((window) => window.key !== key))
  }

  const stepCapacity = (key: string, delta: number) => {
    setSaveState('idle')
    setWindows((current) =>
      current.map((window) =>
        window.key === key
          ? { ...window, capacity: Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, window.capacity + delta)) }
          : window,
      ),
    )
  }

  const validationMessage = loadState === 'ready' ? validateDraft(windows) : null

  const save = async () => {
    if (validationMessage !== null) return
    setSaveState('saving')
    try {
      const response = await fetch('/api/settings/delivery-windows/', {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ windows }),
      })
      setSaveState(response.ok ? 'saved' : 'error')
    } catch {
      setSaveState('error')
    }
  }

  return (
    <section aria-label="חלונות משלוח" className="rounded-[2rem] border border-border bg-card p-5 text-primary shadow-sm sm:p-6">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <LocalIcon name="ph:clock-bold" className="text-2xl" />
        <div>
          <h2 className="text-sm font-black">חלונות משלוח</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">
            הלקוחות באתר בוחרים חלון שעות במקום שעה חופשית, וכל חלון מוגבל למספר משלוחים. רשימה ריקה מכבה את זה — האתר חוזר לשדה שעה חופשי.
          </p>
        </div>
      </div>

      {loadState === 'loading' && (
        <p className="mt-4 text-sm font-bold text-muted-foreground">טוענת את החלונות...</p>
      )}
      {loadState === 'error' && (
        <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">
          לא הצלחנו לטעון את החלונות. אפשר לרענן את המסך ולנסות שוב.
        </p>
      )}

      {loadState === 'ready' && (
        <>
          {windows.length === 0 && (
            <p className="mt-4 text-sm font-bold text-muted-foreground">
              אין חלונות מוגדרים — הלקוחות ממלאים שעה חופשית כרגיל.
            </p>
          )}

          {windows.length > 0 && (
            <ul className="mt-4 space-y-3">
              {windows.map((window) => (
                <li key={window.key} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-background p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-black text-muted-foreground">משעה</span>
                    <input
                      type="time"
                      value={window.start}
                      onChange={(event) => updateWindow(window.key, { start: event.currentTarget.value })}
                      className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                      dir="ltr"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-black text-muted-foreground">עד שעה</span>
                    <input
                      type="time"
                      value={window.end}
                      onChange={(event) => updateWindow(window.key, { end: event.currentTarget.value })}
                      className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                      dir="ltr"
                    />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-black text-muted-foreground">כמה משלוחים בחלון</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="פחות משלוחים"
                        onClick={() => stepCapacity(window.key, -1)}
                        disabled={window.capacity <= MIN_CAPACITY}
                        className="flex size-11 items-center justify-center rounded-xl border border-border bg-card font-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <LocalIcon name="ph:caret-down-bold" className="text-base" />
                      </button>
                      <span className="w-10 text-center text-sm font-black" dir="ltr">{window.capacity}</span>
                      <button
                        type="button"
                        aria-label="עוד משלוחים"
                        onClick={() => stepCapacity(window.key, 1)}
                        disabled={window.capacity >= MAX_CAPACITY}
                        className="flex size-11 items-center justify-center rounded-xl border border-border bg-card font-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <LocalIcon name="ph:caret-up-bold" className="text-base" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWindow(window.key)}
                    className="ms-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/20 bg-card px-4 text-xs font-black text-destructive hover:bg-secondary"
                  >
                    <LocalIcon name="ph:x-bold" className="text-base" />
                    <span>הסרת החלון</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {validationMessage !== null && (
            <p role="alert" className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-950">
              <LocalIcon name="ph:warning-circle-bold" className="text-lg" />
              <span>{validationMessage}</span>
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addWindow}
              disabled={windows.length >= MAX_WINDOWS}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/20 bg-card px-5 text-sm font-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LocalIcon name="ph:plus-bold" className="text-lg" />
              <span>הוספת חלון</span>
            </button>
            <button
              type="button"
              onClick={() => { void save() }}
              disabled={saveState === 'saving' || validationMessage !== null}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LocalIcon name="ph:floppy-disk-bold" className="text-lg" />
              <span>{saveState === 'saving' ? 'שומרת...' : 'שמירת החלונות'}</span>
            </button>
            {saveState === 'saved' && <span className="text-sm font-black text-emerald-700">נשמר ✓</span>}
            {saveState === 'error' && (
              <span role="alert" className="text-sm font-black text-destructive">השמירה נכשלה. אפשר לנסות שוב.</span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
