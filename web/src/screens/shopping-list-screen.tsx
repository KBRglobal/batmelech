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
import { checkedAdd } from '../domain/money.ts'
import {
  applyShoppingCompletion,
  isShoppingCompleted,
  shoppingCompletionScope,
} from '../domain/operational-state.ts'
import { buildShoppingOperationsReview } from '../domain/operations-review.ts'
import {
  buildPreparationPlan,
  type PreparationItemDemand,
  type PreparationPlan,
} from '../domain/preparation.ts'
import {
  loadProductLibrary,
  minorUnitsToMoney,
  SUPPLIER_LABELS,
  type ProductLibraryEntry,
} from '../domain/product-library.ts'
import type { RecipeDefinition } from '../domain/recipes.ts'
import { resolvePreparationCatalog } from '../domain/settings-catalog.ts'
import {
  attachProcurement,
  type ProcurementShoppingListItem,
} from '../domain/shopping-list-procurement.ts'
import {
  buildShoppingList,
  type ShoppingListItem,
  type ShoppingListResult,
  type ShoppingListWarning,
} from '../domain/shopping-list.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type ConfigurationState = 'configured' | 'missing' | 'invalid'

interface ShoppingInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
}

interface ShoppingSaveState {
  readonly kind: 'saving' | 'saved' | 'error'
  readonly message: string
}

type ToggleShoppingCompletion = (
  item: ShoppingListItem,
  completed: boolean,
) => void

function storedValue(store: LegacyStore, key: string): unknown {
  return (store as Readonly<Record<string, unknown>>)[key]
}

function safePreparation(store: LegacyStore): {
  readonly plan: PreparationPlan
  readonly catalogState: ConfigurationState
} {
  const resolvedCatalog = resolvePreparationCatalog(store)
  return {
    plan: buildPreparationPlan(store.orders, resolvedCatalog.catalog),
    catalogState: resolvedCatalog.state,
  }
}

function storedRecipes(store: LegacyStore): {
  readonly recipes: readonly RecipeDefinition[]
  readonly state: ConfigurationState
} {
  const value = storedValue(store, 'recipes')
  if (value === undefined) return { recipes: [], state: 'missing' }
  if (!Array.isArray(value)) return { recipes: [], state: 'invalid' }
  return { recipes: value as readonly RecipeDefinition[], state: 'configured' }
}

function formatServiceDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function safeCountSum(values: readonly number[]): number | null {
  try {
    return values.reduce((sum, value) => checkedAdd(sum, value, 'shopping.summary'), 0)
  } catch {
    return null
  }
}

function warningText(warning: ShoppingListWarning, demands: readonly PreparationItemDemand[]): string {
  const itemName = demands.find(({ itemId }) => itemId === warning.itemId)?.itemName ?? warning.itemId ?? 'פריט'
  if (warning.code === 'MISSING_RECIPE') {
    return `למנה ${itemName} אין מתכון שמור, ולכן המצרכים שלה לא חושבו.`
  }
  if (warning.code === 'INVALID_RECIPE') {
    return `המתכון של ${itemName} אינו תקין, ולכן הוא לא נכלל ברשימה.`
  }
  if (warning.code === 'INGREDIENT_IDENTITY_CONFLICT') {
    return 'אותו מזהה מצרך נשמר עם שמות שונים. המצרך לא נכלל עד לתיקון.'
  }
  if (warning.code === 'DEMAND_IDENTITY_CONFLICT') {
    return `הפריט ${itemName} מחובר להגדרות קנייה סותרות ולא חושב.`
  }
  if (warning.code === 'INVALID_DEMAND') return `דרישת הקנייה של ${itemName} אינה תקינה.`
  if (warning.code === 'DEMAND_OVERFLOW' || warning.code === 'QUANTITY_OVERFLOW') {
    return `הכמות של ${itemName} חורגת מטווח החישוב הבטוח.`
  }
  return `לא ניתן לחשב את ${itemName} בבטחה.`
}

function ConfigurationWarnings({ catalogState, recipeState }: {
  catalogState: ConfigurationState
  recipeState: ConfigurationState
}) {
  if (catalogState !== 'invalid' && recipeState === 'configured') return null
  const messages: string[] = []
  if (catalogState === 'invalid') {
    messages.push('קטלוג ההכנה השמור אינו תקין. החישוב משתמש זמנית בהגדרה התקינה ששוחזרה מהתפריט.')
  }
  if (recipeState === 'missing') {
    messages.push('לא נשמרו מתכונים, ולכן לא הומצאו מצרכים או כמויות חסרות.')
  } else if (recipeState === 'invalid') {
    messages.push('הגדרת המתכונים השמורה אינה מערך תקין, ולכן לא נעשה בה שימוש.')
  }
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-2xl text-amber-700" />
        <div>
          <h2 className="font-black text-primary">חסרה הגדרת קניות מאושרת</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-amber-900">
            {messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
          <Link to={APP_ROUTES.recipeSettings} className="mt-3 inline-block text-sm font-black text-primary underline underline-offset-4">
            להגדרת מתכונים ומצרכים
          </Link>
        </div>
      </div>
    </section>
  )
}

// An empty list has three very different meanings for the operator, and only
// one of them is a problem she can act on right now.
function emptyListState(
  demands: readonly PreparationItemDemand[],
  result: ShoppingListResult,
): { readonly title: string; readonly description: string } {
  if (demands.length === 0) {
    return {
      title: 'אין דרישות קנייה לתאריך שנבחר',
      description: 'אפשר לבחור תאריך אחר או לבדוק את ההזמנות הפעילות.',
    }
  }
  if (result.warnings.length > 0 && result.warnings.every(({ code }) => code === 'MISSING_RECIPE')) {
    return {
      title: 'אין עדיין מתכונים מוגדרים לתפריט',
      description: 'רשימת הקניות תתמלא אוטומטית לאחר הזנת מתכונים למנות.',
    }
  }
  return {
    title: 'לא חושבו מצרכים בבטחה',
    description: 'מוסיפים את המתכונים החסרים ורק אז המערכת תציג כמויות לקנייה.',
  }
}

function ShoppingWarnings({ result, demands }: { result: ShoppingListResult; demands: readonly PreparationItemDemand[] }) {
  if (result.warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-2xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">פריטים שלא חושבו בבטחה</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-900">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.itemId ?? ''}-${warning.serviceDate ?? ''}-${index}`}>
                {warningText(warning, demands)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function shoppingSaveStateKey(
  serviceDate: string | null,
  ingredientId: string,
  unit: string,
): string {
  return JSON.stringify([shoppingCompletionScope(serviceDate), ingredientId, unit])
}

function ShoppingRow({
  item,
  store,
  serviceDate,
  onToggle,
  saveState,
  saveBlocked,
}: {
  item: ProcurementShoppingListItem
  store: Readonly<LegacyStore>
  serviceDate: string | null
  onToggle?: ToggleShoppingCompletion
  saveState?: ShoppingSaveState
  saveBlocked: boolean
}) {
  const completed = isShoppingCompleted(store, serviceDate, item.ingredientId, item.unit)
  const unavailable = onToggle === undefined
  return (
    <article className={`rounded-3xl border bg-card p-5 shadow-sm ${completed ? 'border-emerald-200' : 'border-border'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={`text-lg font-black ${completed ? 'text-emerald-700 line-through' : 'text-primary'}`}>{item.ingredientName}</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">
            עבור: {item.sources.map(({ itemName }) => itemName).filter((name, index, names) => names.indexOf(name) === index).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="rounded-full bg-secondary px-4 py-2 text-base font-black text-primary" dir="ltr">
            {item.quantity} {item.unit}
          </strong>
          <button
            type="button"
            aria-pressed={completed}
            aria-label={
              unavailable
                ? `סימון ${item.ingredientName} לא זמין`
                : completed
                  ? `פתיחת קניית ${item.ingredientName}`
                  : `סימון ${item.ingredientName} כנקנה`
            }
            disabled={unavailable || saveBlocked || saveState?.kind === 'saving'}
            onClick={() => onToggle?.(item, !completed)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60 ${
              completed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            <LocalIcon name="ph:check-circle-bold" className="text-base" />
            <span>{saveState?.kind === 'saving' ? 'שומרת...' : completed ? 'נקנה' : 'סימון נקנה'}</span>
          </button>
        </div>
      </div>
      {item.procurement !== null && item.procurement.options.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-black">
          {item.procurement.options
            .filter((option) => option.comparable)
            .map((option) => (
              <span
                key={option.supplier}
                className={`rounded-full px-3 py-1 ${
                  option.supplier === item.procurement!.cheapestSupplier
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-secondary text-muted-foreground'
                }`}
              >
                {SUPPLIER_LABELS[option.supplier]}: {option.packsNeeded} אריזות · {minorUnitsToMoney(option.totalMinorUnits)} AED
              </span>
            ))}
          {item.procurement.kosherLocked && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">כשר — רק רימון</span>
          )}
        </div>
      )}
      {saveState !== undefined && saveState.kind !== 'saving' && (
        <p
          className={`mt-3 text-xs font-black ${saveState.kind === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
          role={saveState.kind === 'error' ? 'alert' : 'status'}
        >
          {saveState.message}
        </p>
      )}
      <details className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3">
        <summary className="cursor-pointer text-xs font-black text-primary">פירוט החישוב</summary>
        <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          {item.sources.map((source) => (
            <li key={`${source.serviceDate}-${source.itemId}`}>
              {formatServiceDate(source.serviceDate)} · {source.itemName} ×{source.demandedQuantity} · {source.ingredientQuantity} {item.unit}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}

export function ShoppingListScreen({ onSave }: { readonly onSave?: ConfirmedStoreSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<ShoppingInitialization | null>(null)
  const acceptedEnvelopeRef = useRef<VersionedStateEnvelope | null>(null)
  const writeInFlightRef = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [writeInFlight, setWriteInFlight] = useState(false)
  const [saveStates, setSaveStates] = useState<Readonly<Record<string, ShoppingSaveState>>>({})

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

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את רשימת הקניות" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את רשימת הקניות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }

  const initialization = initializationRef.current
  if (initialization === null) {
    return <ScreenState kind="error" title="לא הצלחנו לטעון את רשימת הקניות" retry={() => void storeQuery.refetch()} />
  }
  const store = initialization.baseStore
  const { plan, catalogState } = safePreparation(store)
  const recipeConfiguration = storedRecipes(store)
  const requestedDate = searchParams.get('date')?.trim() ?? ''
  const demands = requestedDate === ''
    ? plan.itemDemands
    : plan.itemDemands.filter(({ serviceDate }) => serviceDate === requestedDate)
  const result = buildShoppingList(demands, recipeConfiguration.recipes)
  const productLibrary = new Map<string, ProductLibraryEntry>(
    loadProductLibrary(store).entries.map((entry) => [entry.id, entry]),
  )
  const procurement = attachProcurement(result, productLibrary)
  const preparationGroups = requestedDate === ''
    ? plan.dates
    : plan.dates.filter(({ serviceDate }) => serviceDate === requestedDate)
  const orderCount = safeCountSum(preparationGroups.map(({ orderCount: count }) => count))
  const mealCount = safeCountSum(preparationGroups.map(({ meals }) => meals))
  const completionDate = requestedDate === '' ? null : requestedDate
  const operationsReview = buildShoppingOperationsReview(demands, result, requestedDate)
  const emptyState = emptyListState(demands, result)

  const toggleShopping = onSave === undefined
    ? undefined
    : async (item: ShoppingListItem, completed: boolean) => {
        const stateKey = shoppingSaveStateKey(completionDate, item.ingredientId, item.unit)
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
          nextStore = applyShoppingCompletion(
            initialization.baseStore,
            completionDate,
            item.ingredientId,
            item.unit,
            completed,
          )
        } catch {
          setSaveStates((current) => ({
            ...current,
            [stateKey]: {
              kind: 'error',
              message: 'זהות המצרך או מפת הסימונים אינן בטוחות. לא בוצע שינוי.',
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
            reason: 'shopping',
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
              message: completed ? 'המצרך סומן כנקנה.' : 'הסימון נפתח מחדש.',
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

  if (store.orders.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title="אין עדיין מה לקנות"
        description="רשימת המצרכים תיבנה מהזמנות פעילות ומתכונים מאושרים."
        action={{ label: 'לכל ההזמנות', icon: 'ph:list-checks-bold', to: APP_ROUTES.orders }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">רשימת קניות</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">רק כמויות שחושבו ממתכונים והגדרות קנייה שמורים.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-black text-muted-foreground">
            מה קונים
            <select
              aria-label="תאריך רשימת קניות"
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
              title="סימון קניות דורש חיבור לשמירה המוגנת"
              className="min-h-11 cursor-not-allowed rounded-full border border-border bg-muted px-5 text-sm font-bold text-muted-foreground opacity-70"
            >
              סימון נקנה לא זמין
            </button>
          )}
        </div>
      </header>

      <div className="mt-8 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <span className="text-[0.6875rem] font-black text-muted-foreground">הזמנות</span>
          <strong className={`mt-1 block text-xl font-black ${orderCount === null ? 'text-destructive' : 'text-primary'}`}>
            {orderCount ?? 'לא מלא'}
          </strong>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <span className="text-[0.6875rem] font-black text-muted-foreground">זוגיות</span>
          <strong className={`mt-1 block text-xl font-black ${mealCount === null ? 'text-destructive' : 'text-primary'}`}>
            {mealCount ?? 'לא מלא'}
          </strong>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <span className="text-[0.6875rem] font-black text-muted-foreground">מצרכים שחושבו</span>
          <strong className="mt-1 block text-xl font-black text-primary">{procurement.items.length}</strong>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        <OperationsAiAdvisory key={operationsReview.key} presentation={operationsReview} />
        <ConfigurationWarnings catalogState={catalogState} recipeState={recipeConfiguration.state} />
        <ShoppingWarnings result={result} demands={demands} />

        {procurement.items.length === 0 ? (
          <ScreenState
            kind="empty"
            title={emptyState.title}
            description={emptyState.description}
            action={{ label: 'להגדרת מתכונים', icon: 'ph:cooking-pot-bold', to: APP_ROUTES.recipeSettings }}
            className="px-0"
          />
        ) : (
          <section className="space-y-3" aria-label="מצרכים לקנייה">
            {procurement.items.map((item) => (
              <ShoppingRow
                key={`${item.ingredientId}-${item.unit}`}
                item={item}
                store={store}
                serviceDate={completionDate}
                onToggle={toggleShopping}
                saveState={saveStates[shoppingSaveStateKey(completionDate, item.ingredientId, item.unit)]}
                saveBlocked={writeInFlight || acceptedEnvelopeRef.current !== null}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

export default ShoppingListScreen
