import { useEffect, useRef, useState } from 'react'
import { generatePath, Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import {
  applyDailyExpenseToStore,
  buildFinanceDashboard,
  expenseInputValue,
  formatFinanceMonth,
  formatSignedUsdMinorUnits,
  hasStoredExpense,
  parseLegacyUsdAmount,
  validateExpenseInput,
  type CustomerFinanceSaveHandler,
  type CustomerFinanceWarning,
  type FinanceDaySummary,
} from '../domain/customers-finance.ts'
import { checkedAdd } from '../domain/money.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type ExpenseSaveState =
  | { readonly kind: 'idle'; readonly message: '' }
  | { readonly kind: 'saving'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

interface FinanceInitialization {
  readonly baseEnvelope: Readonly<VersionedStateEnvelope> | null
  readonly baseStore: Readonly<LegacyStore>
}

interface ExpenseDraft {
  readonly date: string
  readonly value: string
}

interface AcceptedExpenseSave {
  readonly nextStore: LegacyStore
  readonly serviceDate: string
  readonly overlayValue: number | null
  readonly draftValue: string
}

const IDLE_EXPENSE_SAVE: ExpenseSaveState = { kind: 'idle', message: '' }

function MoneyValue({ value, signed = false }: { value: number | null; signed?: boolean }) {
  if (value === null) return <span className="text-sm font-black text-destructive">דורש בדיקה</span>
  return <span dir="ltr">{signed ? formatSignedUsdMinorUnits(value) : formatSignedUsdMinorUnits(value)}</span>
}

function MetricCard({
  label,
  value,
  caption,
  emphasis = false,
  danger = false,
  signed = false,
}: {
  label: string
  value: number | null
  caption?: string
  emphasis?: boolean
  danger?: boolean
  signed?: boolean
}) {
  const valueClassName = danger
    ? 'text-destructive'
    : value !== null && signed && value < 0
      ? 'text-destructive'
      : 'text-primary'
  return (
    <article
      className={`rounded-[2rem] border p-5 shadow-sm ${
        emphasis ? 'border-primary/10 bg-secondary' : 'border-border bg-card'
      }`}
    >
      <p className="text-[0.6875rem] font-black uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-black ${valueClassName}`}>
        <MoneyValue value={value} signed={signed} />
      </p>
      {caption !== undefined && (
        <p className="mt-1 text-[0.625rem] font-bold text-muted-foreground">{caption}</p>
      )}
    </article>
  )
}

function warningText(warning: CustomerFinanceWarning): string {
  const customer = warning.customerName ? `${warning.customerName}: ` : ''
  if (warning.code === 'INVALID_MONEY') return `${customer}סכום כספי אינו בפורמט תקין.`
  if (warning.code === 'MONEY_OVERFLOW') return `${customer}סכום כספי גדול מכדי לחשב בבטחה.`
  if (warning.code === 'INVALID_SERVICE_DATE') return `${customer}תאריך ההזמנה אינו תקין ולכן לא שויך לחודש.`
  if (warning.code === 'INVALID_EXPENSE_DATE') return 'נמצאה הוצאה עם תאריך שאינו תקין.'
  if (warning.code === 'INVALID_QUANTITY' || warning.code === 'QUANTITY_OVERFLOW') {
    return `${customer}כמות הזוגיות אינה תקינה.`
  }
  if (warning.code === 'INVALID_PHONE') return `${customer}מספר הטלפון אינו תקין לצורך איחוד לקוחות.`
  if (warning.code === 'MISSING_CUSTOMER_IDENTITY') return 'הזמנה ללא שם או טלפון לא אוחדה בדירוג הלקוחות.'
  return `${customer}אחד הנתונים השמורים אינו תקין.`
}

function FinanceWarnings({ warnings }: { warnings: readonly CustomerFinanceWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">יש נתונים כספיים שדורשים בדיקה</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-rose-800">
            סכומים לא תקינים אינם ניחשים ואינם נכללים בסיכום.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-800">
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

function lastDateOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

function defaultExpenseDate(month: string, currentMonth: string): string {
  if (month !== currentMonth) return `${month}-01`
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Dubai',
  }).formatToParts(new Date())
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const date = `${read('year')}-${read('month')}-${read('day')}`
  return date.startsWith(`${month}-`) ? date : `${month}-01`
}

// --- Local cross-month overview helpers -------------------------------------
// buildFinanceDashboard is scoped to one selected month, so the screen computes
// the cross-month snapshot (this month vs last month, all-time outstanding)
// locally instead of changing the shared domain module.

const OVERVIEW_TIME_ZONE = 'Asia/Dubai'
const OVERVIEW_LOCALE = 'he-IL'
const OVERVIEW_CANCELLED_STATUSES = new Set(['בוטלה', 'cancelled', 'canceled'])
const OVERVIEW_SETTLED_PAID_VALUES = new Set(['כן', 'שת"פ'])
const OVERVIEW_MAX_ID_LENGTH = 256

interface OutstandingOrderRow {
  readonly sourceIndex: number
  readonly routeId: string | null
  readonly customerName: string
  readonly serviceDate: string | null
  readonly localizedDate: string
  readonly totalMinorUnits: number | null
  readonly depositMinorUnits: number | null
  readonly remainingMinorUnits: number | null
}

interface FinanceOverview {
  readonly currentMonth: string
  readonly previousMonth: string
  readonly currentMonthRevenueMinorUnits: number | null
  readonly previousMonthRevenueMinorUnits: number | null
  readonly outstandingTotalMinorUnits: number | null
  readonly unpaidOrderCount: number
  readonly invalidDateOrderCount: number
  readonly invalidAmountOrderCount: number
  readonly outstandingRows: readonly OutstandingOrderRow[]
}

function overviewText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRealIsoOverviewDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function businessMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    timeZone: OVERVIEW_TIME_ZONE,
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}`
}

function monthBefore(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, monthNumber! - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function localizedOverviewDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat(OVERVIEW_LOCALE, {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function overviewSafeAdd(current: number | null, amount: number): number | null {
  if (current === null) return null
  try {
    return checkedAdd(current, amount, 'finance.overview')
  } catch {
    return null
  }
}

function overviewOrderRouteId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed !== '' && value.length <= OVERVIEW_MAX_ID_LENGTH ? trimmed : null
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null
}

function overviewRouteIds(orders: readonly LegacyOrder[]): Map<number, string | null> {
  const counts = new Map<string, number>()
  for (const order of orders) {
    const id = overviewOrderRouteId(order.id)
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return new Map(
    orders.map((order, index) => {
      const id = overviewOrderRouteId(order.id)
      return [index, id !== null && counts.get(id) === 1 ? id : null]
    }),
  )
}

function buildFinanceOverview(store: Readonly<LegacyStore>, now: Date = new Date()): FinanceOverview {
  const currentMonth = businessMonth(now)
  const previousMonth = monthBefore(currentMonth)
  const routeIdByIndex = overviewRouteIds(store.orders)
  let currentMonthRevenueMinorUnits: number | null = 0
  let previousMonthRevenueMinorUnits: number | null = 0
  let outstandingTotalMinorUnits: number | null = 0
  let unpaidOrderCount = 0
  let invalidDateOrderCount = 0
  let invalidAmountOrderCount = 0
  const outstandingRows: OutstandingOrderRow[] = []

  store.orders.forEach((order, sourceIndex) => {
    if (OVERVIEW_CANCELLED_STATUSES.has(overviewText(order.status).toLocaleLowerCase('en-US'))) {
      return
    }
    const total = parseLegacyUsdAmount(order.total)
    const deposit = parseLegacyUsdAmount(order.deposit)
    if (total.state === 'invalid' || deposit.state === 'invalid') invalidAmountOrderCount += 1

    const rawDate = overviewText(order.date)
    const serviceDate = isRealIsoOverviewDate(rawDate) ? rawDate : null
    if (serviceDate === null) {
      invalidDateOrderCount += 1
    } else if (total.state !== 'invalid') {
      const month = serviceDate.slice(0, 7)
      if (month === currentMonth) {
        currentMonthRevenueMinorUnits = overviewSafeAdd(currentMonthRevenueMinorUnits, total.minorUnits)
      } else if (month === previousMonth) {
        previousMonthRevenueMinorUnits = overviewSafeAdd(previousMonthRevenueMinorUnits, total.minorUnits)
      }
    }

    if (OVERVIEW_SETTLED_PAID_VALUES.has(overviewText(order.paid))) return
    unpaidOrderCount += 1
    const remainingMinorUnits =
      total.state === 'invalid' || deposit.state === 'invalid'
        ? null
        : Math.max(0, total.minorUnits - deposit.minorUnits)
    if (remainingMinorUnits !== null) {
      outstandingTotalMinorUnits = overviewSafeAdd(outstandingTotalMinorUnits, remainingMinorUnits)
    }
    outstandingRows.push({
      sourceIndex,
      routeId: routeIdByIndex.get(sourceIndex) ?? null,
      customerName: overviewText(order.name) || 'ללא שם',
      serviceDate,
      localizedDate: serviceDate === null ? 'ללא תאריך תקין' : localizedOverviewDate(serviceDate),
      totalMinorUnits: total.state === 'invalid' ? null : total.minorUnits,
      depositMinorUnits: deposit.state === 'invalid' ? null : deposit.minorUnits,
      remainingMinorUnits,
    })
  })

  outstandingRows.sort((left, right) => {
    const leftRank = left.serviceDate === null ? 1 : 0
    const rightRank = right.serviceDate === null ? 1 : 0
    return (
      leftRank - rightRank ||
      (right.serviceDate ?? '').localeCompare(left.serviceDate ?? '') ||
      right.sourceIndex - left.sourceIndex
    )
  })

  return {
    currentMonth,
    previousMonth,
    currentMonthRevenueMinorUnits,
    previousMonthRevenueMinorUnits,
    outstandingTotalMinorUnits,
    unpaidOrderCount,
    invalidDateOrderCount,
    invalidAmountOrderCount,
    outstandingRows,
  }
}

function overviewInvalidDataNote(overview: FinanceOverview): string | null {
  const parts: string[] = []
  if (overview.invalidDateOrderCount > 0) {
    parts.push(`${overview.invalidDateOrderCount} עם תאריך לא תקין`)
  }
  if (overview.invalidAmountOrderCount > 0) {
    parts.push(`${overview.invalidAmountOrderCount} עם סכום לא תקין`)
  }
  if (parts.length === 0) return null
  return `הזמנות שלא נכללו בחישוב בגלל נתון לא תקין: ${parts.join(', ')}.`
}

function OutstandingMoney({ value }: { value: number | null }) {
  if (value === null) return <span className="font-black text-destructive">סכום לא תקין</span>
  return <span dir="ltr">{formatSignedUsdMinorUnits(value)}</span>
}

function OutstandingRow({ row }: { row: OutstandingOrderRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="px-4 py-4 text-right font-black text-primary sm:px-6">
        {row.customerName}
      </th>
      <td className="px-4 py-4 font-bold text-primary sm:px-6">{row.localizedDate}</td>
      <td className="px-4 py-4 font-bold text-primary sm:px-6">
        <OutstandingMoney value={row.totalMinorUnits} />
      </td>
      <td className="px-4 py-4 font-bold text-primary sm:px-6">
        <OutstandingMoney value={row.depositMinorUnits} />
      </td>
      <td className="px-4 py-4 font-black text-destructive sm:px-6">
        <OutstandingMoney value={row.remainingMinorUnits} />
      </td>
      <td className="px-4 py-4 text-left sm:px-6">
        {row.routeId === null ? (
          <span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">
            אין מזהה לפתיחה
          </span>
        ) : (
          <Link
            to={generatePath(APP_ROUTES.editOrder, { orderId: row.routeId })}
            aria-label={`פתיחת ההזמנה של ${row.customerName}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-black text-primary transition-colors hover:bg-secondary"
          >
            <LocalIcon name="ph:pencil-simple-bold" className="text-base" />
            <span>לעריכה</span>
          </Link>
        )}
      </td>
    </tr>
  )
}

function DayRow({ day, onEditExpense }: { day: FinanceDaySummary; onEditExpense: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="px-4 py-5 text-right font-black text-primary sm:px-6">
        <span className="block">{day.localizedDate}</span>
        <span className="mt-1 block text-[0.6875rem] font-bold text-muted-foreground">
          {day.orderCount} הזמנות
          {day.meals === null ? ' · זוגיות דורשת בדיקה' : ` · ${day.meals} זוגיות`}
        </span>
      </th>
      <td className="px-4 py-5 font-bold text-primary sm:px-6">
        <MoneyValue value={day.revenueMinorUnits} />
      </td>
      <td className="px-4 py-5 font-bold text-primary sm:px-6">
        <MoneyValue value={day.depositsMinorUnits} />
      </td>
      <td className="px-4 py-5 font-bold text-destructive sm:px-6">
        <MoneyValue value={day.outstandingMinorUnits} />
      </td>
      <td className="px-4 py-5 font-bold text-destructive sm:px-6">
        <MoneyValue value={day.expensesMinorUnits} />
      </td>
      <td
        className={`px-4 py-5 text-left text-sm font-black sm:px-6 ${
          day.profitMinorUnits !== null && day.profitMinorUnits < 0 ? 'text-destructive' : 'text-primary'
        }`}
      >
        <MoneyValue value={day.profitMinorUnits} signed />
      </td>
      <td className="px-4 py-5 text-left sm:px-6">
        <button
          type="button"
          onClick={onEditExpense}
          aria-label={`עריכת הוצאה עבור ${day.localizedDate}`}
          className="min-h-9 rounded-xl border border-border bg-card px-3 text-xs font-black text-primary hover:bg-secondary"
        >
          עריכת הוצאה
        </button>
      </td>
    </tr>
  )
}

export function FinanceScreen({ onSave }: { readonly onSave?: CustomerFinanceSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<FinanceInitialization | null>(null)
  const acceptedSaveRef = useRef<AcceptedExpenseSave | null>(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null)
  const [confirmedExpenses, setConfirmedExpenses] = useState<Readonly<Record<string, number | null>>>({})
  const [expenseSaveState, setExpenseSaveState] = useState<ExpenseSaveState>(IDLE_EXPENSE_SAVE)

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore: storeQuery.data.data,
    }
  }
  const acceptedSave = acceptedSaveRef.current
  const acknowledgedEnvelope =
    acceptedSave !== null &&
    storeQuery.data !== undefined &&
    isVersionedStateEnvelope(storeQuery.data) &&
    JSON.stringify(storeQuery.data.data) === JSON.stringify(acceptedSave.nextStore)
      ? storeQuery.data
      : null

  useEffect(() => {
    if (
      acceptedSave === null ||
      acknowledgedEnvelope === null ||
      acceptedSaveRef.current !== acceptedSave
    ) return

    initializationRef.current = {
      baseEnvelope: acknowledgedEnvelope,
      baseStore: acknowledgedEnvelope.data,
    }
    acceptedSaveRef.current = null
    setConfirmedExpenses((current) => {
      if (
        !Object.prototype.hasOwnProperty.call(current, acceptedSave.serviceDate) ||
        current[acceptedSave.serviceDate] !== acceptedSave.overlayValue
      ) return current
      const next = { ...current }
      delete next[acceptedSave.serviceDate]
      return next
    })
    setExpenseDraft((current) =>
      current?.date === acceptedSave.serviceDate && current.value === acceptedSave.draftValue
        ? null
        : current,
    )
  }, [acceptedSave, acknowledgedEnvelope])

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את הנתונים הכספיים" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את הנתונים הכספיים"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  let displayStore = storeQuery.data.data ?? { orders: [] }
  for (const [date, minorUnits] of Object.entries(confirmedExpenses)) {
    displayStore = applyDailyExpenseToStore(displayStore, date, minorUnits ?? 0)
  }
  const dashboard = buildFinanceDashboard(displayStore, { selectedMonth })
  const overview = buildFinanceOverview(displayStore)
  const overviewNote = overviewInvalidDataNote(overview)
  const activeMonth = dashboard.selectedMonth ?? dashboard.currentMonth
  const monthOptions = [...new Set([activeMonth, dashboard.currentMonth, ...dashboard.availableMonths])]
    .sort((left, right) => right.localeCompare(left))
  const fallbackExpenseDate = defaultExpenseDate(activeMonth, dashboard.currentMonth)
  const formDate =
    expenseDraft?.date.startsWith(`${activeMonth}-`) === true
      ? expenseDraft.date
      : fallbackExpenseDate
  const formValue =
    expenseDraft?.date === formDate ? expenseDraft.value : expenseInputValue(displayStore, formDate)
  const storedExpenseExists = hasStoredExpense(displayStore, formDate)

  const saveExpense = async (minorUnitsOverride?: number) => {
    const initialization = initializationRef.current
    const validation =
      minorUnitsOverride === undefined
        ? validateExpenseInput(formValue)
        : ({ valid: true, minorUnits: minorUnitsOverride } as const)
    if (!validation.valid) {
      setExpenseSaveState({ kind: 'error', message: validation.message })
      return
    }
    if (!formDate.startsWith(`${activeMonth}-`)) {
      setExpenseSaveState({ kind: 'error', message: 'תאריך ההוצאה חייב להיות בחודש שנבחר.' })
      return
    }
    if (!onSave) {
      setExpenseSaveState({
        kind: 'error',
        message: 'השמירה המוגנת עדיין אינה מחוברת. לא בוצע שינוי בשרת.',
      })
      return
    }
    if (
      initialization?.baseEnvelope == null ||
      !isSameVersionedStateEnvelope(storeQuery.data, initialization.baseEnvelope)
    ) {
      setExpenseSaveState({
        kind: 'error',
        message: 'הנתונים התעדכנו מאז פתיחת המסך. הטיוטה נשארה כאן ולא נשלחה.',
      })
      return
    }

    let nextStore: LegacyStore
    try {
      nextStore = applyDailyExpenseToStore(
        initialization.baseStore,
        formDate,
        validation.minorUnits,
      )
    } catch {
      setExpenseSaveState({ kind: 'error', message: 'התאריך או הסכום אינם בטוחים לשמירה.' })
      return
    }

    setExpenseSaveState({ kind: 'saving', message: 'שומרת...' })
    try {
      await onSave({
        reason: 'finance',
        baseEnvelope: initialization.baseEnvelope,
        baseStore: initialization.baseStore,
        nextStore,
      })
      const overlayValue = validation.minorUnits === 0 ? null : validation.minorUnits
      const draftValue = expenseInputValue(nextStore, formDate)
      acceptedSaveRef.current = { nextStore, serviceDate: formDate, overlayValue, draftValue }
      setConfirmedExpenses((current) => ({
        ...current,
        [formDate]: overlayValue,
      }))
      setExpenseDraft({
        date: formDate,
        value: draftValue,
      })
      setExpenseSaveState({ kind: 'saved', message: 'ההוצאה נשמרה.' })
    } catch {
      setExpenseSaveState({
        kind: 'error',
        message: 'השמירה נכשלה. הטיוטה נשארה כאן והנתונים הקיימים לא הוחלפו.',
      })
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
            כספים — {dashboard.localizedMonth || formatFinanceMonth(activeMonth)}
          </h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            הכנסות, מקדמות, יתרות, הוצאות ורווח לפי הנתונים השמורים.
          </p>
        </div>
        <div className="flex min-w-52 flex-col gap-2">
          <label htmlFor="finance-month" className="text-xs font-black text-muted-foreground">
            חודש
          </label>
          <select
            id="finance-month"
            value={activeMonth}
            onChange={(event) => {
              setSelectedMonth(event.currentTarget.value)
              setExpenseDraft(null)
              setExpenseSaveState(IDLE_EXPENSE_SAVE)
            }}
            className="min-h-11 rounded-2xl border border-border bg-card px-5 py-3 text-sm font-black text-primary shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {formatFinanceMonth(month)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="mt-8 space-y-8">
        <section aria-label="תמונת מצב כללית" className="space-y-3">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <MetricCard
              label="הכנסות החודש"
              caption={formatFinanceMonth(overview.currentMonth)}
              value={overview.currentMonthRevenueMinorUnits}
            />
            <MetricCard
              label="הכנסות חודש שעבר"
              caption={formatFinanceMonth(overview.previousMonth)}
              value={overview.previousMonthRevenueMinorUnits}
            />
            <MetricCard
              label="יתרות לגבייה"
              caption="מכל החודשים"
              value={overview.outstandingTotalMinorUnits}
              danger
              emphasis
            />
            <article className="rounded-[2rem] border border-border bg-card p-5 shadow-sm">
              <p className="text-[0.6875rem] font-black uppercase tracking-wider text-muted-foreground">
                הזמנות שטרם שולמו
              </p>
              <p className="mt-1 text-2xl font-black text-primary">{overview.unpaidOrderCount}</p>
              <p className="mt-1 text-[0.625rem] font-bold text-muted-foreground">מכל החודשים</p>
            </article>
          </div>
          {overviewNote !== null && (
            <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground" role="note">
              <LocalIcon name="ph:warning-circle-bold" className="text-base text-destructive" />
              <span>{overviewNote}</span>
            </p>
          )}
        </section>

        <FinanceWarnings warnings={dashboard.warnings} />

        {dashboard.globallyEmpty && (
          <ScreenState
            kind="empty"
            title="עדיין אין נתונים כספיים"
            description="אפשר להוסיף כאן הוצאה ראשונה; הזמנות ייכנסו לסיכום אוטומטית."
            className="min-h-44 px-0"
          />
        )}

        <section
          className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8"
          aria-label="עריכת הוצאה יומית"
        >
          <div className="flex items-center gap-2">
            <LocalIcon name="ph:calendar-bold" className="text-xl text-accent" />
            <h2 className="text-xl font-black text-primary">הוצאה יומית</h2>
          </div>
          <p className="mt-1 text-xs font-bold text-muted-foreground">
            הזנה ושמירה הן ידניות. סכום 0 או כפתור הניקוי מסירים רק את ההוצאה של היום שנבחר.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">
            <label className="flex flex-col gap-2 text-xs font-black text-muted-foreground">
              תאריך ההוצאה
              <input
                type="date"
                value={formDate}
                min={`${activeMonth}-01`}
                max={lastDateOfMonth(activeMonth)}
                onChange={(event) => {
                  const date = event.currentTarget.value
                  setExpenseDraft({ date, value: expenseInputValue(displayStore, date) })
                  setExpenseSaveState(IDLE_EXPENSE_SAVE)
                }}
                className="min-h-11 rounded-xl border border-border bg-background px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-black text-muted-foreground">
              סכום בדולרים
              <input
                type="text"
                inputMode="decimal"
                value={formValue}
                onChange={(event) => {
                  setExpenseDraft({ date: formDate, value: event.currentTarget.value })
                  setExpenseSaveState(IDLE_EXPENSE_SAVE)
                }}
                placeholder="0.00"
                aria-label="סכום ההוצאה בדולרים"
                className="min-h-11 rounded-xl border border-border bg-background px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveExpense()}
              disabled={expenseSaveState.kind === 'saving'}
              className="min-h-11 rounded-xl bg-primary px-5 text-xs font-black text-primary-foreground disabled:cursor-wait disabled:opacity-50"
            >
              שמירת הוצאה
            </button>
            <button
              type="button"
              onClick={() => void saveExpense(0)}
              disabled={!storedExpenseExists || expenseSaveState.kind === 'saving'}
              className="min-h-11 rounded-xl border border-border bg-card px-5 text-xs font-black text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            >
              ניקוי הוצאה
            </button>
          </div>
          {expenseSaveState.kind !== 'idle' && (
            <p
              className={`mt-3 text-xs font-bold ${expenseSaveState.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
              role={expenseSaveState.kind === 'error' ? 'alert' : 'status'}
            >
              {expenseSaveState.message}
            </p>
          )}
        </section>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6" aria-label="סיכום חודשי">
          <MetricCard label="הכנסות" value={dashboard.revenueMinorUnits} />
          <MetricCard label="מקדמות" value={dashboard.depositsMinorUnits} />
          <MetricCard label="עוד לא נגבה" value={dashboard.outstandingMinorUnits} danger />
          <MetricCard label="הוצאות" value={dashboard.expensesMinorUnits} danger />
          <MetricCard label="נשאר ביד" value={dashboard.profitMinorUnits} signed emphasis />
          <article className="rounded-[2rem] border border-border bg-card p-5 shadow-sm">
            <p className="text-[0.6875rem] font-black uppercase tracking-wider text-muted-foreground">
              ארוחות זוגיות
            </p>
            {dashboard.meals === null ? (
              <p className="mt-1 text-sm font-black text-destructive">דורש בדיקה</p>
            ) : (
              <p className="mt-1 text-2xl font-black text-primary">{dashboard.meals}</p>
            )}
          </article>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <section className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm lg:col-span-2">
            <header className="border-b border-border p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <LocalIcon name="ph:calendar-bold" className="text-xl text-accent" />
                <h2 className="text-xl font-black text-primary">פירוט לפי ימים</h2>
              </div>
              <p className="mt-2 text-xs font-bold text-muted-foreground">
                ההוצאות מוצגות בדיוק כפי שנשמרו במערכת.
              </p>
            </header>
            {dashboard.days.length === 0 ? (
              <ScreenState
                kind="empty"
                title="אין פעילות בחודש הזה"
                description="אין הזמנות פעילות או הוצאות לתצוגה."
                className="min-h-64 px-4 py-6"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-right text-xs">
                  <thead className="border-b border-border bg-secondary/40">
                    <tr>
                      <th className="px-4 py-4 font-black text-primary sm:px-6">יום</th>
                      <th className="px-4 py-4 font-black text-primary sm:px-6">הכנסות</th>
                      <th className="px-4 py-4 font-black text-primary sm:px-6">מקדמות</th>
                      <th className="px-4 py-4 font-black text-primary sm:px-6">יתרה</th>
                      <th className="px-4 py-4 font-black text-primary sm:px-6">הוצאות</th>
                      <th className="px-4 py-4 text-left font-black text-primary sm:px-6">רווח</th>
                      <th className="px-4 py-4 text-left font-black text-primary sm:px-6">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.days.map((day) => (
                      <DayRow
                        key={day.serviceDate}
                        day={day}
                        onEditExpense={() => {
                          setExpenseDraft({
                            date: day.serviceDate,
                            value: expenseInputValue(displayStore, day.serviceDate),
                          })
                          setExpenseSaveState(IDLE_EXPENSE_SAVE)
                        }}
                      />
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-secondary/50">
                    <tr>
                      <th className="px-4 py-5 text-right font-black text-primary sm:px-6">סה״כ</th>
                      <td className="px-4 py-5 font-black text-primary sm:px-6">
                        <MoneyValue value={dashboard.revenueMinorUnits} />
                      </td>
                      <td className="px-4 py-5 font-black text-primary sm:px-6">
                        <MoneyValue value={dashboard.depositsMinorUnits} />
                      </td>
                      <td className="px-4 py-5 font-black text-destructive sm:px-6">
                        <MoneyValue value={dashboard.outstandingMinorUnits} />
                      </td>
                      <td className="px-4 py-5 font-black text-destructive sm:px-6">
                        <MoneyValue value={dashboard.expensesMinorUnits} />
                      </td>
                      <td
                        className={`px-4 py-5 text-left text-base font-black sm:px-6 ${
                          dashboard.profitMinorUnits !== null && dashboard.profitMinorUnits < 0
                            ? 'text-destructive'
                            : 'text-primary'
                        }`}
                      >
                        <MoneyValue value={dashboard.profitMinorUnits} signed />
                      </td>
                      <td className="px-4 py-5 sm:px-6" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[2.5rem] border border-border bg-card shadow-sm" aria-label="הלקוחות הגדולים">
            <header className="border-b border-border p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <LocalIcon name="ph:users-bold" className="text-xl text-accent" />
                <h2 className="text-xl font-black text-primary">הלקוחות הגדולים</h2>
              </div>
              <p className="mt-1 text-xs font-bold text-muted-foreground">לפי מחזור הזמנות תקין בחודש</p>
            </header>
            {dashboard.topCustomers.length === 0 ? (
              <p className="p-8 text-sm font-bold leading-6 text-muted-foreground">
                אין עדיין מחזור לקוחות תקין להצגה בחודש הזה.
              </p>
            ) : (
              <ol className="space-y-2 p-5 sm:p-6">
                {dashboard.topCustomers.map((customer, index) => (
                  <li
                    key={customer.key}
                    className={`flex items-center gap-4 rounded-2xl p-4 ${index === 0 ? 'bg-secondary' : ''}`}
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                        index === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-primary">{customer.name}</p>
                      <p className="text-[0.6875rem] font-bold text-muted-foreground">
                        {customer.orderCount} הזמנות בחודש
                      </p>
                    </div>
                    <strong className="text-sm font-black text-primary" dir="ltr">
                      {formatSignedUsdMinorUnits(customer.revenueMinorUnits)}
                    </strong>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section
          className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm"
          aria-label="יתרות פתוחות לגבייה"
        >
          <header className="border-b border-border p-6 sm:p-8">
            <div className="flex items-center gap-2">
              <LocalIcon name="ph:coins-bold" className="text-xl text-accent" />
              <h2 className="text-xl font-black text-primary">יתרות פתוחות לגבייה</h2>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              כל ההזמנות הפעילות שעדיין לא סומנו כשולמו, מכל החודשים. לחיצה על עריכה פותחת את ההזמנה.
            </p>
          </header>
          {overview.outstandingRows.length === 0 ? (
            <p className="p-8 text-sm font-bold leading-6 text-muted-foreground">
              אין יתרות פתוחות — כל ההזמנות הפעילות שולמו.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-right text-xs">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    <th className="px-4 py-4 font-black text-primary sm:px-6">לקוחה</th>
                    <th className="px-4 py-4 font-black text-primary sm:px-6">תאריך</th>
                    <th className="px-4 py-4 font-black text-primary sm:px-6">סה״כ</th>
                    <th className="px-4 py-4 font-black text-primary sm:px-6">מקדמה</th>
                    <th className="px-4 py-4 font-black text-primary sm:px-6">נשאר לתשלום</th>
                    <th className="px-4 py-4 text-left font-black text-primary sm:px-6">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.outstandingRows.map((row) => (
                    <OutstandingRow key={row.sourceIndex} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default FinanceScreen
