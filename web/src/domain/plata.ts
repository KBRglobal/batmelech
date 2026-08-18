import { checkedAdd } from './money.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

/**
 * The hotplate (פלטה) a customer rents for Shabbat. It leaves with the order against a
 * deposit, sits in the hotel over Shabbat, is collected afterwards, and only then is the
 * deposit returned — so the money stays open until the equipment is physically back.
 *
 * These fields are operator-editable, but they must never enter OrderDraft: the admin save
 * merges `{...existingOrder, ...serializeOrderDraft(draft)}`, and anything the draft does
 * not carry is what survives a Telegram write made while the editor was open. The editor
 * therefore writes them through applyPlataToStore below, on its own save.
 *
 * The deposit is normalised exactly the way canonicalPlataDeposit in server/business-actions.js
 * normalises it — a canonical 'D.CC' string, same shape as order.deposit. Change one, change
 * the other, or מיי and the admin panel start writing different shapes into the same field.
 */

const MAX_TEXT_LENGTH = 10_000
const MAX_MONEY_TOKEN_LENGTH = 64
const MAX_ORDER_ID_LENGTH = 256

// The data cap matches MAX_PLATA_COUNT in server/business-actions.js, so a count מיי
// accepted is a count the editor can still load and save. The stepper only offers the
// range Lin actually uses; anything above it can still be read and decremented.
export const MAX_PLATA_COUNT = 20
export const PLATA_STEPPER_MAX = 5
export const MAX_PLATA_NOTE_LENGTH = 300

export const PLATA_STATUSES = ['withCustomer', 'awaitingPickup', 'collected', 'depositReturned'] as const

export type PlataStatus = (typeof PLATA_STATUSES)[number]

export const PLATA_STATUS_LABELS: Readonly<Record<PlataStatus, string>> = {
  withCustomer: 'אצל הלקוח',
  awaitingPickup: 'מוכנה לאיסוף',
  collected: 'נאספה',
  depositReturned: 'פיקדון הוחזר',
}

const PLATA_DEPOSIT_PATTERN = /^\$?(\d{1,9})(?:\.(\d{1,2}))?$/u

export interface PlataView {
  readonly count: number
  readonly status: PlataStatus | null
  readonly deposit: string
  readonly note: string
  readonly collectedAt: number | null
  readonly depositReturnedAt: number | null
  readonly present: boolean
}

export interface PlataFormValues {
  readonly count: number
  readonly deposit: string
  readonly status: PlataStatus
  readonly note: string
}

export interface PlataOutstanding {
  readonly withCustomer: number
  readonly awaitingPickup: number
  readonly collected: number
  readonly openDepositMinorUnits: number
  readonly depositComplete: boolean
}

function boundedText(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function plataStatus(value: unknown): PlataStatus | null {
  return PLATA_STATUSES.includes(value as PlataStatus) ? (value as PlataStatus) : null
}

function plataCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Canonical 'D.CC', or null when the value is absent or not a safe USD amount. */
export function canonicalPlataDeposit(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string' && value.length <= MAX_MONEY_TOKEN_LENGTH
        ? value.trim()
        : ''
  const match = PLATA_DEPOSIT_PATTERN.exec(raw.replaceAll(',', ''))
  if (match === null) return null
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`
}

export function plataDepositMinorUnits(value: unknown): number | null {
  const canonical = canonicalPlataDeposit(value)
  if (canonical === null) return null
  const [dollars, cents] = canonical.split('.')
  const minorUnits = BigInt(dollars!) * 100n + BigInt(cents!)
  return minorUnits > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minorUnits)
}

/** What an order currently says about its hotplate. Read-only; every field is validated. */
export function readPlata(order: Readonly<LegacyOrder>): PlataView {
  const count = plataCount(order.plataCount)
  const status = plataStatus(order.plataStatus)
  return {
    count,
    status,
    deposit: canonicalPlataDeposit(order.plataDeposit) ?? '',
    note: boundedText(order.plataPickupNote).slice(0, MAX_PLATA_NOTE_LENGTH),
    collectedAt: safeTimestamp(order.plataCollectedAt),
    depositReturnedAt: safeTimestamp(order.plataDepositReturnedAt),
    present: count > 0 || status !== null,
  }
}

/** The form the editor opens with: the stored plata, or an empty one to fill in. */
export function plataFormValues(order: Readonly<LegacyOrder> | null): PlataFormValues {
  if (order === null) return { count: 0, deposit: '', status: 'withCustomer', note: '' }
  const view = readPlata(order)
  return {
    count: view.count,
    deposit: view.deposit,
    status: view.status ?? 'withCustomer',
    note: view.note,
  }
}

export function isPlataFormValid(values: PlataFormValues): boolean {
  if (!Number.isSafeInteger(values.count) || values.count < 0 || values.count > MAX_PLATA_COUNT) return false
  if (values.deposit.trim() !== '' && canonicalPlataDeposit(values.deposit) === null) return false
  if (!PLATA_STATUSES.includes(values.status)) return false
  return values.note.length <= MAX_PLATA_NOTE_LENGTH
}

function applyPlataToOrder(order: Readonly<LegacyOrder>, values: PlataFormValues): LegacyOrder {
  const next: Record<string, unknown> = { ...order }
  // Count 0 means "no hotplate on this order": the whole lifecycle goes with it, so a plate
  // booked by mistake leaves nothing to chase after Shabbat.
  if (values.count === 0) {
    for (const field of [
      'plataCount',
      'plataDeposit',
      'plataStatus',
      'plataPickupNote',
      'plataCollectedAt',
      'plataDepositReturnedAt',
    ]) delete next[field]
    return next as LegacyOrder
  }

  next.plataCount = values.count
  next.plataStatus = values.status

  const deposit = canonicalPlataDeposit(values.deposit)
  if (deposit === null) delete next.plataDeposit
  else next.plataDeposit = deposit

  const note = values.note.trim().slice(0, MAX_PLATA_NOTE_LENGTH)
  if (note === '') delete next.plataPickupNote
  else next.plataPickupNote = note

  // Same stamping rule as setPlataStatus on the server: the first report wins, so re-saving
  // the section does not move a time that already happened.
  const now = Date.now()
  if (values.status === 'collected' && safeTimestamp(next.plataCollectedAt) === null) {
    next.plataCollectedAt = now
  }
  if (values.status === 'depositReturned' && safeTimestamp(next.plataDepositReturnedAt) === null) {
    next.plataDepositReturnedAt = now
  }
  return next as LegacyOrder
}

/**
 * The editor's plata save. Touches one order and nothing else — deliberately not routed
 * through serializeOrderDraft, so an in-flight admin draft cannot overwrite it and it
 * cannot overwrite the draft.
 */
export function applyPlataToStore(
  store: Readonly<LegacyStore>,
  orderId: string,
  values: PlataFormValues,
): LegacyStore {
  if (typeof orderId !== 'string' || orderId === '' || orderId.length > MAX_ORDER_ID_LENGTH) {
    throw new RangeError('plata save needs a safe order id')
  }
  if (!isPlataFormValid(values)) throw new RangeError('plata values are not safe to save')
  const matches = store.orders.filter((order) => order.id === orderId)
  if (matches.length !== 1) throw new RangeError('plata save needs exactly one matching order')
  return {
    ...store,
    orders: store.orders.map((order) => (order.id === orderId ? applyPlataToOrder(order, values) : order)),
  }
}

/**
 * How many hotplates are out of the kitchen right now and how much deposit money is still
 * held against them. Counted across every order, not one service date: a plate nobody
 * collected two weeks ago is exactly the one worth showing.
 */
export function summarizeOutstandingPlata(store: Readonly<LegacyStore>): PlataOutstanding {
  let withCustomer = 0
  let awaitingPickup = 0
  let collected = 0
  let openDepositMinorUnits = 0
  let depositComplete = true

  for (const order of store.orders) {
    const view = readPlata(order)
    if (view.count === 0) continue
    const status = view.status ?? 'withCustomer'
    if (status === 'depositReturned') continue
    if (status === 'withCustomer') withCustomer += view.count
    if (status === 'awaitingPickup') awaitingPickup += view.count
    if (status === 'collected') collected += view.count

    // The raw field, not the sanitised view: a deposit stored as something we cannot read is
    // money nobody can account for, and it has to say so rather than count as zero.
    if (order.plataDeposit === undefined || order.plataDeposit === null || order.plataDeposit === '') continue
    const minorUnits = plataDepositMinorUnits(order.plataDeposit)
    if (minorUnits === null) {
      depositComplete = false
      continue
    }
    try {
      openDepositMinorUnits = checkedAdd(openDepositMinorUnits, minorUnits, 'open plata deposit')
    } catch {
      depositComplete = false
    }
  }

  return { withCustomer, awaitingPickup, collected, openDepositMinorUnits, depositComplete }
}
