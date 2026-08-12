import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { checkedAdd } from '../domain/money.ts'
import {
  buildPreparationPlan,
  type PreparationCatalog,
  type PreparationItemDemand,
  type PreparationPlan,
} from '../domain/preparation.ts'
import type { RecipeDefinition } from '../domain/recipes.ts'
import {
  buildShoppingList,
  type ShoppingListResult,
  type ShoppingListWarning,
} from '../domain/shopping-list.ts'
import type { LegacyStore } from '../domain/store.ts'

const EMPTY_CATALOG: PreparationCatalog = { items: [], lunchItems: [] }

type ConfigurationState = 'configured' | 'missing' | 'invalid'

function storedValue(store: LegacyStore, key: string): unknown {
  return (store as Readonly<Record<string, unknown>>)[key]
}

function safePreparation(store: LegacyStore): {
  readonly plan: PreparationPlan
  readonly catalogState: ConfigurationState
} {
  const rawCatalog = storedValue(store, 'preparationCatalog')
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
  if (catalogState === 'configured' && recipeState === 'configured') return null
  const messages: string[] = []
  if (catalogState === 'missing') {
    messages.push('לא נשמר קטלוג הכנה, ולכן אי אפשר לחבר את מנות ההזמנה למתכונים.')
  } else if (catalogState === 'invalid') {
    messages.push('קטלוג ההכנה השמור אינו תקין, ולכן לא נעשה בו שימוש.')
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

export function ShoppingListScreen() {
  const storeQuery = useStore()
  const [searchParams, setSearchParams] = useSearchParams()

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

  const store = storeQuery.data.data ?? { orders: [] }
  const { plan, catalogState } = safePreparation(store)
  const recipeConfiguration = storedRecipes(store)
  const requestedDate = searchParams.get('date')?.trim() ?? ''
  const demands = requestedDate === ''
    ? plan.itemDemands
    : plan.itemDemands.filter(({ serviceDate }) => serviceDate === requestedDate)
  const result = buildShoppingList(demands, recipeConfiguration.recipes)
  const preparationGroups = requestedDate === ''
    ? plan.dates
    : plan.dates.filter(({ serviceDate }) => serviceDate === requestedDate)
  const orderCount = safeCountSum(preparationGroups.map(({ orderCount: count }) => count))
  const mealCount = safeCountSum(preparationGroups.map(({ meals }) => meals))

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
          <button
            type="button"
            disabled
            title="סימון קניות יופעל רק אחרי חיבור השמירה המוגנת"
            className="min-h-11 cursor-not-allowed rounded-full border border-border bg-muted px-5 text-sm font-bold text-muted-foreground opacity-70"
          >
            סימון נקנה לא זמין
          </button>
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
          <strong className="mt-1 block text-xl font-black text-primary">{result.items.length}</strong>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        <ConfigurationWarnings catalogState={catalogState} recipeState={recipeConfiguration.state} />
        <ShoppingWarnings result={result} demands={demands} />

        {result.items.length === 0 ? (
          <ScreenState
            kind="empty"
            title={demands.length === 0 ? 'אין דרישות קנייה לתאריך שנבחר' : 'לא חושבו מצרכים בבטחה'}
            description={
              demands.length === 0
                ? 'אפשר לבחור תאריך אחר או לבדוק את ההזמנות הפעילות.'
                : 'מוסיפים את המתכונים החסרים ורק אז המערכת תציג כמויות לקנייה.'
            }
            action={{ label: 'להגדרת מתכונים', icon: 'ph:cooking-pot-bold', to: APP_ROUTES.recipeSettings }}
            className="px-0"
          />
        ) : (
          <section className="space-y-3" aria-label="מצרכים לקנייה">
            {result.items.map((item) => (
              <article key={`${item.ingredientId}-${item.unit}`} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-primary">{item.ingredientName}</h2>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      עבור: {item.sources.map(({ itemName }) => itemName).filter((name, index, names) => names.indexOf(name) === index).join(', ')}
                    </p>
                  </div>
                  <strong className="rounded-full bg-secondary px-4 py-2 text-base font-black text-primary" dir="ltr">
                    {item.quantity} {item.unit}
                  </strong>
                </div>
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
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

export default ShoppingListScreen
