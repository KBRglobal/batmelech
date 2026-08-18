import { useEffect, useRef, useState } from 'react'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import {
  DEFAULT_SUPPLIER_BY_CATEGORY,
  SUPPLIER_KEYS,
  SUPPLIER_LABELS,
  applyProductLibraryToStore,
  loadProductLibrary,
  minorUnitsToMoney,
  moneyToMinorUnits,
  nextStableProductId,
  priceCorrectionFromReceipt,
  quickCostEstimate,
  validateProductLibraryEntry,
  type ProductLibraryEntry,
  type SupplierKey,
} from '../domain/product-library.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type SaveState =
  | { readonly kind: 'idle'; readonly message: '' }
  | { readonly kind: 'saving'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const IDLE: SaveState = { kind: 'idle', message: '' }
const UNIT_PRESETS = ['ק״ג', 'גרם', 'ליטר', 'מ״ל', 'יחידה'] as const
const CATEGORY_PRESETS = Object.keys(DEFAULT_SUPPLIER_BY_CATEGORY)

interface SupplierListingDraft {
  readonly packSize: string
  readonly packUnit: string
  readonly packPrice: string
  readonly manualPrice: string
  readonly updatedAt: number
  readonly manualAt: number | null
}

interface ProductDraft {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly kosherOnly: boolean
  readonly supplierOverride: SupplierKey | ''
  readonly insignificant: boolean
  readonly nesto: SupplierListingDraft | null
  readonly lulu: SupplierListingDraft | null
  readonly rimon: SupplierListingDraft | null
}

function emptyListingDraft(now: number): SupplierListingDraft {
  return { packSize: '', packUnit: 'ק״ג', packPrice: '', manualPrice: '', updatedAt: now, manualAt: null }
}

function toDraft(entry: ProductLibraryEntry): ProductDraft {
  const listingDraft = (supplier: SupplierKey): SupplierListingDraft | null => {
    const listing = entry.listings[supplier]
    if (listing === undefined) return null
    return {
      packSize: listing.packSize,
      packUnit: listing.packUnit,
      packPrice: minorUnitsToMoney(listing.packPriceMinorUnits),
      manualPrice: listing.manualPrice === null ? '' : minorUnitsToMoney(listing.manualPrice.minorUnitsPerBaseUnit),
      updatedAt: listing.updatedAt,
      manualAt: listing.manualPrice?.at ?? null,
    }
  }
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    kosherOnly: entry.kosherOnly,
    supplierOverride: entry.supplierOverride ?? '',
    insignificant: entry.insignificant,
    nesto: listingDraft('nesto'),
    lulu: listingDraft('lulu'),
    rimon: listingDraft('rimon'),
  }
}

function draftToEntry(
  draft: ProductDraft,
  now: number,
): { readonly entry: ProductLibraryEntry | null; readonly issues: readonly string[] } {
  try {
    const listing = (supplierDraft: SupplierListingDraft | null) => {
      if (supplierDraft === null) return undefined
      if (supplierDraft.packSize.trim() === '' || supplierDraft.packPrice.trim() === '') return undefined
      const packPriceMinorUnits = moneyToMinorUnits(supplierDraft.packPrice.trim())
      const manualPrice =
        supplierDraft.manualPrice.trim() === ''
          ? null
          : {
              minorUnitsPerBaseUnit: moneyToMinorUnits(supplierDraft.manualPrice.trim()),
              at: supplierDraft.manualAt ?? now,
            }
      return {
        packSize: supplierDraft.packSize.trim(),
        packUnit: supplierDraft.packUnit.trim(),
        packPriceMinorUnits,
        updatedAt: supplierDraft.updatedAt,
        manualPrice,
      }
    }
    const nesto = listing(draft.nesto)
    const lulu = listing(draft.lulu)
    const rimon = listing(draft.rimon)
    const entry = {
      id: draft.id,
      name: draft.name.trim(),
      category: draft.category.trim(),
      kosherOnly: draft.kosherOnly,
      supplierOverride: draft.supplierOverride === '' ? null : draft.supplierOverride,
      insignificant: draft.insignificant,
      listings: {
        ...(nesto ? { nesto } : {}),
        ...(lulu ? { lulu } : {}),
        ...(rimon ? { rimon } : {}),
      },
    }
    const result = validateProductLibraryEntry(entry)
    return result.valid ? { entry: result.entry, issues: [] } : { entry: null, issues: result.issues }
  } catch {
    return { entry: null, issues: ['מחיר לא תקין'] }
  }
}

function Status({ state }: { readonly state: SaveState }) {
  if (state.kind === 'idle') return null
  return (
    <p
      role={state.kind === 'error' ? 'alert' : 'status'}
      className={`text-xs font-black ${state.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {state.message}
    </p>
  )
}

const inputClassName =
  'min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20'
const cardClassName = 'rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6'

function ReceiptCalculator({
  packUnit,
  onCorrected,
}: {
  readonly packUnit: string
  readonly onCorrected: (pricePerBaseUnit: string) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [paid, setPaid] = useState('')
  const compute = () => {
    if (quantity.trim() === '' || paid.trim() === '') return
    try {
      const paidMinorUnits = moneyToMinorUnits(paid.trim())
      const corrected = priceCorrectionFromReceipt(quantity.trim(), packUnit, packUnit, paidMinorUnits)
      if (corrected !== null) onCorrected(minorUnitsToMoney(corrected))
    } catch {
      // invalid input — leave the manual field untouched
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-secondary/30 p-3">
      <label className="text-[11px] font-black text-muted-foreground">
        כמות מהקבלה ({packUnit})
        <input className={inputClassName} value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} />
      </label>
      <label className="text-[11px] font-black text-muted-foreground">
        שולם בפועל
        <input className={inputClassName} value={paid} onChange={(event) => setPaid(event.currentTarget.value)} />
      </label>
      <button
        type="button"
        onClick={compute}
        className="min-h-11 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground"
      >
        עדכן מחיר ידני
      </button>
    </div>
  )
}

function SupplierListingCard({
  supplier,
  draft,
  onChange,
}: {
  readonly supplier: SupplierKey
  readonly draft: SupplierListingDraft | null
  readonly onChange: (next: SupplierListingDraft | null) => void
}) {
  const now = () => Date.now()
  if (draft === null) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-4">
        <p className="text-xs font-black text-muted-foreground">{SUPPLIER_LABELS[supplier]} — אין מחיר עדיין</p>
        <button
          type="button"
          onClick={() => onChange(emptyListingDraft(now()))}
          className="mt-2 min-h-11 rounded-xl border border-border px-4 text-xs font-black text-primary"
        >
          הוספת מחיר
        </button>
      </div>
    )
  }
  const quickEstimate =
    draft.packSize.trim() !== '' && draft.packPrice.trim() !== ''
      ? `${draft.packPrice} AED / ${draft.packSize} ${draft.packUnit}`
      : null
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-primary">{SUPPLIER_LABELS[supplier]}</p>
        <button type="button" onClick={() => onChange(null)} className="text-xs font-black text-destructive">
          הסרה
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[11px] font-black text-muted-foreground">
          גודל אריזה
          <input
            className={inputClassName}
            value={draft.packSize}
            onChange={(event) => onChange({ ...draft, packSize: event.currentTarget.value, updatedAt: now() })}
          />
        </label>
        <label className="text-[11px] font-black text-muted-foreground">
          יחידה
          <select
            className={inputClassName}
            value={draft.packUnit}
            onChange={(event) => onChange({ ...draft, packUnit: event.currentTarget.value, updatedAt: now() })}
          >
            {UNIT_PRESETS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-[11px] font-black text-muted-foreground">
          מחיר לאריזה (AED)
          <input
            className={inputClassName}
            value={draft.packPrice}
            onChange={(event) => onChange({ ...draft, packPrice: event.currentTarget.value, updatedAt: now() })}
          />
        </label>
      </div>
      {quickEstimate !== null && <p className="mt-2 text-[11px] font-bold text-muted-foreground">{quickEstimate}</p>}
      <label className="mt-3 block text-[11px] font-black text-muted-foreground">
        מחיר ידני לפי קבלה (גובר על מחיר האריזה)
        <input
          className={inputClassName}
          placeholder={`מחיר ל${draft.packUnit}`}
          value={draft.manualPrice}
          onChange={(event) => onChange({ ...draft, manualPrice: event.currentTarget.value, manualAt: now() })}
        />
      </label>
      <ReceiptCalculator
        packUnit={draft.packUnit}
        onCorrected={(price) => onChange({ ...draft, manualPrice: price, manualAt: now() })}
      />
    </div>
  )
}

function QuickCalculator({ entry }: { readonly entry: ProductLibraryEntry }) {
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<string>('ק״ג')
  const result = (() => {
    if (quantity.trim() === '') return null
    try {
      return quickCostEstimate(entry, quantity.trim(), unit)
    } catch {
      return null
    }
  })()
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-secondary/30 p-3">
      <label className="text-[11px] font-black text-muted-foreground">
        כמות
        <input className={inputClassName} value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} />
      </label>
      <label className="text-[11px] font-black text-muted-foreground">
        יחידה
        <select className={inputClassName} value={unit} onChange={(event) => setUnit(event.currentTarget.value)}>
          {UNIT_PRESETS.map((presetUnit) => (
            <option key={presetUnit} value={presetUnit}>
              {presetUnit}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs font-black text-primary">
        {result === null ? 'הקלד כמות לחישוב' : `≈ ${minorUnitsToMoney(result.minorUnits)} AED (${SUPPLIER_LABELS[result.supplier]})`}
      </p>
    </div>
  )
}

interface ProductLibraryInitialization {
  baseEnvelope: VersionedStateEnvelope | null
  baseStore: LegacyStore
  entries: readonly ProductLibraryEntry[]
}

export function ProductLibraryScreen({
  onSave,
  autosaveDelayMs = 1500,
}: {
  readonly onSave?: StoreSaveHandler
  readonly autosaveDelayMs?: number
}) {
  const storeQuery = useStore()
  const initializationRef = useRef<ProductLibraryInitialization | null>(null)
  const dirtyRef = useRef(false)
  const fireAutosaveRef = useRef<() => void>(() => {})
  const lastSavedJsonRef = useRef<string | null>(null)
  const [drafts, setDrafts] = useState<readonly ProductDraft[] | null>(null)
  const [search, setSearch] = useState('')
  const [saveState, setSaveState] = useState<SaveState>(IDLE)

  useEffect(() => {
    if (drafts === null) return
    const timer = setTimeout(() => fireAutosaveRef.current(), autosaveDelayMs)
    return () => clearTimeout(timer)
  }, [drafts, autosaveDelayMs])

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    const baseStore = storeQuery.data.data
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore,
      entries: loadProductLibrary(baseStore).entries,
    }
  }

  const queryEnvelope = storeQuery.data
  if (
    initializationRef.current !== null &&
    queryEnvelope != null &&
    isVersionedStateEnvelope(queryEnvelope) &&
    lastSavedJsonRef.current !== null &&
    (initializationRef.current.baseEnvelope === null ||
      !isSameVersionedStateEnvelope(queryEnvelope, initializationRef.current.baseEnvelope)) &&
    JSON.stringify((queryEnvelope.data as Record<string, unknown>).productLibrary ?? []) === lastSavedJsonRef.current
  ) {
    const nextBaseStore = queryEnvelope.data
    initializationRef.current = {
      baseEnvelope: queryEnvelope,
      baseStore: nextBaseStore,
      entries: loadProductLibrary(nextBaseStore).entries,
    }
  }

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את ספריית המוצרים" />
  if (storeQuery.isError || initializationRef.current === null) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את ספריית המוצרים"
        description="לא בוצע שינוי. אפשר לנסות שוב."
        retry={() => void storeQuery.refetch()}
      />
    )
  }

  const initialization = initializationRef.current
  const { baseEnvelope, baseStore, entries } = initialization
  const currentDrafts = drafts ?? entries.map(toDraft)
  const currentDraftsJson = JSON.stringify(currentDrafts)
  const dirty = drafts !== null && currentDraftsJson !== JSON.stringify(entries.map(toDraft))
  dirtyRef.current = dirty

  const visibleIds = new Set(
    currentDrafts
      .filter((draft) => search.trim() === '' || draft.name.includes(search.trim()) || draft.category.includes(search.trim()))
      .map((draft) => draft.id),
  )

  const updateDraft = (index: number, next: ProductDraft) => {
    setDrafts(currentDrafts.map((draft, draftIndex) => (draftIndex === index ? next : draft)))
    setSaveState(IDLE)
  }

  const removeDraft = (index: number) => {
    setDrafts(currentDrafts.filter((_, draftIndex) => draftIndex !== index))
    setSaveState(IDLE)
  }

  const addProduct = () => {
    const name = 'מוצר חדש'
    const id = nextStableProductId(`${name}-${currentDrafts.length}`, currentDrafts)
    const now = Date.now()
    const next: ProductDraft = {
      id,
      name,
      category: '',
      kosherOnly: false,
      supplierOverride: '',
      insignificant: false,
      nesto: emptyListingDraft(now),
      lulu: null,
      rimon: null,
    }
    setDrafts([...currentDrafts, next])
    setSaveState(IDLE)
  }

  const save = async (auto: boolean) => {
    if (saveState.kind === 'saving') return
    const now = Date.now()
    const results = currentDrafts.map((draft) => draftToEntry(draft, now))
    const invalidCount = results.filter((result) => result.entry === null).length
    if (invalidCount > 0) {
      if (!auto) {
        setSaveState({ kind: 'error', message: 'אי אפשר לשמור — יש מוצר עם נתונים חסרים או מחיר לא תקין.' })
      }
      return
    }
    const candidateEntries = results.map((result) => result.entry) as ProductLibraryEntry[]
    const candidateJson = JSON.stringify(candidateEntries)
    if (candidateJson === JSON.stringify(entries) || candidateJson === lastSavedJsonRef.current) {
      if (!auto) setSaveState({ kind: 'saved', message: 'הכל כבר שמור.' })
      return
    }
    if (!onSave) {
      if (!auto) setSaveState({ kind: 'error', message: 'השמירה עדיין לא מחוברת למסך הזה.' })
      return
    }
    if (baseEnvelope === null || !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      setSaveState({
        kind: 'error',
        message: 'הנתונים התעדכנו מאז שנפתח המסך. לא נשמר כלום — פותחים את המסך מחדש וממשיכים משם.',
      })
      return
    }
    setSaveState({ kind: 'saving', message: 'שומרת...' })
    try {
      const result = (await onSave({
        reason: 'product-library',
        baseEnvelope,
        baseStore,
        nextStore: applyProductLibraryToStore(baseStore, candidateEntries),
      })) as VersionedStateEnvelope | undefined
      lastSavedJsonRef.current = candidateJson
      if (result != null && isVersionedStateEnvelope(result)) {
        const nextBaseStore = result.data as LegacyStore
        initialization.baseEnvelope = result
        initialization.baseStore = nextBaseStore
        initialization.entries = loadProductLibrary(nextBaseStore).entries
      }
      setSaveState({ kind: 'saved', message: auto ? 'נשמר אוטומטית.' : 'ספריית המוצרים נשמרה.' })
    } catch {
      setSaveState({ kind: 'error', message: 'השמירה נכשלה. הטיוטה נשארה כאן ואפשר לנסות שוב.' })
    }
  }
  fireAutosaveRef.current = () => {
    if (onSave && dirtyRef.current) void save(true)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-primary sm:text-4xl">ספריית מוצרים ורכש</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            מחיר לכל מוצר משני הספקים הקבועים — נסטו דובאי ורימון כשר. מוצר כשר בלבד מקובע לרימון אוטומטית.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="חיפוש מוצר"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="חיפוש מוצר..."
            className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={addProduct}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground"
          >
            <LocalIcon name="ph:plus-bold" />
            מוצר חדש
          </button>
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between">
        <Status state={saveState} />
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saveState.kind === 'saving'}
          className="min-h-11 rounded-xl border border-primary px-5 text-sm font-black text-primary disabled:opacity-50"
        >
          שמירה
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {visibleIds.size === 0 && <p className="text-sm font-bold text-muted-foreground">אין עדיין מוצרים בספרייה.</p>}
        {currentDrafts.map((draft, index) => {
          if (!visibleIds.has(draft.id)) return null
          const validation = draftToEntry(draft, Date.now())
          return (
            <div key={draft.id} className={cardClassName}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-[11px] font-black text-muted-foreground">
                  שם המוצר
                  <input
                    className={inputClassName}
                    value={draft.name}
                    onChange={(event) => updateDraft(index, { ...draft, name: event.currentTarget.value })}
                  />
                </label>
                <label className="text-[11px] font-black text-muted-foreground">
                  קטגוריה
                  <input
                    className={inputClassName}
                    list="product-category-presets"
                    value={draft.category}
                    onChange={(event) => updateDraft(index, { ...draft, category: event.currentTarget.value })}
                  />
                </label>
                <label className="text-[11px] font-black text-muted-foreground">
                  ספק ברירת מחדל
                  <select
                    className={inputClassName}
                    value={draft.supplierOverride}
                    disabled={draft.kosherOnly}
                    onChange={(event) =>
                      updateDraft(index, { ...draft, supplierOverride: event.currentTarget.value as SupplierKey | '' })
                    }
                  >
                    <option value="">אוטומטי — הזול מבין השניים</option>
                    {SUPPLIER_KEYS.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {SUPPLIER_LABELS[supplier]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-black text-primary">
                  <input
                    type="checkbox"
                    checked={draft.kosherOnly}
                    onChange={(event) => updateDraft(index, { ...draft, kosherOnly: event.currentTarget.checked })}
                  />
                  כשר בלבד — קובע אוטומטית לרימון
                </label>
                <label className="flex items-center gap-2 text-xs font-black text-primary">
                  <input
                    type="checkbox"
                    checked={draft.insignificant}
                    onChange={(event) => updateDraft(index, { ...draft, insignificant: event.currentTarget.checked })}
                  />
                  זניח — לא מופיע ברשימת הקניות
                </label>
                <button type="button" onClick={() => removeDraft(index)} className="text-xs font-black text-destructive">
                  מחיקת מוצר
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SupplierListingCard
                  supplier="nesto"
                  draft={draft.nesto}
                  onChange={(next) => updateDraft(index, { ...draft, nesto: next })}
                />
                <SupplierListingCard
                  supplier="lulu"
                  draft={draft.lulu}
                  onChange={(next) => updateDraft(index, { ...draft, lulu: next })}
                />
                <SupplierListingCard
                  supplier="rimon"
                  draft={draft.rimon}
                  onChange={(next) => updateDraft(index, { ...draft, rimon: next })}
                />
              </div>

              {validation.entry !== null ? (
                <QuickCalculator entry={validation.entry} />
              ) : (
                <p className="mt-3 text-[11px] font-black text-destructive">
                  {validation.issues.join('; ') || 'חסרים פרטים כדי לחשב מחיר.'}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <datalist id="product-category-presets">
        {CATEGORY_PRESETS.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </div>
  )
}

export default ProductLibraryScreen
