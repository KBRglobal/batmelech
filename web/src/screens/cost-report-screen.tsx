import { Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  computeDishCosts,
  computeMissingData,
  computeMonthlyExpenses,
  computeOrderCosts,
  computeWeeklyCosts,
  type DishCostRow,
  type MissingDataReport,
  type MonthlyExpenseRow,
  type OrderCostRow,
  type WeeklyCostRow,
} from '../domain/cost-report.ts'
import { minorUnitsToMoney } from '../domain/product-library.ts'

const cardClassName = 'rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8'

function money(minorUnits: number): string {
  return `${minorUnitsToMoney(minorUnits)} AED`
}

function MarginText({ marginMinorUnits }: { readonly marginMinorUnits: number | null }) {
  if (marginMinorUnits === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={marginMinorUnits < 0 ? 'text-destructive' : 'text-emerald-700'}>
      {money(marginMinorUnits)}
    </span>
  )
}

function PartialBadge() {
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-800">חלקי</span>
}

function DishCostsCard({ rows }: { readonly rows: readonly DishCostRow[] }) {
  return (
    <section aria-label="עלות לפי מנה" className={cardClassName}>
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:cooking-pot-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">עלות לפי מנה</h2>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm font-bold text-muted-foreground">
          עוד אין מתכונים עם עלות.{' '}
          <Link to={APP_ROUTES.recipeSettings} className="font-black text-primary underline underline-offset-4">
            מגדירים מתכונים
          </Link>
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((row) => (
            <li key={row.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-primary">{row.name}</span>
                {!row.complete && <PartialBadge />}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground">
                <span>עלות למנה: {money(row.costPerPortionMinorUnits)}</span>
                {row.costPer100gMinorUnits !== null && <span>ל-100 גרם: {money(row.costPer100gMinorUnits)}</span>}
                {row.salePriceMinorUnits !== null && <span>מחיר מכירה: {money(row.salePriceMinorUnits)}</span>}
                <span>
                  רווח: <MarginText marginMinorUnits={row.marginMinorUnits} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OrderCostsCard({ rows }: { readonly rows: readonly OrderCostRow[] }) {
  return (
    <section aria-label="עלות לפי הזמנה" className={cardClassName}>
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:receipt-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">עלות לפי הזמנה</h2>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm font-bold text-muted-foreground">אין הזמנות פעילות עם תאריך.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((row) => (
            <li key={row.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-primary">{row.customerName || row.orderId}</span>
                <span className="text-xs font-bold text-muted-foreground">{row.serviceDate}</span>
                {!row.complete && <PartialBadge />}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground">
                <span>עלות חומרים: {money(row.costMinorUnits)}</span>
                <span>{row.revenueMinorUnits === null ? 'ללא מחיר' : `נגבה: ${money(row.revenueMinorUnits)}`}</span>
                <span>
                  רווח: <MarginText marginMinorUnits={row.marginMinorUnits} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WeeklyCostsCard({ rows }: { readonly rows: readonly WeeklyCostRow[] }) {
  if (rows.length === 0) return null
  return (
    <section aria-label="עלות לפי שבוע" className={cardClassName}>
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:calendar-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">לפי שבוע</h2>
      </div>
      <ul className="mt-5 space-y-3">
        {rows.map((row) => (
          <li key={row.weekStartIso} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-primary" dir="ltr">{row.label}</span>
              <span className="text-xs font-bold text-muted-foreground">{row.orderCount} הזמנות</span>
              {!row.complete && <PartialBadge />}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground">
              <span>עלות: {money(row.costMinorUnits)}</span>
              <span>הכנסה: {money(row.revenueMinorUnits)}</span>
              <span>
                רווח: <MarginText marginMinorUnits={row.marginMinorUnits} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MonthlyExpensesCard({ rows }: { readonly rows: readonly MonthlyExpenseRow[] }) {
  if (rows.length === 0) return null
  return (
    <section aria-label="הוצאות לפי חודש" className={cardClassName}>
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:coins-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">הוצאות לפי חודש</h2>
      </div>
      <p className="mt-2 text-xs font-bold text-muted-foreground">
        ההוצאות נרשמות במסך הכספים — כאן רואים את הסיכום מול ההכנסות של אותו חודש.
      </p>
      <ul className="mt-5 space-y-3">
        {rows.map((row) => (
          <li key={row.monthKey} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/30 px-4 py-3">
            <span className="text-sm font-black text-primary">{row.label}</span>
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-muted-foreground">
              <span>הוצאות: {money(row.expensesMinorUnits)}</span>
              <span>הכנסות: {money(row.revenueMinorUnits)}</span>
              <span>
                פער: <MarginText marginMinorUnits={row.revenueMinorUnits - row.expensesMinorUnits} />
              </span>
              {row.invalidCount > 0 && <PartialBadge />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MissingDataCard({ report }: { readonly report: MissingDataReport }) {
  const empty =
    report.dishesWithoutRecipes.length === 0 &&
    report.unpricedIngredients.length === 0 &&
    report.staleProducts.length === 0
  return (
    <section aria-label="חוסרים" className={cardClassName}>
      <div className="flex items-center gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="text-xl text-accent" />
        <h2 className="text-xl font-black text-primary">חוסרים</h2>
      </div>
      {empty ? (
        <p className="mt-4 text-sm font-bold text-emerald-700">אין חוסרים — כל הנתונים מלאים.</p>
      ) : (
        <div className="mt-5 space-y-4 text-sm font-bold text-muted-foreground">
          {report.dishesWithoutRecipes.length > 0 && (
            <div>
              <p className="font-black text-primary">
                {report.dishesWithoutRecipes.length} מנות בלי מתכון —{' '}
                <Link to={APP_ROUTES.recipeSettings} className="underline underline-offset-4">
                  להשלמה במתכונים
                </Link>
              </p>
              <p className="mt-1 text-xs">{report.dishesWithoutRecipes.slice(0, 8).map((dish) => dish.name).join(' · ')}{report.dishesWithoutRecipes.length > 8 ? ' · ...' : ''}</p>
            </div>
          )}
          {report.unpricedIngredients.length > 0 && (
            <div>
              <p className="font-black text-primary">
                {report.unpricedIngredients.length} מצרכים בלי מחיר —{' '}
                <Link to={APP_ROUTES.productLibrary} className="underline underline-offset-4">
                  להשלמה בספריית המוצרים
                </Link>
              </p>
              <p className="mt-1 text-xs">{report.unpricedIngredients.map((ingredient) => ingredient.ingredientName).join(' · ')}</p>
            </div>
          )}
          {report.staleProducts.length > 0 && (
            <div>
              <p className="font-black text-primary">{report.staleProducts.length} מוצרים עם מחיר ישן (מעל חודש)</p>
              <p className="mt-1 text-xs">{report.staleProducts.map((product) => product.name).join(' · ')}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function CostReportScreen() {
  const storeQuery = useStore()

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את דוח העלויות" />
  if (storeQuery.isError || storeQuery.data?.data == null) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את דוח העלויות"
        description="לא בוצע שינוי. אפשר לנסות שוב."
        retry={() => void storeQuery.refetch()}
      />
    )
  }

  const store = storeQuery.data.data
  const dishRows = computeDishCosts(store)
  const orderRows = computeOrderCosts(store)
  const weeklyRows = computeWeeklyCosts(orderRows)
  const monthlyExpenses = computeMonthlyExpenses(store)
  const missing = computeMissingData(store, Date.now())

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-3xl font-black text-primary sm:text-4xl">דוח עלויות ורווחיות</h1>
        <p className="mt-2 text-sm font-bold text-muted-foreground">
          כמה עולה לייצר כל מנה וכל הזמנה — לפי המתכונים והמחירים בספריית המוצרים. נתון חסר מסומן, לא מומצא.
        </p>
      </header>
      <div className="mt-8 space-y-8">
        <MissingDataCard report={missing} />
        <DishCostsCard rows={dishRows} />
        <OrderCostsCard rows={orderRows} />
        <WeeklyCostsCard rows={weeklyRows} />
        <MonthlyExpensesCard rows={monthlyExpenses} />
      </div>
    </div>
  )
}

export default CostReportScreen
