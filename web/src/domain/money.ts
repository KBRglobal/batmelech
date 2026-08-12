import {
  DineroComparisonOperator,
  add,
  compare,
  dinero,
  subtract,
  toDecimal,
  toSnapshot,
  type Dinero,
} from 'dinero.js'
import { USD } from 'dinero.js/currencies'

export const MAX_SAFE_MINOR_UNITS = Number.MAX_SAFE_INTEGER

export type UsdMoney = Dinero<number, 'USD'>

export function requireNonNegativeSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`)
  }

  return value
}

export function checkedAdd(
  augend: number,
  addend: number,
  fieldName = 'integer addition',
): number {
  requireNonNegativeSafeInteger(augend, `${fieldName} augend`)
  requireNonNegativeSafeInteger(addend, `${fieldName} addend`)

  if (augend > Number.MAX_SAFE_INTEGER - addend) {
    throw new RangeError(`${fieldName} exceeds the safe integer range`)
  }

  return augend + addend
}

export function checkedMultiply(
  multiplicand: number,
  multiplier: number,
  fieldName = 'integer multiplication',
): number {
  requireNonNegativeSafeInteger(multiplicand, `${fieldName} multiplicand`)
  requireNonNegativeSafeInteger(multiplier, `${fieldName} multiplier`)

  if (multiplicand !== 0 && multiplier > Math.floor(Number.MAX_SAFE_INTEGER / multiplicand)) {
    throw new RangeError(`${fieldName} exceeds the safe integer range`)
  }

  return multiplicand * multiplier
}

export function checkedSubtract(
  minuend: number,
  subtrahend: number,
  fieldName = 'integer subtraction',
): number {
  requireNonNegativeSafeInteger(minuend, `${fieldName} minuend`)
  requireNonNegativeSafeInteger(subtrahend, `${fieldName} subtrahend`)

  if (subtrahend > minuend) {
    throw new RangeError(`${fieldName} cannot produce a negative amount`)
  }

  return minuend - subtrahend
}

export function usdFromMinorUnits(minorUnits: unknown): UsdMoney {
  const amount = requireNonNegativeSafeInteger(minorUnits, 'USD minor units')

  return dinero({ amount, currency: USD })
}

export function getUsdMinorUnits(money: UsdMoney): number {
  const snapshot = toSnapshot(money)

  if (
    snapshot.currency.code !== USD.code ||
    snapshot.currency.base !== USD.base ||
    snapshot.currency.exponent !== USD.exponent ||
    snapshot.scale !== USD.exponent
  ) {
    throw new RangeError('Money must use canonical USD metadata and minor-unit scale')
  }

  return requireNonNegativeSafeInteger(snapshot.amount, 'USD minor units')
}

export function addUsd(augend: UsdMoney, addend: UsdMoney): UsdMoney {
  const amount = checkedAdd(
    getUsdMinorUnits(augend),
    getUsdMinorUnits(addend),
    'USD addition',
  )
  const result = add(augend, addend)

  if (getUsdMinorUnits(result) !== amount) {
    throw new RangeError('USD addition produced a non-canonical result')
  }

  return result
}

export function subtractUsd(minuend: UsdMoney, subtrahend: UsdMoney): UsdMoney {
  const amount = checkedSubtract(
    getUsdMinorUnits(minuend),
    getUsdMinorUnits(subtrahend),
    'USD subtraction',
  )
  const result = subtract(minuend, subtrahend)

  if (getUsdMinorUnits(result) !== amount) {
    throw new RangeError('USD subtraction produced a non-canonical result')
  }

  return result
}

export function compareUsd(left: UsdMoney, right: UsdMoney): DineroComparisonOperator {
  getUsdMinorUnits(left)
  getUsdMinorUnits(right)
  return compare(left, right)
}

export function usdDecimalString(money: UsdMoney): string {
  getUsdMinorUnits(money)
  return toDecimal(money)
}
