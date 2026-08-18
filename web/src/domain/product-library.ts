import { z } from 'zod'
import { checkedMultiply, requireNonNegativeSafeInteger } from './money.ts'
import {
  PositiveDecimalQuantitySchema,
  StableCatalogIdSchema,
  decimalParts,
  type DecimalQuantity,
} from './recipes.ts'
import type { LegacyStore } from './store.ts'

/**
 * The product library (ספריית מוצרים): every purchasable ingredient, priced at the two
 * fixed sources Moshe buys from. A recipe ingredient's `ingredientId` (recipes.ts) is the
 * SAME id as a product library entry's `id` — that shared identity is what lets recipe
 * costing and the shopping list look a price up without a second mapping table.
 *
 * Stored as `store.productLibrary`, a plain array, exactly the way `store.recipes` is
 * stored (settings-catalog.ts loadRecipeBook/applyRecipesToStore) — same shape of
 * problem, same shape of solution.
 */

export const SUPPLIER_KEYS = ['nesto', 'rimon'] as const
export type SupplierKey = (typeof SUPPLIER_KEYS)[number]

export const SUPPLIER_LABELS: Readonly<Record<SupplierKey, string>> = {
  nesto: 'נסטו דובאי',
  rimon: 'רימון כשר',
}

const MAX_MONEY_INTEGER_DIGITS = 12
const MONEY_PATTERN = new RegExp(`^(?:0|[1-9]\\d{0,${MAX_MONEY_INTEGER_DIGITS - 1}})(?:\\.\\d{1,2})?$`)

export const MoneyDecimalSchema = z
  .string()
  .trim()
  .regex(MONEY_PATTERN, 'must be a canonical money amount with at most 2 decimal places')

/** Exact: money input is already at minor-unit (fils/agorot) precision, no rounding. */
export function moneyToMinorUnits(value: z.infer<typeof MoneyDecimalSchema>): number {
  const parsed = MoneyDecimalSchema.parse(value)
  const [integerPart, fractionalPart = ''] = parsed.split('.')
  const minorUnits = BigInt(integerPart) * 100n + BigInt(fractionalPart.padEnd(2, '0'))
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('money amount exceeds the safe range')
  return requireNonNegativeSafeInteger(Number(minorUnits), 'money minor units')
}

export function minorUnitsToMoney(minorUnits: number): string {
  const value = requireNonNegativeSafeInteger(minorUnits, 'money minor units')
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

// The only two units a pack can be priced by: weight (unified like the shopping list
// unifies גרם/ק"ג) or a plain piece unit, which must match the recipe's unit exactly.
const KILOGRAM_UNITS: ReadonlySet<string> = new Set(['ק"ג', 'ק״ג'])
const GRAM_UNITS: ReadonlySet<string> = new Set(['גרם'])
const GRAMS_PER_KILOGRAM = 100n * 10n

export interface Rational {
  readonly num: bigint
  readonly den: bigint
}

export function ratFromDecimal(value: DecimalQuantity): Rational {
  const { coefficient, scale } = decimalParts(value)
  return { num: coefficient, den: 10n ** BigInt(scale) }
}

export function ratMul(left: Rational, right: Rational): Rational {
  return { num: left.num * right.num, den: left.den * right.den }
}

export function ratAdd(left: Rational, right: Rational): Rational {
  return { num: left.num * right.den + right.num * left.den, den: left.den * right.den }
}

export function ratDiv(left: Rational, right: Rational): Rational {
  if (right.num === 0n) throw new RangeError('division by zero')
  return { num: left.num * right.den, den: left.den * right.num }
}

/** Round half up to a non-negative integer. */
export function ratToRoundedInt(value: Rational): bigint {
  if (value.num < 0n || value.den <= 0n) throw new RangeError('rational must be non-negative')
  const twice = value.num * 2n
  const quotient = twice / value.den
  const roundedTwice = quotient % 2n === 0n ? quotient : quotient + 1n
  return roundedTwice / 2n
}

/**
 * A quantity expressed in the SAME base as pack pricing: kilograms for weight units,
 * or the literal unit string for anything else (יחידה and similar stay piece-exact).
 * Returns null when the two units are not comparable (e.g. גרם vs יחידה).
 */
export function toComparableBaseRational(
  quantity: Rational,
  unit: string,
  packUnit: string,
): Rational | null {
  const isWeight = KILOGRAM_UNITS.has(unit) || GRAM_UNITS.has(unit)
  const packIsWeight = KILOGRAM_UNITS.has(packUnit) || GRAM_UNITS.has(packUnit)
  if (isWeight !== packIsWeight) return null
  if (!isWeight) return unit === packUnit ? quantity : null

  const asKilograms = KILOGRAM_UNITS.has(unit) ? quantity : ratDiv(quantity, { num: GRAMS_PER_KILOGRAM, den: 1n })
  return packIsWeight && KILOGRAM_UNITS.has(packUnit)
    ? asKilograms
    : ratMul(asKilograms, { num: GRAMS_PER_KILOGRAM, den: 1n })
}

function toComparableBase(quantity: DecimalQuantity, unit: string, packUnit: string): Rational | null {
  return toComparableBaseRational(ratFromDecimal(quantity), unit, packUnit)
}

export interface ManualPriceCorrection {
  readonly minorUnitsPerBaseUnit: number
  readonly at: number
}

export interface SupplierListing {
  readonly packSize: DecimalQuantity
  readonly packUnit: string
  readonly packPriceMinorUnits: number
  readonly updatedAt: number
  readonly manualPrice: ManualPriceCorrection | null
}

export interface ProductLibraryEntry {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly kosherOnly: boolean
  readonly supplierOverride: SupplierKey | null
  readonly insignificant: boolean
  readonly listings: Readonly<Partial<Record<SupplierKey, SupplierListing>>>
}

// Moshe's stated defaults (docs/recipes-v2-procurement-spec.md) — a starting point offered
// when a new product is created, always editable per product afterwards.
export const DEFAULT_SUPPLIER_BY_CATEGORY: Readonly<Record<string, SupplierKey>> = {
  fish: 'nesto',
  meat: 'rimon',
  breadcrumbs: 'rimon',
}

const SupplierListingSchema = z
  .object({
    packSize: PositiveDecimalQuantitySchema,
    packUnit: z.string().trim().min(1).max(80),
    packPriceMinorUnits: z.number().int().nonnegative(),
    updatedAt: z.number().int().positive(),
    manualPrice: z
      .object({ minorUnitsPerBaseUnit: z.number().int().nonnegative(), at: z.number().int().positive() })
      .nullable(),
  })
  .strict()

export const ProductLibraryEntrySchema = z
  .object({
    id: StableCatalogIdSchema,
    name: z.string().trim().min(1).max(240),
    category: z.string().trim().max(120),
    kosherOnly: z.boolean(),
    supplierOverride: z.enum(SUPPLIER_KEYS).nullable(),
    insignificant: z.boolean(),
    listings: z
      .object({ nesto: SupplierListingSchema.optional(), rimon: SupplierListingSchema.optional() })
      .strict(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.kosherOnly && entry.listings.rimon === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['listings', 'rimon'],
        message: 'kosher-only products must have a Rimon listing',
      })
    }
    if (Object.keys(entry.listings).length === 0) {
      context.addIssue({ code: 'custom', path: ['listings'], message: 'at least one supplier listing is required' })
    }
  })

export type ParsedProductLibraryEntry = z.infer<typeof ProductLibraryEntrySchema>

export type ProductLibraryValidationResult =
  | { readonly valid: true; readonly entry: ProductLibraryEntry }
  | { readonly valid: false; readonly issues: readonly string[] }

export function validateProductLibraryEntry(value: unknown): ProductLibraryValidationResult {
  const result = ProductLibraryEntrySchema.safeParse(value)
  if (result.success) return { valid: true, entry: result.data }
  return {
    valid: false,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    }),
  }
}

/** "Manual price always wins" — same rule the order editor already applies to pricing. */
export function effectivePricePerBaseUnit(listing: Readonly<SupplierListing>): number {
  if (listing.manualPrice !== null) return listing.manualPrice.minorUnitsPerBaseUnit
  const packPrice: Rational = { num: BigInt(listing.packPriceMinorUnits), den: 1n }
  const packSize = ratFromDecimal(listing.packSize)
  return Number(ratToRoundedInt(ratDiv(packPrice, packSize)))
}

/**
 * Kosher rule wins outright; otherwise a manual override wins; otherwise the cheaper
 * available listing wins. Returns null when nothing is priced at all.
 */
export function effectiveSupplier(entry: Readonly<ProductLibraryEntry>): SupplierKey | null {
  if (entry.kosherOnly) return entry.listings.rimon !== undefined ? 'rimon' : null
  if (entry.supplierOverride !== null && entry.listings[entry.supplierOverride] !== undefined) {
    return entry.supplierOverride
  }
  const available = SUPPLIER_KEYS.filter((supplier) => entry.listings[supplier] !== undefined)
  if (available.length === 0) return null
  return available.reduce((cheapest, candidate) =>
    effectivePricePerBaseUnit(entry.listings[candidate]!) < effectivePricePerBaseUnit(entry.listings[cheapest]!)
      ? candidate
      : cheapest,
  )
}

export interface SupplierPurchaseOption {
  readonly supplier: SupplierKey
  readonly packsNeeded: number
  readonly totalMinorUnits: number
  readonly comparable: boolean
}

/** How many whole packs to buy from one supplier to cover a required quantity, and its cost. */
export function purchaseOption(
  listing: Readonly<SupplierListing>,
  supplier: SupplierKey,
  quantity: DecimalQuantity,
  unit: string,
): SupplierPurchaseOption {
  const comparableQuantity = toComparableBase(quantity, unit, listing.packUnit)
  if (comparableQuantity === null) {
    return { supplier, packsNeeded: 0, totalMinorUnits: 0, comparable: false }
  }
  const packSize = ratFromDecimal(listing.packSize)
  const packs = ratToRoundedInt(
    (() => {
      const ratio = ratDiv(comparableQuantity, packSize)
      // ceil, matching the shopping list's own "round up to a real pack" logic
      const wholePacks = ratio.num / ratio.den
      const remainder = ratio.num % ratio.den
      return { num: remainder === 0n ? wholePacks : wholePacks + 1n, den: 1n }
    })(),
  )
  const packsNumber = Number(packs)
  return {
    supplier,
    packsNeeded: packsNumber,
    totalMinorUnits: checkedMultiply(packsNumber, listing.packPriceMinorUnits, 'pack purchase total'),
    comparable: true,
  }
}

export interface SupplierComparison {
  readonly options: readonly SupplierPurchaseOption[]
  readonly cheapestSupplier: SupplierKey | null
  readonly kosherLocked: boolean
}

/** Side-by-side pack cost at both suppliers, with the kosher rule and comparability applied. */
export function compareSuppliers(
  entry: Readonly<ProductLibraryEntry>,
  quantity: DecimalQuantity,
  unit: string,
): SupplierComparison {
  const options = SUPPLIER_KEYS.filter((supplier) => entry.listings[supplier] !== undefined).map((supplier) =>
    purchaseOption(entry.listings[supplier]!, supplier, quantity, unit),
  )
  if (entry.kosherOnly) {
    const rimon = options.find((option) => option.supplier === 'rimon' && option.comparable) ?? null
    return { options, cheapestSupplier: rimon?.supplier ?? null, kosherLocked: true }
  }
  const comparable = options.filter((option) => option.comparable)
  const cheapest =
    comparable.length === 0
      ? null
      : comparable.reduce((best, candidate) => (candidate.totalMinorUnits < best.totalMinorUnits ? candidate : best))
          .supplier
  return { options, cheapestSupplier: cheapest, kosherLocked: false }
}

export interface QuickEstimateResult {
  readonly minorUnits: number
  readonly supplier: SupplierKey
}

/** "120 ק"ג בשר" → what that costs, from the effective supplier's stored per-base-unit price. */
export function quickCostEstimate(
  entry: Readonly<ProductLibraryEntry>,
  quantity: DecimalQuantity,
  unit: string,
): QuickEstimateResult | null {
  const supplier = effectiveSupplier(entry)
  if (supplier === null) return null
  const listing = entry.listings[supplier]!
  const comparableQuantity = toComparableBase(quantity, unit, listing.packUnit)
  if (comparableQuantity === null) return null
  const pricePerBaseUnit = effectivePricePerBaseUnit(listing)
  const minorUnits = Number(ratToRoundedInt(ratMul(comparableQuantity, { num: BigInt(pricePerBaseUnit), den: 1n })))
  return { minorUnits, supplier }
}

/** Reverse direction: what was actually paid for a quantity → the corrected per-base-unit price. */
export function priceCorrectionFromReceipt(
  quantity: DecimalQuantity,
  unit: string,
  packUnit: string,
  paidMinorUnits: number,
): number | null {
  requireNonNegativeSafeInteger(paidMinorUnits, 'receipt amount')
  const comparableQuantity = toComparableBase(quantity, unit, packUnit)
  if (comparableQuantity === null || comparableQuantity.num === 0n) return null
  return Number(ratToRoundedInt(ratDiv({ num: BigInt(paidMinorUnits), den: 1n }, comparableQuantity)))
}

export function applyManualPriceCorrection(
  entry: Readonly<ProductLibraryEntry>,
  supplier: SupplierKey,
  minorUnitsPerBaseUnit: number,
  at: number,
): ProductLibraryEntry {
  const listing = entry.listings[supplier]
  if (listing === undefined) throw new RangeError(`no ${supplier} listing to correct`)
  return {
    ...entry,
    listings: {
      ...entry.listings,
      [supplier]: { ...listing, manualPrice: { minorUnitsPerBaseUnit, at } },
    },
  }
}

// ---- Persistence: store.productLibrary, same pattern as store.recipes ----

export interface ProductLibraryBook {
  readonly records: readonly {
    readonly sourceIndex: number
    readonly value: unknown
    readonly valid: boolean
    readonly entry: ProductLibraryEntry | null
    readonly issues: readonly string[]
  }[]
  readonly entries: readonly ProductLibraryEntry[]
  readonly issues: readonly string[]
  readonly saveable: boolean
}

export function loadProductLibrary(store: Readonly<LegacyStore>): ProductLibraryBook {
  const raw = (store as Readonly<Record<string, unknown>>).productLibrary
  const values = Array.isArray(raw) ? raw : []
  const records = values.map((value, sourceIndex) => {
    const result = validateProductLibraryEntry(value)
    return result.valid
      ? { sourceIndex, value, valid: true, entry: result.entry, issues: [] }
      : { sourceIndex, value, valid: false, entry: null, issues: result.issues }
  })
  const entries = records.flatMap((record) => (record.entry === null ? [] : [record.entry]))
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
  const duplicateIssues = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => `duplicate product id: ${id}`)
  const issues = [
    ...records.flatMap((record) => record.issues.map((issue) => `productLibrary.${record.sourceIndex}: ${issue}`)),
    ...duplicateIssues,
  ]
  return { records, entries, issues, saveable: issues.length === 0 && duplicateIssues.length === 0 }
}

export function applyProductLibraryToStore(
  store: Readonly<LegacyStore>,
  entries: readonly ProductLibraryEntry[],
): LegacyStore {
  const issues: string[] = []
  const ids = new Set<string>()
  for (const entry of entries) {
    const result = validateProductLibraryEntry(entry)
    if (!result.valid) issues.push(...result.issues)
    else if (ids.has(result.entry.id)) issues.push(`duplicate product id: ${result.entry.id}`)
    else ids.add(result.entry.id)
  }
  if (issues.length > 0) throw new Error(issues.join('; '))
  return { ...store, productLibrary: entries } as LegacyStore
}

export function nextStableProductId(name: string, existing: readonly { readonly id: string }[]): string {
  const trimmedName = name.trim()
  if (trimmedName === '') throw new RangeError('product name must be nonblank')
  const ids = new Set(existing.map((entry) => entry.id))
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(trimmedName.normalize('NFKC'))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  const base = `product-${hash.toString(16).padStart(16, '0')}`
  if (!ids.has(base)) return base
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!ids.has(candidate)) return candidate
  }
  throw new RangeError('unable to allocate a unique stable product ID')
}
