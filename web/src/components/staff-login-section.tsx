import { useEffect, useState } from 'react'
import { LocalIcon } from './local-icon.tsx'

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const inputClassName =
  'mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none'

export function StaffLoginSection() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/staff-credentials/status')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setConfigured(Boolean((data as { configured?: boolean } | null)?.configured))
      })
      .catch(() => {
        if (!cancelled) setConfigured(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    if (username.trim().length < 3) {
      setStatus({ kind: 'error', message: 'שם המשתמש קצר מדי (לפחות 3 תווים).' })
      return
    }
    if (password.length < 8) {
      setStatus({ kind: 'error', message: 'הסיסמה קצרה מדי (לפחות 8 תווים).' })
      return
    }
    if (password !== confirmPassword) {
      setStatus({ kind: 'error', message: 'הסיסמה ואימות הסיסמה לא תואמים.' })
      return
    }
    setStatus({ kind: 'busy' })
    try {
      const response = await fetch('/api/settings/staff-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!response.ok) throw new Error('save failed')
      setConfigured(true)
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setStatus({ kind: 'success', message: 'הכניסה עודכנה. משתמשים בה בפעם הבאה שנכנסים לפאנל.' })
    } catch {
      setStatus({ kind: 'error', message: 'השמירה נכשלה. הכניסה הקודמת עדיין בתוקף.' })
    }
  }

  return (
    <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:gear-six-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">כניסה לפאנל</h2>
        {configured !== null && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              configured ? 'bg-emerald-50 text-emerald-800' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {configured ? 'הוגדרה כניסה אישית' : 'ברירת מחדל'}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs font-bold leading-6 text-muted-foreground">
        שם משתמש וסיסמה אישיים לכניסה לפאנל. מוצפנים בשמירה, לא נשמרים כטקסט גלוי, ולא מוצגים כאן שוב אחרי
        שמירה — צריך לזכור אותם.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="text-xs font-black text-muted-foreground">
          שם משתמש חדש
          <input
            aria-label="שם משתמש חדש"
            dir="ltr"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            className={inputClassName}
          />
        </label>
        <div aria-hidden="true" className="hidden md:block" />
        <label className="text-xs font-black text-muted-foreground">
          סיסמה חדשה
          <input
            aria-label="סיסמה חדשה"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            className={inputClassName}
          />
        </label>
        <label className="text-xs font-black text-muted-foreground">
          אימות סיסמה
          <input
            aria-label="אימות סיסמה"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            className={inputClassName}
          />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={status.kind === 'busy'}
          className="min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-primary-foreground disabled:opacity-50"
        >
          שמירת פרטי הכניסה
        </button>
        {status.kind !== 'idle' && (
          <p
            role={status.kind === 'error' ? 'alert' : 'status'}
            className={`text-xs font-black ${status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {status.kind === 'busy' ? 'שומרת...' : status.message}
          </p>
        )}
      </div>
    </section>
  )
}

export default StaffLoginSection
