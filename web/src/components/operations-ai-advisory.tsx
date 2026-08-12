import { useState } from 'react'
import type { OperationsReviewPresentation } from '../domain/operations-review.ts'
import {
  requestOperationsReview,
  type OperationsReview,
} from '../services/operations-review-api.ts'
import { LocalIcon } from './local-icon.tsx'

type ReviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly review: OperationsReview }

const PRIORITY_LABELS = {
  low: 'נמוכה',
  medium: 'בינונית',
  high: 'גבוהה',
} as const

const FINDING_LABELS = {
  unusual_quantity: 'כמות חריגה',
  configuration_gap: 'פער בהגדרות',
  unit_conflict: 'סתירת יחידות',
  delivery_risk: 'סיכון במשלוח',
  data_quality: 'איכות נתונים',
} as const

export function OperationsAiAdvisory({
  presentation,
}: {
  readonly presentation: OperationsReviewPresentation
}) {
  const [state, setState] = useState<ReviewState>({ kind: 'idle' })
  const hasInput = presentation.snapshot.demands.length > 0 || presentation.snapshot.warnings.length > 0

  const review = async () => {
    if (!hasInput || state.kind === 'loading') return
    setState({ kind: 'loading' })
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 25_000)
    try {
      const result = await requestOperationsReview(presentation.snapshot, controller.signal)
      setState({ kind: 'ready', review: result })
    } catch {
      setState({ kind: 'error' })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return (
    <section className="rounded-3xl border border-sky-200 bg-sky-50/60 p-5" aria-labelledby="operations-ai-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <LocalIcon name="ph:chart-pie-slice-bold" className="mt-0.5 text-2xl text-sky-700" />
          <div>
            <h2 id="operations-ai-title" className="font-black text-primary">בדיקת AI ייעוצית</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-sky-950">
              הייעוץ מקבל רק כמויות מצטברות וקודי אזהרה. הוא לא מקבל פרטי לקוחות ולא משנה הזמנות, כמויות, מתכונים או נתונים.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={!hasInput || state.kind === 'loading'}
          onClick={() => { void review() }}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          <LocalIcon name="ph:chart-pie-slice-bold" className="text-lg" />
          <span>{state.kind === 'loading' ? 'בודקת...' : 'קבלת ייעוץ'}</span>
        </button>
      </div>

      {!hasInput && (
        <p className="mt-4 text-sm font-bold text-muted-foreground">אין כרגע נתונים מצטברים שאפשר לבדוק.</p>
      )}
      {state.kind === 'error' && (
        <p className="mt-4 text-sm font-black text-destructive" role="alert">
          הייעוץ לא זמין כרגע. הנתונים נשארו ללא שינוי.
        </p>
      )}
      {state.kind === 'ready' && (
        <div className="mt-5 border-t border-sky-200 pt-5" role="status">
          <p className="text-sm font-black leading-6 text-primary">{state.review.overview}</p>
          {state.review.findings.length === 0 ? (
            <p className="mt-3 text-sm font-bold text-muted-foreground">לא נמצאה אזהרה ייעוצית נוספת מעבר לחישוב המערכת.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {state.review.findings.map((finding, index) => (
                <li key={`${finding.kind}-${finding.sourceIds.join('-')}-${index}`} className="rounded-2xl border border-sky-200 bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-black">
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">{FINDING_LABELS[finding.kind]}</span>
                    <span className="text-muted-foreground">עדיפות {PRIORITY_LABELS[finding.priority]}</span>
                  </div>
                  <p className="mt-2 text-sm font-bold leading-6 text-foreground">{finding.explanation}</p>
                  <p className="mt-2 text-xs font-bold text-muted-foreground">
                    מבוסס על: {finding.sourceIds.map((id) => presentation.sourceLabels[id] ?? 'נתון מצטבר').join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs font-black text-sky-900">זהו ייעוץ בלבד. ההחלטה והביצוע נשארים אצל המפעילה.</p>
        </div>
      )}
    </section>
  )
}
