import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { OperationsAiAdvisory } from '../components/operations-ai-advisory.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import {
  isSameVersionedStateEnvelope,
  type ConfirmedStoreSaveHandler,
} from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import { getUsdMinorUnits } from '../domain/money.ts'
import {
  applyPreparationCompletion,
  isPreparationCompleted,
  type PreparationCompletionCategory,
} from '../domain/operational-state.ts'
import { buildPreparationOperationsReview } from '../domain/operations-review.ts'
import {
  buildPreparationPlan,
  type PreparationCatalog,
  type PreparationCategoryGroups,
  type PreparationDateGroup,
  type PreparationPlan,
  type PreparationWarning,
} from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

const EMPTY_CATALOG: PreparationCatalog = { items: [], lunchItems: [] }

const linkClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

type CatalogState = 'configured' | 'missing' | 'invalid'

interface PreparationInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
}

interface CompletionSaveState {
  readonly kind: 'saving' | 'saved' | 'error'
  readonly message: string
}

type ToggleCompletion = (
  serviceDate: string,
  category: PreparationCompletionCategory,
  itemName: string,
  completed: boolean,
) => void

function storedCatalog(store: LegacyStore): unknown {
  return (store as Readonly<Record<string, unknown>>).preparationCatalog
}

function safePreparationPlan(store: LegacyStore): {
  readonly plan: PreparationPlan
  readonly catalogState: CatalogState
} {
  const rawCatalog = storedCatalog(store)
  if (rawCatalog === undefined) {
    return { plan: buildPreparationPlan(store.orders, EMPTY_CATALOG), catalogState: 'missing' }
  }
  try {
    return {
      plan: buildPreparationPlan(store.orders, rawCatalog as PreparationCatalog),
      catalogState: 'configured',
    }
  } catch {
    return { plan: buildPreparationPlan(store.orders, EMPTY_CATALOG), catalogState: 'invalid' }
  }
}

function formatServiceDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function warningText(warning: PreparationWarning): string {
  if (warning.code === 'MISSING_ORDER_ID') return 'הזמנה פעילה ללא מזהה בטוח.'
  if (warning.code === 'MISSING_SERVICE_DATE') return 'הזמנה פעילה ללא תאריך לא נכללה בהכנות.'
  if (warning.code === 'INVALID_SERVICE_DATE') return 'הזמנה עם תאריך לא תקין לא נכללה בהכנות.'
  if (warning.code === 'INVALID_MONEY' || warning.code === 'MONEY_OVERFLOW') {
    return 'סכום או מקדמה אינם תקינים, ולכן הסיכום הכספי אינו מלא.'
  }
  if (warning.code === 'INVALID_QUANTITY' || warning.code === 'QUANTITY_OVERFLOW') {
    return `כמות לא תקינה בשדה ${warning.path}.`
  }
  if (warning.code === 'UNKNOWN_CATALOG_ITEM') {
    return `הפריט בשדה ${warning.path} אינו מחובר לקטלוג הכנה יציב.`
  }
  if (warning.code === 'UNKNOWN_LUNCH_ITEM') {
    return `פריט הצהריים בשדה ${warning.path} אינו מחובר לקטלוג הכנה יציב.`
  }
  if (warning.code === 'LUNCH_VARIANT_FALLBACK') {
    return `וריאציית צהריים לא מוכרת בשדה ${warning.path}; הוצגה ברירת המחדל השמורה.`
  }
  return `מבנה לא צפוי בשדה ${warning.path}.`
}

function ConfigurationWarning({ state }: { state: Exclude<CatalogState, 'configured'> }) {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-2xl text-amber-700" />
        <div>
          <h2 className="font-black text-primary">
            {state === 'missing' ? 'קטלוג ההכנה עדיין לא נשמר' : 'קטלוג ההכנה השמור אינו תקין'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            הכמויות הגולמיות מוצגות מההזמנות, אבל מנות שלא חוברו למזהה יציב לא יעברו
            לרשימת הקניות עד שהקטלוג יתוקן.
          </p>
          <Link className="mt-3 inline-block text-sm font-black text-primary underline underline-offset-4" to={APP_ROUTES.recipeSettings}>
            להגדרת מתכונים ומצרכים
          </Link>
        </div>
      </div>
    </section>
  )
}

function DataWarnings({ warnings }: { warnings: readonly PreparationWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-2xl text-destructive" />
        <div className="min-w-0">
          <h2 className="font-black text-primary">יש נתונים שדורשים בדיקה לפני ההכנה</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-900">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(warning.orderId)}-${warning.path}-${index}`}>
                {warningText(warning)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value, invalid = false }: { label: string; value: string; invalid?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className="text-[0.6875rem] font-black text-muted-foreground">{label}</span>
      <strong className={`mt-1 block text-xl font-black ${invalid ? 'text-destructive' : 'text-primary'}`}>
        {value}
      </strong>
    </div>
  )
}

function completionStateKey(
  serviceDate: string,
  category: PreparationCompletionCategory,
  itemName: string,
): string {
  return JSON.stringify([serviceDate, category, itemName])
}

function CompletionControl({
  serviceDate,
  category,
  itemName,
  store,
  onToggle,
  saveState,
  saveBlocked,
}: {
  serviceDate: string
  category: PreparationCompletionCategory
  itemName: string
  store: Readonly<LegacyStore>
  onToggle?: ToggleCompletion
  saveState?: CompletionSaveState
  saveBlocked: boolean
}) {
  const completed = isPreparationCompleted(store, serviceDate, category, itemName)
  const unavailable = onToggle === undefined
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        aria-pressed={completed}
        aria-label={
          unavailable
            ? `סימון הכנת ${itemName} לא זמין`
            : completed
              ? `פתיחת הכנת ${itemName}`
              : `סיום הכנת ${itemName}`
        }
        disabled={unavailable || saveBlocked || saveState?.kind === 'saving'}
        onClick={() => onToggle?.(serviceDate, category, itemName, !completed)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60 ${
          completed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-border bg-card text-primary hover:bg-secondary'
        }`}
      >
        <LocalIcon name="ph:check-circle-bold" className="text-base" />
        <span>{saveState?.kind === 'saving' ? 'שומרת...' : completed ? 'הושלם' : 'סימון הושלם'}</span>
      </button>
      {saveState !== undefined && saveState.kind !== 'saving' && (
        <span
          className={`max-w-56 text-left text-[0.6875rem] font-bold ${saveState.kind === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
          role={saveState.kind === 'error' ? 'alert' : 'status'}
        >
          {saveState.message}
        </span>
      )}
    </div>
  )
}

function NumberCategory({
  title,
  category,
  values,
  serviceDate,
  store,
  onToggle,
  saveStates,
  saveBlocked,
}: {
  title: string
  category: Exclude<PreparationCompletionCategory, 'salads'>
  values: Readonly<Record<string, number>>
  serviceDate: string
  store: Readonly<LegacyStore>
  onToggle?: ToggleCompletion
  saveStates: Readonly<Record<string, CompletionSaveState>>
  saveBlocked: boolean
}) {
  const entries = Object.entries(values)
  if (entries.length === 0) return null
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black text-primary">
        <LocalIcon name="ph:cooking-pot-bold" className="text-lg" />
        <span>{title}</span>
      </h3>
      <ul className="mt-4 divide-y divide-border">
        {entries.map(([name, quantity]) => (
          <li key={name} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1 text-sm font-bold text-foreground">{name}</span>
            <strong className="rounded-full bg-secondary px-3 py-1 text-sm font-black text-primary">{quantity}</strong>
            <CompletionControl
              serviceDate={serviceDate}
              category={category}
              itemName={name}
              store={store}
              onToggle={onToggle}
              saveState={saveStates[completionStateKey(serviceDate, category, name)]}
              saveBlocked={saveBlocked}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function SaladCategory({
  values,
  serviceDate,
  store,
  onToggle,
  saveStates,
  saveBlocked,
}: {
  values: PreparationCategoryGroups['salads']
  serviceDate: string
  store: Readonly<LegacyStore>
  onToggle?: ToggleCompletion
  saveStates: Readonly<Record<string, CompletionSaveState>>
  saveBlocked: boolean
}) {
  const entries = Object.entries(values)
  if (entries.length === 0) return null
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black text-primary">
        <LocalIcon name="ph:list-checks-bold" className="text-lg" />
        <span>סלטים</span>
      </h3>
      <ul className="mt-4 divide-y divide-border">
        {entries.map(([name, quantity]) => (
          <li key={name} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-bold text-foreground">{name}</span>
              {quantity.gift > 0 && (
                <span className="mt-0.5 block text-[0.6875rem] font-bold text-muted-foreground">
                  {quantity.ordered} בהזמנה + {quantity.gift} פינוק
                </span>
              )}
            </div>
            <strong className="rounded-full bg-secondary px-3 py-1 text-sm font-black text-primary">{quantity.total}</strong>
            <CompletionControl
              serviceDate={serviceDate}
              category="salads"
              itemName={name}
              store={store}
              onToggle={onToggle}
              saveState={saveStates[completionStateKey(serviceDate, 'salads', name)]}
              saveBlocked={saveBlocked}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Notes({ group }: { group: PreparationDateGroup }) {
  const hasNotes =
    group.heatNotes.length > 0 ||
    group.generalNotes.length > 0 ||
    group.extraDetails.length > 0 ||
    group.lunchDetails.length > 0
  if (!hasNotes) return null

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-black text-primary">
        <LocalIcon name="ph:warning-circle-bold" className="text-lg" />
        <span>הערות ופריטים לפי לקוחה</span>
      </h3>
      <ul className="mt-4 space-y-3">
        {group.heatNotes.map((note, index) => (
          <li key={`heat-${String(note.orderId)}-${index}`} className="rounded-2xl bg-secondary/60 p-4 text-sm leading-6">
            <strong className="text-primary">{note.customerName || 'ללא שם'}:</strong> {note.text}
          </li>
        ))}
        {group.generalNotes.map((note, index) => (
          <li key={`general-${String(note.orderId)}-${note.source}-${index}`} className="rounded-2xl bg-secondary/60 p-4 text-sm leading-6">
            <strong className="text-primary">{note.customerName || 'ללא שם'}:</strong> {note.text}
          </li>
        ))}
        {group.extraDetails.map((detail, index) => (
          <li key={`extra-${String(detail.orderId)}-${detail.itemName}-${index}`} className="rounded-2xl bg-secondary/60 p-4 text-sm leading-6">
            <strong className="text-primary">{detail.customerName || 'ללא שם'}:</strong>{' '}
            {detail.itemName} ×{detail.quantity}{detail.note ? ` — ${detail.note}` : ''}
          </li>
        ))}
        {group.lunchDetails.map((detail, index) => (
          <li key={`lunch-${String(detail.orderId)}-${detail.preparationKey}-${index}`} className="rounded-2xl bg-secondary/60 p-4 text-sm leading-6">
            <strong className="text-primary">{detail.customerName || 'ללא שם'}:</strong>{' '}
            {detail.itemName} ×{detail.quantity}
            {detail.sides.length > 0
              ? ` — ${detail.sides.map((side) => `${side.itemName} ×${side.quantity}`).join(', ')}`
              : ''}
            {detail.addonQuantity > 0 ? ` — תוספת למנה ×${detail.addonQuantity}` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DatePreparation({
  group,
  store,
  onToggle,
  saveStates,
  saveBlocked,
}: {
  group: PreparationDateGroup
  store: Readonly<LegacyStore>
  onToggle?: ToggleCompletion
  saveStates: Readonly<Record<string, CompletionSaveState>>
  saveBlocked: boolean
}) {
  const categories = group.categories
  const financeValid = group.finance.valid
  return (
    <section className="space-y-6" data-preparation-date={group.serviceDate}>
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-primary">{formatServiceDate(group.serviceDate)}</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{group.orderCount} הזמנות פעילות</p>
        </div>
        <Link
          to={{ pathname: APP_ROUTES.shoppingList, search: `?${new URLSearchParams({ date: group.serviceDate })}` }}
          className={linkClassName}
        >
          <LocalIcon name="ph:shopping-cart-bold" className="text-lg" />
          <span>רשימת קניות לתאריך</span>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="זוגיות" value={String(group.meals)} />
        <Metric label="עריכות" value={String(group.aricha)} />
        <Metric label="חלות" value={String(group.challot)} />
        <Metric
          label="הכנסה"
          value={financeValid ? formatUsdMinorUnits(getUsdMinorUnits(group.finance.revenue)) : 'לא מלא'}
          invalid={!financeValid}
        />
        <Metric
          label="מקדמות"
          value={financeValid ? formatUsdMinorUnits(getUsdMinorUnits(group.finance.deposits)) : 'לא מלא'}
          invalid={!financeValid}
        />
        <Metric
          label="נותר לגבות"
          value={financeValid ? formatUsdMinorUnits(getUsdMinorUnits(group.finance.outstanding)) : 'לא מלא'}
          invalid={!financeValid}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <SaladCategory values={categories.salads} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="מנות ראשונות" category="firsts" values={categories.firsts} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="מנות עיקריות" category="mains" values={categories.mains} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="תוספות" category="sides" values={categories.sides} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="קינוחים" category="desserts" values={categories.desserts} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="אקסטרות" category="extras" values={categories.extras} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="פריטים מותאמים" category="custom" values={categories.custom} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
        <NumberCategory title="תפריט צהריים" category="lunch" values={categories.lunch} serviceDate={group.serviceDate} store={store} onToggle={onToggle} saveStates={saveStates} saveBlocked={saveBlocked} />
      </div>

      <Notes group={group} />
    </section>
  )
}

export function PreparationScreen({ onSave }: { readonly onSave?: ConfirmedStoreSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<PreparationInitialization | null>(null)
  const acceptedEnvelopeRef = useRef<VersionedStateEnvelope | null>(null)
  const writeInFlightRef = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [writeInFlight, setWriteInFlight] = useState(false)
  const [saveStates, setSaveStates] = useState<Readonly<Record<string, CompletionSaveState>>>({})

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore: storeQuery.data.data,
    }
  }
  if (
    acceptedEnvelopeRef.current !== null &&
    isSameVersionedStateEnvelope(storeQuery.data, acceptedEnvelopeRef.current)
  ) {
    initializationRef.current = {
      baseEnvelope: acceptedEnvelopeRef.current,
      baseStore: acceptedEnvelopeRef.current.data,
    }
    acceptedEnvelopeRef.current = null
  }

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את סיכום ההכנות" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את ההכנות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }

  const initialization = initializationRef.current
  if (initialization === null) {
    return <ScreenState kind="error" title="לא הצלחנו לטעון את ההכנות" retry={() => void storeQuery.refetch()} />
  }
  const store = initialization.baseStore
  const { plan, catalogState } = safePreparationPlan(store)
  const requestedDate = searchParams.get('date')?.trim() ?? ''
  const visibleDates = requestedDate === ''
    ? plan.dates
    : plan.dates.filter(({ serviceDate }) => serviceDate === requestedDate)
  const operationsReview = buildPreparationOperationsReview(plan, requestedDate)

  const toggleCompletion = onSave === undefined
    ? undefined
    : async (
        serviceDate: string,
        category: PreparationCompletionCategory,
        itemName: string,
        completed: boolean,
      ) => {
        const stateKey = completionStateKey(serviceDate, category, itemName)
        const baseEnvelope = initialization.baseEnvelope
        if (
          baseEnvelope === null ||
          acceptedEnvelopeRef.current !== null ||
          writeInFlightRef.current ||
          !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)
        ) {
          setSaveStates((current) => ({
            ...current,
            [stateKey]: {
              kind: 'error',
              message: 'הנתונים השתנו. הסימון לא נשמר; צריך לטעון מחדש.',
            },
          }))
          return
        }

        let nextStore: LegacyStore
        try {
          nextStore = applyPreparationCompletion(
            initialization.baseStore,
            serviceDate,
            category,
            itemName,
            completed,
          )
        } catch {
          setSaveStates((current) => ({
            ...current,
            [stateKey]: {
              kind: 'error',
              message: 'זהות שורת ההכנה או מפת הסימונים אינן בטוחות. לא בוצע שינוי.',
            },
          }))
          return
        }

        setSaveStates((current) => ({
          ...current,
          [stateKey]: { kind: 'saving', message: 'שומרת...' },
        }))
        writeInFlightRef.current = true
        setWriteInFlight(true)
        try {
          const confirmedEnvelope = await onSave({
            reason: 'preparation',
            baseEnvelope,
            baseStore: initialization.baseStore,
            nextStore,
          })
          acceptedEnvelopeRef.current = confirmedEnvelope
          initializationRef.current = {
            baseEnvelope: confirmedEnvelope,
            baseStore: confirmedEnvelope.data,
          }
          setSaveStates((current) => ({
            ...current,
            [stateKey]: {
              kind: 'saved',
              message: completed ? 'סומן כהושלם.' : 'הסימון נפתח מחדש.',
            },
          }))
        } catch {
          setSaveStates((current) => ({
            ...current,
            [stateKey]: {
              kind: 'error',
              message: 'השמירה נכשלה או התנגשה בעדכון אחר. הסימון הקיים נשאר.',
            },
          }))
        } finally {
          writeInFlightRef.current = false
          setWriteInFlight(false)
        }
      }

  if (plan.dates.length === 0 && plan.warnings.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title="אין הזמנות פעילות להכנה"
        description="הכמויות יופיעו כאן מיד כשתהיה הזמנה עם תאריך תקין."
        action={{ label: 'לכל ההזמנות', icon: 'ph:list-checks-bold', to: APP_ROUTES.orders }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">סיכום הכנות</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">כמויות, הערות וגבייה מתוך ההזמנות השמורות.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Link to={APP_ROUTES.preparationLabels} className={linkClassName}>
            <LocalIcon name="ph:package-bold" className="text-lg" />
            <span>מדבקות הכנה</span>
          </Link>
          <label className="flex flex-col gap-1 text-xs font-black text-muted-foreground">
            תאריך הכנה
            <select
              aria-label="תאריך הכנה"
              value={requestedDate}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams)
                if (event.currentTarget.value === '') next.delete('date')
                else next.set('date', event.currentTarget.value)
                setSearchParams(next)
              }}
              className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">כל התאריכים</option>
              {plan.dates.map(({ serviceDate }) => (
                <option key={serviceDate} value={serviceDate}>{formatServiceDate(serviceDate)}</option>
              ))}
            </select>
          </label>
          {onSave === undefined && (
            <button
              type="button"
              disabled
              title="סימון הכנות דורש חיבור לשמירה המוגנת"
              className="min-h-11 cursor-not-allowed rounded-full border border-border bg-muted px-5 text-sm font-bold text-muted-foreground opacity-70"
            >
              סימון הושלם לא זמין
            </button>
          )}
        </div>
      </header>

      <div className="mt-8 space-y-8">
        <OperationsAiAdvisory key={operationsReview.key} presentation={operationsReview} />
        {catalogState !== 'configured' && <ConfigurationWarning state={catalogState} />}
        <DataWarnings warnings={plan.warnings} />
        {visibleDates.length === 0 ? (
          <ScreenState
            kind="empty"
            title="אין הכנות לתאריך שנבחר"
            description="אפשר לבחור תאריך אחר בלי לשנות אף הזמנה."
            className="px-0"
          />
        ) : (
          visibleDates.map((group) => (
            <DatePreparation
              key={group.serviceDate}
              group={group}
              store={store}
              onToggle={toggleCompletion}
              saveStates={saveStates}
              saveBlocked={writeInFlight || acceptedEnvelopeRef.current !== null}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default PreparationScreen
