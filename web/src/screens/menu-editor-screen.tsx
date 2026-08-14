import { useEffect, useRef, useState } from 'react'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import {
  AUTHORITATIVE_ALLOWANCES,
  MENU_CATEGORY_KEYS,
  addCatalogExtra,
  addCatalogItem,
  applyCatalogToStore,
  loadSettingsCatalog,
  removeCatalogExtra,
  removeCatalogItem,
  renameCatalogExtra,
  renameCatalogItem,
  updateCatalogCorePrice,
  updateCatalogExtraPrice,
  updateLunchPrice,
  validateSettingsCatalog,
  type CatalogResult,
  type LunchPricePath,
  type MenuCategoryKey,
  type SettingsCatalog,
  type StoreSaveHandler,
} from '../domain/settings-catalog.ts'
import { parseLegacyUsdAmount } from '../domain/customers-finance.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

const CATEGORY_LABELS: Readonly<Record<MenuCategoryKey, string>> = {
  salads: 'סלטים',
  firsts: 'ראשונות',
  mains: 'עיקריות',
  sides: 'תוספות',
  desserts: 'קינוחים',
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface MenuInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
  readonly loaded: CatalogResult
}

function displayDollarInput(minorUnits: number): string {
  const dollars = Math.floor(minorUnits / 100)
  const cents = String(minorUnits % 100).padStart(2, '0')
  return minorUnits % 100 === 0 ? String(dollars) : `${dollars}.${cents}`
}

function priceInput(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = parseLegacyUsdAmount(value)
  return parsed.state === 'valid' ? parsed.minorUnits : null
}

function SaveStatus({ state, message }: { state: SaveState; message: string }) {
  if (state === 'idle') return null
  return (
    <p
      className={`text-xs font-black ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
      role={state === 'error' ? 'alert' : 'status'}
    >
      {state === 'saving' ? 'שומרת...' : state === 'saved' ? 'נשמר' : message}
    </p>
  )
}

function PriceField({
  label,
  value,
  onCommit,
  fieldId,
  onValidityChange,
  fixed = false,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  fieldId?: string
  onValidityChange?: (fieldId: string, invalid: boolean) => void
  fixed?: boolean
}) {
  const [input, setInput] = useState(displayDollarInput(value))
  useEffect(() => {
    setInput(displayDollarInput(value))
    if (fieldId !== undefined) onValidityChange?.(fieldId, false)
  }, [value, fieldId, onValidityChange])
  const parsed = priceInput(input)
  return (
    <label className="block rounded-2xl border border-border bg-card p-4">
      <span className="text-xs font-black text-muted-foreground">{label}</span>
      <div className="mt-2 flex items-center gap-2" dir="ltr">
        <span className="font-black text-primary">$</span>
        <input
          aria-label={label}
          inputMode="decimal"
          value={input}
          disabled={fixed}
          onChange={(event) => {
            const next = event.currentTarget.value
            setInput(next)
            if (fieldId !== undefined) onValidityChange?.(fieldId, priceInput(next) === null)
          }}
          onBlur={() => {
            if (!fixed && parsed !== null) onCommit(parsed)
          }}
          className={`min-h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm font-black outline-none focus:ring-2 focus:ring-primary/20 ${
            parsed === null ? 'border-destructive bg-rose-50 text-destructive' : 'border-border bg-secondary/40 text-primary'
          } ${fixed ? 'cursor-not-allowed opacity-70' : ''}`}
        />
      </div>
      {parsed === null && <span className="mt-1 block text-xs font-bold text-destructive">מחיר לא תקין</span>}
    </label>
  )
}

function FixedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-black text-muted-foreground">{label}</p>
      <p className="mt-3 text-lg font-black text-primary">{value}</p>
    </div>
  )
}

function CategoryEditor({
  category,
  catalog,
  onUpdate,
}: {
  category: MenuCategoryKey
  catalog: SettingsCatalog
  onUpdate: (mutate: (catalog: SettingsCatalog) => SettingsCatalog) => void
}) {
  const items = catalog.categories[category]
  const locked = category === 'firsts'
  const [newName, setNewName] = useState('')
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-black text-primary">
        {CATEGORY_LABELS[category]} ({items.length})
      </summary>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-xl bg-secondary/40 p-3">
            <input
              aria-label={`שם המנה — ${item.name}`}
              defaultValue={item.name}
              disabled={locked}
              onBlur={(event) => {
                const next = event.currentTarget.value
                if (next.trim() !== '' && next !== item.name) {
                  onUpdate((current) => renameCatalogItem(current, category, item.id, next))
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-primary outline-none focus:border-border focus:bg-card disabled:cursor-not-allowed"
            />
            {locked ? (
              <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-black text-muted-foreground">קבוע</span>
            ) : (
              <button
                type="button"
                onClick={() => onUpdate((current) => removeCatalogItem(current, category, item.id))}
                className="shrink-0 rounded-full px-3 py-1 text-xs font-black text-destructive hover:bg-rose-50"
              >
                הסרה
              </button>
            )}
          </div>
        ))}
        {locked ? (
          <p className="rounded-xl bg-secondary/60 p-3 text-xs font-bold text-muted-foreground">
            מנה ראשונה קבועה במבנה שלה (זוג פילה דג עם רוטב לבחירה, או קציצות דגים) — לא ניתן להוסיף
            או להסיר כאן.
          </p>
        ) : (
          <form
            className="flex gap-2 pt-1"
            onSubmit={(event) => {
              event.preventDefault()
              if (newName.trim() === '') return
              onUpdate((current) => addCatalogItem(current, category, newName))
              setNewName('')
            }}
          >
            <input
              aria-label={`הוספת מנה ל${CATEGORY_LABELS[category]}`}
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
              placeholder="הוספת מנה..."
              className="min-h-10 flex-1 rounded-xl border border-border px-3 text-sm font-bold outline-none"
            />
            <button type="submit" className="rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground">
              הוספה
            </button>
          </form>
        )}
      </div>
    </details>
  )
}

function ExtrasEditor({
  catalog,
  onUpdate,
}: {
  catalog: SettingsCatalog
  onUpdate: (mutate: (catalog: SettingsCatalog) => SettingsCatalog) => void
}) {
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-black text-primary">
        אקסטרות ומחירים ({catalog.extras.length})
      </summary>
      <div className="mt-4 space-y-2">
        {catalog.extras.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/40 p-3">
            <input
              aria-label={`שם האקסטרה — ${item.name}`}
              defaultValue={item.name}
              onBlur={(event) => {
                const next = event.currentTarget.value
                if (next.trim() !== '' && next !== item.name) {
                  onUpdate((current) => renameCatalogExtra(current, item.id, next))
                }
              }}
              className="min-w-48 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-primary outline-none focus:border-border focus:bg-card"
            />
            <PriceField
              label={`מחיר ${item.name}`}
              value={item.priceMinorUnits}
              onCommit={(next) => onUpdate((current) => updateCatalogExtraPrice(current, item.id, next))}
            />
            <button
              type="button"
              onClick={() => onUpdate((current) => removeCatalogExtra(current, item.id))}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-black text-destructive hover:bg-rose-50"
            >
              הסרה
            </button>
          </div>
        ))}
        <form
          className="flex flex-wrap gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault()
            const priceMinorUnits = priceInput(newPrice)
            if (newName.trim() === '' || priceMinorUnits === null) return
            onUpdate((current) => addCatalogExtra(current, newName, priceMinorUnits))
            setNewName('')
            setNewPrice('')
          }}
        >
          <input
            aria-label="שם אקסטרה חדשה"
            value={newName}
            onChange={(event) => setNewName(event.currentTarget.value)}
            placeholder="הוספת אקסטרה..."
            className="min-h-10 min-w-48 flex-1 rounded-xl border border-border px-3 text-sm font-bold outline-none"
          />
          <input
            aria-label="מחיר האקסטרה החדשה"
            dir="ltr"
            inputMode="decimal"
            value={newPrice}
            onChange={(event) => setNewPrice(event.currentTarget.value)}
            placeholder="$"
            className="min-h-10 w-24 rounded-xl border border-border px-3 text-sm font-bold outline-none"
          />
          <button type="submit" className="rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground">
            הוספה
          </button>
        </form>
      </div>
    </details>
  )
}

function LunchEditor({
  catalog,
  onUpdate,
}: {
  catalog: SettingsCatalog
  onUpdate: (mutate: (catalog: SettingsCatalog) => SettingsCatalog) => void
}) {
  const commitPrice = (path: LunchPricePath) => (next: number) =>
    onUpdate((current) => updateLunchPrice(current, path, next))
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-black text-primary">תפריט צהריים ({catalog.lunch.length})</summary>
      <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs font-bold leading-6 text-muted-foreground">
        שמות המנות ומבנה הבחירות (גדלים, ימי זמינות) קבועים כרגע — רק המחירים ניתנים לעריכה.
      </p>
      <div className="mt-4 space-y-4">
        {catalog.lunch.map((item) => (
          <section key={item.key} className="rounded-2xl bg-secondary/40 p-4">
            <h3 className="font-black text-primary">{item.name}</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {item.priceMinorUnits !== null && (
                <PriceField label={`מחיר ${item.name}`} value={item.priceMinorUnits} onCommit={commitPrice({ kind: 'base', itemKey: item.key })} />
              )}
              {item.variants.map((variant) => (
                <div key={variant.key} className="space-y-2">
                  <PriceField
                    label={`${item.name} — ${variant.name}`}
                    value={variant.priceMinorUnits}
                    onCommit={commitPrice({ kind: 'variant', itemKey: item.key, variantKey: variant.key })}
                  />
                  {variant.weekendOnly && <p className="text-xs font-black text-amber-800">זמין בסוף שבוע בלבד</p>}
                  {variant.includedSides > 0 && <p className="text-xs font-bold text-muted-foreground">כולל {variant.includedSides} תוספות</p>}
                  {variant.extraSideMinorUnits !== null && (
                    <PriceField
                      label={`תוספת בחירה — ${variant.name}`}
                      value={variant.extraSideMinorUnits}
                      onCommit={commitPrice({ kind: 'side', itemKey: item.key, variantKey: variant.key })}
                    />
                  )}
                </div>
              ))}
              {item.addon !== null && (
                <PriceField
                  label={`${item.name} — ${item.addon.name}`}
                  value={item.addon.priceMinorUnits}
                  onCommit={commitPrice({ kind: 'addon', itemKey: item.key })}
                />
              )}
            </div>
          </section>
        ))}
      </div>
    </details>
  )
}

export function MenuEditorScreen({ onSave }: { onSave?: StoreSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<MenuInitialization | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveMessage, setSaveMessage] = useState('')

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore: storeQuery.data.data,
      loaded: loadSettingsCatalog(storeQuery.data.data),
    }
  }
  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את התפריט" />
  if (storeQuery.isError || initializationRef.current === null) {
    return <ScreenState kind="error" title="לא הצלחנו לטעון את התפריט" retry={() => void storeQuery.refetch()} />
  }
  const initialization = initializationRef.current
  const { baseEnvelope, baseStore, loaded } = initialization
  const current = loaded.catalog
  const validation = validateSettingsCatalog(current)
  const blockingLoadWarnings = loaded.warnings.filter((warning) => warning.code !== 'SUPERSEDED_EXTRA_REMOVED')
  const visibleWarnings = [...loaded.warnings, ...validation].filter(
    (warning, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === warning.code &&
          candidate.path === warning.path &&
          candidate.message === warning.message,
      ) === index,
  )

  const commit = async () => {
    if (!onSave) {
      setSaveState('error')
      setSaveMessage('השמירה המוגנת עדיין אינה מחוברת. לא בוצע שינוי בשרת.')
      return
    }
    if (baseEnvelope === null || !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      setSaveState('error')
      setSaveMessage('הנתונים התעדכנו מאז פתיחת הטיוטה. לא בוצעה שמירה; צריך לפתוח מחדש את המסך.')
      return
    }
    if (validation.length > 0 || blockingLoadWarnings.length > 0) {
      setSaveState('error')
      setSaveMessage('יש לתקן את שגיאות התפריט לפני שמירה.')
      return
    }
    setSaveState('saving')
    try {
      await onSave({
        reason: 'menu',
        baseEnvelope,
        baseStore,
        nextStore: applyCatalogToStore(baseStore, current),
      })
      setSaveState('saved')
      setSaveMessage('')
    } catch {
      setSaveState('error')
      setSaveMessage('השמירה נכשלה. הנתונים בשרת לא סומנו כנשמרו.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-primary sm:text-4xl">מחירון ותפריט</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">המנות ומחירי הצהריים מוצגים מתוך המחירון הקבוע.</p>
        </div>
        <button type="button" onClick={() => void commit()} disabled={saveState === 'saving'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-black text-primary-foreground disabled:opacity-50">
          <LocalIcon name="ph:check-circle-bold" />
          <span>שמירת התפריט</span>
        </button>
      </header>
      <div className="mt-3"><SaveStatus state={saveState} message={saveMessage} /></div>

      {visibleWarnings.length > 0 && (
        <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5" role="alert">
          <h2 className="font-black text-primary">יש פרטי תפריט שדורשים בדיקה</h2>
          <ul className="mt-2 list-inside list-disc text-xs font-bold leading-6 text-amber-900">
            {visibleWarnings.map((warning, index) => <li key={`${warning.path}-${index}`}>{warning.message}</li>)}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-black text-primary">כללי הארוחה הזוגית</h2>
        <p className="mt-2 text-xs font-bold text-muted-foreground">
          מחיר הארוחה, החלה והאקסטרות מוצגים בלבד במהדורה הזו, כי טופס הלקוחות עדיין משתמש במחירים קבועים.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <PriceField label="מחיר ארוחה זוגית" value={current.couplePriceMinorUnits} fixed onCommit={() => undefined} />
          <PriceField label="מחיר חלה נוספת" value={current.extraChallahMinorUnits} fixed onCommit={() => undefined} />
          <FixedValue label="סלטים כלולים בזוגית" value={String(AUTHORITATIVE_ALLOWANCES.includedSaladsPerCouple)} />
          <FixedValue label="דגים כלולים בזוגית" value={String(AUTHORITATIVE_ALLOWANCES.includedFishUnitsPerCouple)} />
          <PriceField label="מחיר פילה דג נוסף" value={AUTHORITATIVE_ALLOWANCES.extraFishFilletMinorUnits} fixed onCommit={() => undefined} />
        </div>
        <div className="mt-5 rounded-2xl bg-secondary p-4 text-sm font-bold leading-7 text-primary">
          <p>בכל ארוחה זוגית כלולים שני פילטים, בכל שילוב של מרוקאי וחריימה. כל פילה מעבר לכמות הכלולה עולה 30$. מנת קציצות דגים אחת שווה למנת דג זוגית מלאה.</p>
          <p className="mt-2">סלטים: 4 כלולים, כל בלוק נוסף של 4 עולה 25$, והיתרה עולה 7$ לסלט.</p>
          <p className="mt-2">קינוח: 2 סופלה או מנת סוכריות בקלוואה אחת לכל זוגית.</p>
        </div>
      </section>

      <section className="mt-8 space-y-3">
        {MENU_CATEGORY_KEYS.map((category) => <CategoryEditor key={category} category={category} catalog={current} />)}
        <ExtrasEditor catalog={current} />
        <LunchEditor catalog={current} />
      </section>
    </div>
  )
}

export default MenuEditorScreen
