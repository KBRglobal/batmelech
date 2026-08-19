import { useEffect, useState } from 'react'
import { z } from 'zod'
import { LocalIcon } from './local-icon.tsx'

// The purchased plan card inside Settings: how much of the 2 GB storage
// plan is used, the domain's validity, and — when the plan is full or
// close to it — the purchase links for the 10 GB upgrade.

const StoragePlanSchema = z.object({
  usedBytes: z.number().nonnegative(),
  objectCount: z.number().nonnegative(),
  limitBytes: z.number().positive(),
  upgradeUrlYearly: z.string(),
  upgradeUrlMonthly: z.string(),
  domainName: z.string(),
  domainExpiry: z.string(),
  supportContact: z.string(),
})

type StoragePlan = z.infer<typeof StoragePlanSchema>

function formatGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2)
}

export function StoragePlanSection() {
  const [plan, setPlan] = useState<StoragePlan | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/storage-plan', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const parsed = StoragePlanSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('bad payload')
        if (!cancelled) setPlan(parsed.data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return null

  const percent = plan ? Math.min((plan.usedBytes / plan.limitBytes) * 100, 100) : 0
  const nearFull = percent >= 80
  const full = plan !== null && plan.usedBytes >= plan.limitBytes
  const expiry = plan && plan.domainExpiry !== '' ? new Date(plan.domainExpiry) : null

  return (
    <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:hard-drives-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">החבילה שלך</h2>
      </div>

      {plan === null ? (
        <p className="mt-4 text-xs font-bold text-muted-foreground">טוען נתוני אחסון…</p>
      ) : (
        <>
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs font-black text-muted-foreground">
              <span>אחסון</span>
              <span dir="ltr">
                {formatGb(plan.usedBytes)} / {formatGb(plan.limitBytes)} GB
              </span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-secondary/60">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  full ? 'bg-rose-600' : nearFull ? 'bg-amber-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.max(percent, 1)}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              {plan.objectCount} קבצים · {percent.toFixed(1)}% בשימוש
            </p>
          </div>

          {full && (
            <p className="mt-4 rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-xs font-black leading-6 text-rose-700">
              חבילת האחסון מלאה — לא ניתן להעלות קבצים חדשים עד הרחבת החבילה.
            </p>
          )}

          {(plan.upgradeUrlYearly !== '' || plan.upgradeUrlMonthly !== '') && (
            <div className="mt-4 flex flex-wrap gap-3">
              {plan.upgradeUrlYearly !== '' && (
                <a
                  href={plan.upgradeUrlYearly}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90"
                >
                  הרחבה ל-10 GB — 480 AED לשנה
                </a>
              )}
              {plan.upgradeUrlMonthly !== '' && (
                <a
                  href={plan.upgradeUrlMonthly}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-primary px-6 text-sm font-black text-primary transition-colors hover:bg-secondary/40"
                >
                  הרחבה ל-10 GB — 40 AED לחודש
                </a>
              )}
            </div>
          )}

          <div className="mt-6 border-t border-border pt-5">
            <div className="flex items-center gap-3">
              <LocalIcon name="ph:globe-bold" className="text-lg text-accent" />
              <p className="text-sm font-black text-primary" dir="rtl">
                {expiry !== null ? (
                  <>
                    הדומיין {plan.domainName} בתוקף עד {expiry.toLocaleDateString('he-IL')}
                  </>
                ) : (
                  <>הדומיין {plan.domainName} פעיל</>
                )}
              </p>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              לחידוש הדומיין ולהרחבות יש לפנות ל-{plan.supportContact}.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
