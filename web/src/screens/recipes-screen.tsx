import { useEffect, useRef, useState } from 'react'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import { loadProductLibrary, minorUnitsToMoney, type ProductLibraryEntry } from '../domain/product-library.ts'
import { costRecipe, saladSizeCosts } from '../domain/recipe-costing.ts'
import {
  applyRecipesToStore,
  buildPreparationCatalog,
  createRecipeDraft,
  loadRecipeBook,
  loadSettingsCatalog,
  nextStableIngredientId,
  recipeTargets,
  validateRecipeDrafts,
  type CatalogItem,
  type CatalogResult,
  type RecipeBook,
  type RecipeDraft,
  type StoreSaveHandler,
} from '../domain/settings-catalog.ts'
import {
  PositiveDecimalQuantitySchema,
  WastePercentSchema,
  type RecipeDefinition,
} from '../domain/recipes.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type SaveState =
  | { readonly kind: 'idle'; readonly message: '' }
  | { readonly kind: 'saving'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const IDLE: SaveState = { kind: 'idle', message: '' }

const HEAVY_PRODUCTS_NOTE =
  'רושמים רק מצרכים כבדים — בשר, עוף, דג, תפו״א, אורז… בלי מלח, סוכר, שמן ותבלינים.'

const UNIT_PRESETS = ['ק״ג', 'גרם', 'יחידה'] as const

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  salads: 'סלטים',
  firsts: 'ראשונות',
  mains: 'עיקריות',
  sides: 'תוספות',
  desserts: 'קינוחים',
  extras: 'אקסטרות',
  custom: 'מיוחדים',
  lunch: 'צהריים',
}

interface RecipesInitialization {
  baseEnvelope: VersionedStateEnvelope | null
  baseStore: LegacyStore
  catalogResult: CatalogResult
  book: RecipeBook
}

type DraftIngredient = RecipeDraft['ingredients'][number]

function toDraft(recipe: RecipeDefinition): RecipeDraft {
  return {
    itemId: recipe.itemId,
    ...(recipe.name === undefined ? {} : { name: recipe.name }),
    yield: String(recipe.yield),
    ingredients: recipe.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      ...(ingredient.wastePercent === undefined
        ? {}
        : { wastePercent: ingredient.wastePercent }),
    })),
  }
}

function recipeName(draft: RecipeDraft, targetsById: ReadonlyMap<string, string>): string {
  return targetsById.get(draft.itemId) ?? draft.name?.trim() ?? draft.itemId
}

// Batch-sold products ("ל־4 אנשים", "זוגי", "מגש", "סיר"): one recipe always
// describes ONE whole sold product, so the quantities cover the entire batch.
// We pre-suggest the matching yield for empty recipes only and spell the batch
// out in words. Quantities are never divided or multiplied automatically.
interface BatchHint {
  readonly suggestedYield: string
  readonly note: string
  readonly sizeLabel: string
}

function batchHintFromName(name: string): BatchHint | null {
  const normalized = name.normalize('NFKC')
  const explicitCount = normalized.match(/(?:^|[\s(])ל[־-]?\s?(\d{1,2})/)
  if (explicitCount !== null) {
    const count = Number(explicitCount[1])
    if (count >= 2) {
      return {
        suggestedYield: String(count),
        note: `המנה הזאת נמכרת כיחידה של ${count} — הכמויות צריכות לכסות את כולה.`,
        sizeLabel: `מוצר של ${count} מנות`,
      }
    }
  }
  if (normalized.includes('זוגי')) {
    return {
      suggestedYield: '2',
      note: 'המנה הזאת נמכרת כזוג — הכמויות צריכות לכסות את שתי המנות.',
      sizeLabel: 'מוצר זוגי',
    }
  }
  if (/(?:^|[\s(])מגש/.test(normalized)) {
    return {
      suggestedYield: '1',
      note: 'רושמים את הכמויות למגש כולו — כל מה שנכנס בו.',
      sizeLabel: 'מגש שלם',
    }
  }
  if (/(?:^|[\s(])סיר/.test(normalized)) {
    return {
      suggestedYield: '1',
      note: 'רושמים את הכמויות לסיר כולו — כל מה שנכנס בו.',
      sizeLabel: 'סיר שלם',
    }
  }
  return null
}

// Shared base name for grouping size variants of the same dish next to each
// other in the list. Strips size markers only — never touches stored data.
function baseDishName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\(([^)]*)\)/g, (match, inner: string) =>
      /זוגי|תוספת|אנשים|מנות|יח|ל[־-]?\s?\d/.test(inner) ? ' ' : match,
    )
    .replace(/(?:^|\s)ל[־-]?\s?\d+(?:[־-]\d+)?(\s|$)/g, ' ')
    .replace(/^(?:מגש|סיר|מנת)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Friendly wording over the exact same constraints the save path enforces
// (RecipeDraftSchema + RecipeDefinitionSchema). The schemas stay the only
// gate; these hints only translate them to human Hebrew.
function yieldHint(value: string): string | null {
  return /^[1-9]\d*$/.test(value.trim()) ? null : 'צריך מספר שלם של מנות — למשל 4'
}

function wholeProductSentence(yieldValue: string): string | null {
  const trimmed = yieldValue.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  return trimmed === '1'
    ? 'הכמויות במתכון הן למוצר שלם אחד — מנה אחת.'
    : `הכמויות במתכון הן למוצר שלם אחד — ${trimmed} מנות.`
}

function ingredientHints(ingredient: DraftIngredient): readonly string[] {
  const hints: string[] = []
  if (ingredient.ingredientName.trim() === '') hints.push('חסר שם למצרך')
  const quantity = ingredient.quantity.trim()
  if (quantity === '') hints.push('חסרה כמות')
  else if (!PositiveDecimalQuantitySchema.safeParse(quantity).success) {
    hints.push('כמות צריכה להיות מספר גדול מאפס — למשל 2 או 0.5')
  }
  if (ingredient.unit.trim() === '') hints.push('חסרה יחידה — ק״ג, גרם או יחידה')
  const waste = ingredient.wastePercent?.trim() ?? ''
  if (waste !== '' && !WastePercentSchema.safeParse(waste).success) {
    hints.push('פחת הוא אחוז בין 0 ל־100')
  }
  return hints
}

// name -> unit -> how many ingredient rows across all drafts use it. Feeds the
// autocomplete and the unit-consistency nudge.
type IngredientUsage = ReadonlyMap<string, ReadonlyMap<string, number>>

function buildIngredientUsage(drafts: readonly RecipeDraft[]): IngredientUsage {
  const usage = new Map<string, Map<string, number>>()
  for (const draft of drafts) {
    for (const ingredient of draft.ingredients) {
      const name = ingredient.ingredientName.trim()
      const unit = ingredient.unit.trim()
      if (name === '' || unit === '') continue
      const units = usage.get(name) ?? new Map<string, number>()
      units.set(unit, (units.get(unit) ?? 0) + 1)
      usage.set(name, units)
    }
  }
  return usage
}

function unitsUsedElsewhere(
  usage: IngredientUsage,
  ingredient: DraftIngredient,
): readonly string[] {
  const name = ingredient.ingredientName.trim()
  const ownUnit = ingredient.unit.trim()
  const units = usage.get(name)
  if (units === undefined) return []
  return [...units.entries()]
    .filter(([unit, count]) => (unit === ownUnit ? count - 1 : count) > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([unit]) => unit)
}

function mostCommonUnit(usage: IngredientUsage, name: string): string | null {
  const units = usage.get(name.trim())
  if (units === undefined || units.size === 0) return null
  return [...units.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
}

function Status({ state }: { state: SaveState }) {
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

function chipClassName(active: boolean): string {
  return `inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-xs font-black transition-colors ${
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary'
  }`
}

function IngredientRows({
  draft,
  usage,
  onChange,
}: {
  readonly draft: RecipeDraft
  readonly usage: IngredientUsage
  readonly onChange: (draft: RecipeDraft) => void
}) {
  const [customUnitIds, setCustomUnitIds] = useState<ReadonlySet<string>>(new Set())
  const [wasteOpenIds, setWasteOpenIds] = useState<ReadonlySet<string>>(new Set())

  const updateIngredient = (index: number, patch: Partial<DraftIngredient>) => {
    onChange({
      ...draft,
      ingredients: draft.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? { ...ingredient, ...patch } : ingredient,
      ),
    })
  }

  const isPresetUnit = (unit: string): boolean =>
    (UNIT_PRESETS as readonly string[]).includes(unit)

  return (
    <div className="space-y-3">
      <datalist id="recipes-known-ingredients">
        {[...usage.keys()].sort().map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {draft.ingredients.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/20 p-6 text-center">
          <p className="text-sm font-bold text-muted-foreground">עוד אין מתכון — מוסיפים מצרך ראשון</p>
        </div>
      )}

      {draft.ingredients.map((ingredient, index) => {
        const customUnitOpen =
          customUnitIds.has(ingredient.ingredientId) ||
          (ingredient.unit !== '' && !isPresetUnit(ingredient.unit))
        const wasteOpen =
          wasteOpenIds.has(ingredient.ingredientId) ||
          (ingredient.wastePercent ?? '').trim() !== ''
        const otherUnits = unitsUsedElsewhere(usage, ingredient)
        const unitMismatch =
          ingredient.unit.trim() !== '' &&
          otherUnits.length > 0 &&
          !otherUnits.includes(ingredient.unit.trim())
        const hints = [
          ...ingredientHints(ingredient),
          ...(unitMismatch
            ? [
                `המצרך הזה כבר רשום ב${otherUnits[0]} במתכונים אחרים — אותה יחידה תעזור לרשימת הקניות לחבר כמויות`,
              ]
            : []),
        ]
        return (
          <div
            key={ingredient.ingredientId}
            data-ingredient-id={ingredient.ingredientId}
            className="space-y-3 rounded-2xl border border-border bg-secondary/30 p-4"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(10rem,2fr)_minmax(6rem,1fr)]">
              <label className="text-xs font-black text-muted-foreground">
                מה המצרך?
                <input
                  aria-label={`שם מצרך ${index + 1}`}
                  list="recipes-known-ingredients"
                  value={ingredient.ingredientName}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    const knownUnit = mostCommonUnit(usage, value)
                    updateIngredient(
                      index,
                      knownUnit !== null && ingredient.unit.trim() === ''
                        ? { ingredientName: value, unit: knownUnit }
                        : { ingredientName: value },
                    )
                  }}
                  placeholder="למשל: חזה עוף"
                  className={`mt-2 ${inputClassName}`}
                />
              </label>
              <label className="text-xs font-black text-muted-foreground">
                כמה?
                <input
                  aria-label={`כמות מצרך ${index + 1}`}
                  inputMode="decimal"
                  value={ingredient.quantity}
                  onChange={(event) => updateIngredient(index, { quantity: event.currentTarget.value })}
                  placeholder="למשל 2 או 0.5"
                  className={`mt-2 ${inputClassName}`}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="text-xs font-black text-muted-foreground">
                באיזו יחידה?
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {UNIT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-label={`${preset} למצרך ${index + 1}`}
                      aria-pressed={!customUnitOpen && ingredient.unit === preset}
                      onClick={() => {
                        setCustomUnitIds((previous) => {
                          const next = new Set(previous)
                          next.delete(ingredient.ingredientId)
                          return next
                        })
                        updateIngredient(index, { unit: preset })
                      }}
                      className={chipClassName(!customUnitOpen && ingredient.unit === preset)}
                    >
                      {preset}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={`יחידה אחרת למצרך ${index + 1}`}
                    aria-pressed={customUnitOpen}
                    onClick={() =>
                      setCustomUnitIds((previous) => new Set(previous).add(ingredient.ingredientId))
                    }
                    className={chipClassName(customUnitOpen)}
                  >
                    אחר
                  </button>
                  {customUnitOpen && (
                    <input
                      aria-label={`יחידת מצרך ${index + 1}`}
                      value={ingredient.unit}
                      onChange={(event) => updateIngredient(index, { unit: event.currentTarget.value })}
                      placeholder="למשל: כפות"
                      className={`${inputClassName} w-32`}
                    />
                  )}
                </div>
              </div>

              <div className="ms-auto flex items-end gap-2">
                <button
                  type="button"
                  aria-label={`פחת למצרך ${index + 1}`}
                  aria-pressed={wasteOpen}
                  title="כמה אחוז נזרק בניקוי ובקילוף"
                  onClick={() => {
                    if (wasteOpen) {
                      setWasteOpenIds((previous) => {
                        const next = new Set(previous)
                        next.delete(ingredient.ingredientId)
                        return next
                      })
                      updateIngredient(index, { wastePercent: '' })
                    } else {
                      setWasteOpenIds((previous) => new Set(previous).add(ingredient.ingredientId))
                    }
                  }}
                  className={chipClassName(wasteOpen)}
                >
                  פחת?
                </button>
                {wasteOpen && (
                  <input
                    aria-label={`פחת מצרך ${index + 1}`}
                    inputMode="decimal"
                    value={ingredient.wastePercent ?? ''}
                    onChange={(event) => updateIngredient(index, { wastePercent: event.currentTarget.value })}
                    placeholder="אחוז שנזרק — למשל 10"
                    className={`${inputClassName} w-40`}
                  />
                )}
                <button
                  type="button"
                  aria-label={`מחיקת מצרך ${index + 1}`}
                  title="מחיקה"
                  onClick={() =>
                    onChange({
                      ...draft,
                      ingredients: draft.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index),
                    })
                  }
                  className="flex size-11 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-destructive"
                >
                  <LocalIcon name="ph:trash-bold" />
                </button>
              </div>
            </div>

            {hints.length > 0 && (
              <ul className="space-y-1">
                {hints.map((hint) => (
                  <li key={hint} className="flex items-center gap-2 text-xs font-bold text-amber-800">
                    <LocalIcon name="ph:info-bold" className="shrink-0" />
                    <span>{hint}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() =>
          onChange({
            ...draft,
            ingredients: [
              ...draft.ingredients,
              {
                ingredientId: nextStableIngredientId(draft.itemId, draft.ingredients),
                ingredientName: '',
                quantity: '',
                unit: '',
                wastePercent: '',
              },
            ],
          })
        }
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-5 text-sm font-black text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
      >
        <LocalIcon name="ph:plus-bold" />
        <span>הוספת מצרך</span>
      </button>
    </div>
  )
}

function YieldStepper({
  draft,
  onChange,
}: {
  readonly draft: RecipeDraft
  readonly onChange: (draft: RecipeDraft) => void
}) {
  const trimmed = draft.yield.trim()
  const currentYield = /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) : null
  const hint = yieldHint(draft.yield)
  const sentence = wholeProductSentence(draft.yield)
  return (
    <div>
      <div className="block text-xs font-black text-muted-foreground">
        <span>כמה מנות במוצר אחד?</span>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="פחות מנה"
            disabled={currentYield === null || currentYield <= 1}
            onClick={() => currentYield !== null && onChange({ ...draft, yield: String(currentYield - 1) })}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary disabled:opacity-40"
          >
            <LocalIcon name="ph:minus-bold" />
          </button>
          <input
            aria-label="כמה מנות במוצר אחד?"
            inputMode="numeric"
            value={draft.yield}
            onChange={(event) => onChange({ ...draft, yield: event.currentTarget.value })}
            className="min-h-11 w-20 rounded-xl border border-border bg-secondary/30 text-center text-lg font-black text-primary outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            aria-label="עוד מנה"
            onClick={() => onChange({ ...draft, yield: currentYield === null ? '1' : String(currentYield + 1) })}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary"
          >
            <LocalIcon name="ph:plus-bold" />
          </button>
        </div>
      </div>
      {sentence !== null && <p className="mt-2 text-xs font-bold text-muted-foreground">{sentence}</p>}
      {hint !== null && (
        <p className="mt-2 flex items-center gap-2 text-xs font-bold text-amber-800">
          <LocalIcon name="ph:info-bold" className="shrink-0" />
          <span>{hint}</span>
        </p>
      )}
    </div>
  )
}

interface DuplicateSource {
  readonly itemId: string
  readonly label: string
  readonly yield: string
  readonly ingredients: readonly DraftIngredient[]
}

function RecipeCosting({
  draft,
  productLibrary,
}: {
  readonly draft: RecipeDraft
  readonly productLibrary: ReadonlyMap<string, ProductLibraryEntry>
}) {
  const validated = validateRecipeDrafts([draft])
  if (!validated.valid || validated.recipes.length !== 1) {
    return (
      <p className="rounded-2xl border border-border bg-secondary/20 p-4 text-xs font-bold text-muted-foreground">
        עלות תופיע אחרי שהמתכון שלם — תפוקה ולפחות מצרך אחד תקין.
      </p>
    )
  }
  const cost = costRecipe(validated.recipes[0]!, productLibrary)
  return (
    <div className="rounded-2xl border border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-sm font-black text-primary">עלות למנה: {minorUnitsToMoney(cost.perYieldUnitMinorUnits)} AED</p>
        {cost.minorUnitsPer100g !== null && (
          <p className="text-sm font-black text-primary">ל-100 גרם: {minorUnitsToMoney(cost.minorUnitsPer100g)} AED</p>
        )}
      </div>
      {cost.minorUnitsPer100g !== null && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-muted-foreground">
          {Object.entries(saladSizeCosts(cost.minorUnitsPer100g)).map(([grams, minorUnits]) => (
            <span key={grams}>
              {grams} גרם: {minorUnitsToMoney(minorUnits)} AED
            </span>
          ))}
        </div>
      )}
      {!cost.complete && (
        <p className="mt-3 text-xs font-black text-amber-700">
          חסר מחיר ל-{cost.warnings.length} מצרכים — להשלים בהגדרות ← ספריית מוצרים ורכש.
        </p>
      )}
    </div>
  )
}

function RecipeEditor({
  draft,
  title,
  usage,
  duplicateSources,
  productLibrary,
  onChange,
  onClose,
}: {
  readonly draft: RecipeDraft
  readonly title: string
  readonly usage: IngredientUsage
  readonly duplicateSources: readonly DuplicateSource[]
  readonly productLibrary: ReadonlyMap<string, ProductLibraryEntry>
  readonly onChange: (draft: RecipeDraft) => void
  readonly onClose: () => void
}) {
  const batchHint = batchHintFromName(title)

  const duplicateFrom = (source: DuplicateSource) => {
    const ingredients: DraftIngredient[] = []
    for (const ingredient of source.ingredients) {
      ingredients.push({
        ingredientId: nextStableIngredientId(draft.itemId, ingredients),
        ingredientName: ingredient.ingredientName,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        ...(ingredient.wastePercent === undefined ? {} : { wastePercent: ingredient.wastePercent }),
      })
    }
    onChange({ ...draft, yield: source.yield, ingredients })
  }

  return (
    <section className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-secondary/30 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
            <LocalIcon name="ph:cooking-pot-bold" className="text-xl" />
          </span>
          <div>
            <h2 className="text-lg font-black text-primary">המתכון של {title}</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">מה שכותבים זה מה שנשמר — בלי המרות אוטומטיות.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-xl border border-border px-4 text-xs font-black text-primary">
          סגירה
        </button>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        <p className="flex items-start gap-3 rounded-2xl bg-secondary/40 p-4 text-sm font-bold text-primary">
          <LocalIcon name="ph:info-bold" className="mt-0.5 shrink-0 text-lg" />
          <span>{HEAVY_PRODUCTS_NOTE}</span>
        </p>

        <YieldStepper draft={draft} onChange={onChange} />

        {batchHint !== null && (
          <p className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            <LocalIcon name="ph:info-bold" className="mt-0.5 shrink-0 text-lg" />
            <span>{batchHint.note}</span>
          </p>
        )}

        {draft.ingredients.length === 0 && duplicateSources.length > 0 && (
          <label className="block text-xs font-black text-muted-foreground">
            אפשר להתחיל ממתכון דומה ולשנות רק מה שצריך:
            <select
              aria-label="שכפול מתכון מ..."
              value=""
              onChange={(event) => {
                const source = duplicateSources.find((candidate) => candidate.itemId === event.currentTarget.value)
                if (source !== undefined) duplicateFrom(source)
              }}
              className={`mt-2 ${inputClassName} max-w-md`}
            >
              <option value="">שכפול מתכון מ...</option>
              {duplicateSources.map((source) => (
                <option key={source.itemId} value={source.itemId}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h3 className="font-black text-primary">מה נכנס פנימה</h3>
            {draft.ingredients.length > 0 && (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">
                {draft.ingredients.length} מצרכים
              </span>
            )}
          </div>
          <IngredientRows draft={draft} usage={usage} onChange={onChange} />
        </div>

        <div>
          <h3 className="mb-3 font-black text-primary">עלות</h3>
          <RecipeCosting draft={draft} productLibrary={productLibrary} />
        </div>
      </div>
    </section>
  )
}

function matchesSearch(target: Pick<CatalogItem, 'id' | 'name'>, query: string): boolean {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('he-IL')
  if (normalized === '') return true
  return `${target.name} ${target.id}`.normalize('NFKC').toLocaleLowerCase('he-IL').includes(normalized)
}

type DishRow =
  | { readonly kind: 'configured'; readonly id: string; readonly name: string; readonly draft: RecipeDraft; readonly index: number }
  | { readonly kind: 'missing'; readonly id: string; readonly name: string }

export function RecipesScreen({
  onSave,
  autosaveDelayMs = 1500,
}: {
  readonly onSave?: StoreSaveHandler
  readonly autosaveDelayMs?: number
}) {
  const storeQuery = useStore()
  const initializationRef = useRef<RecipesInitialization | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const dirtyRef = useRef(false)
  const fireAutosaveRef = useRef<() => void>(() => {})
  const lastSavedRecipesJsonRef = useRef<string | null>(null)
  const lastSavedDraftsJsonRef = useRef<string | null>(null)
  const [drafts, setDrafts] = useState<readonly RecipeDraft[] | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>(IDLE)

  useEffect(() => {
    if (selectedIndex !== null) {
      editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedIndex])

  // Warn before leaving the page while edits have not been saved yet.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Debounced autosave: every draft change re-arms the timer; the actual save
  // decision (validity, staleness, no-op detection) happens inside save().
  useEffect(() => {
    if (drafts === null) return
    const timer = setTimeout(() => fireAutosaveRef.current(), autosaveDelayMs)
    return () => clearTimeout(timer)
  }, [drafts, autosaveDelayMs])

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    const baseStore = storeQuery.data.data
    const catalogResult = loadSettingsCatalog(baseStore)
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore,
      catalogResult,
      book: loadRecipeBook(baseStore, catalogResult.catalog),
    }
  }

  // After our own save lands, the query cache holds the confirmed envelope
  // (the routed onSave does not return it). Adopt it as the new base so the
  // next save — manual or automatic — starts fresh instead of failing stale.
  const queryEnvelope = storeQuery.data
  if (
    initializationRef.current !== null &&
    queryEnvelope != null &&
    isVersionedStateEnvelope(queryEnvelope) &&
    lastSavedRecipesJsonRef.current !== null &&
    (initializationRef.current.baseEnvelope === null ||
      !isSameVersionedStateEnvelope(queryEnvelope, initializationRef.current.baseEnvelope)) &&
    JSON.stringify((queryEnvelope.data as Record<string, unknown>).recipes ?? []) ===
      lastSavedRecipesJsonRef.current
  ) {
    const nextBaseStore = queryEnvelope.data
    const nextCatalogResult = loadSettingsCatalog(nextBaseStore)
    initializationRef.current = {
      baseEnvelope: queryEnvelope,
      baseStore: nextBaseStore,
      catalogResult: nextCatalogResult,
      book: loadRecipeBook(nextBaseStore, nextCatalogResult.catalog),
    }
  }

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את המתכונים" />
  if (storeQuery.isError || initializationRef.current === null) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את המתכונים"
        description="לא בוצע שינוי. אפשר לנסות שוב."
        retry={() => void storeQuery.refetch()}
      />
    )
  }

  const initialization = initializationRef.current
  const { baseEnvelope, baseStore, catalogResult, book } = initialization
  const currentDrafts = drafts ?? book.recipes.map(toDraft)
  const targets = recipeTargets(catalogResult.catalog, baseStore)
  const targetsById = new Map(targets.map((target) => [target.id, target.name]))
  const preparation = buildPreparationCatalog(catalogResult.catalog, baseStore)
  const categoryById = new Map<string, string>()
  for (const item of preparation.items) categoryById.set(item.id, item.category)
  for (const lunchItem of preparation.lunchItems) {
    if (lunchItem.itemId !== undefined) categoryById.set(lunchItem.itemId, 'lunch')
    for (const variant of lunchItem.variants ?? []) categoryById.set(variant.itemId, 'lunch')
    if (lunchItem.addon !== undefined) categoryById.set(lunchItem.addon.itemId, 'lunch')
  }
  const configuredByItemId = new Map(currentDrafts.map((draft, index) => [draft.itemId, index]))
  const missingCount = targets.filter((target) => !configuredByItemId.has(target.id)).length
  const doneCount = targets.length - missingCount
  const usage = buildIngredientUsage(currentDrafts)
  const productLibrary = new Map(loadProductLibrary(baseStore).entries.map((entry) => [entry.id, entry]))

  const currentDraftsJson = JSON.stringify(currentDrafts)
  const dirty =
    drafts !== null &&
    currentDraftsJson !== JSON.stringify(book.recipes.map(toDraft)) &&
    currentDraftsJson !== lastSavedDraftsJsonRef.current
  dirtyRef.current = dirty

  // One flat dish list (configured + missing together) in catalog order, then
  // grouped so size variants of the same dish sit next to each other.
  const rows: DishRow[] = []
  const seenDraftIndexes = new Set<number>()
  for (const target of targets) {
    const draftIndex = configuredByItemId.get(target.id)
    if (draftIndex === undefined) {
      rows.push({ kind: 'missing', id: target.id, name: target.name })
    } else {
      seenDraftIndexes.add(draftIndex)
      rows.push({
        kind: 'configured',
        id: target.id,
        name: target.name,
        draft: currentDrafts[draftIndex]!,
        index: draftIndex,
      })
    }
  }
  currentDrafts.forEach((draft, index) => {
    if (!seenDraftIndexes.has(index)) {
      rows.push({ kind: 'configured', id: draft.itemId, name: recipeName(draft, targetsById), draft, index })
    }
  })
  const visibleRows = rows.filter(
    (row) =>
      matchesSearch({ id: row.id, name: row.name }, search) &&
      (!onlyMissing || row.kind === 'missing'),
  )
  const groups: { readonly base: string; readonly rows: DishRow[] }[] = []
  const groupByBase = new Map<string, DishRow[]>()
  for (const row of visibleRows) {
    const base = baseDishName(row.name) || row.name
    const existing = groupByBase.get(base)
    if (existing === undefined) {
      const groupRows: DishRow[] = [row]
      groupByBase.set(base, groupRows)
      groups.push({ base, rows: groupRows })
    } else {
      existing.push(row)
    }
  }

  const selectedDraft = selectedIndex === null ? null : currentDrafts[selectedIndex] ?? null
  const selectedBase = selectedDraft === null ? null : baseDishName(recipeName(selectedDraft, targetsById))
  const duplicateSources: DuplicateSource[] =
    selectedDraft === null
      ? []
      : currentDrafts
          .map((draft) => ({
            itemId: draft.itemId,
            label: recipeName(draft, targetsById),
            yield: draft.yield,
            ingredients: draft.ingredients,
          }))
          .filter((source) => source.itemId !== selectedDraft.itemId && source.ingredients.length > 0)
          .sort((left, right) => {
            const leftSibling = baseDishName(left.label) === selectedBase ? 0 : 1
            const rightSibling = baseDishName(right.label) === selectedBase ? 0 : 1
            return leftSibling - rightSibling
          })

  const updateDraft = (index: number, value: RecipeDraft) => {
    setDrafts(currentDrafts.map((draft, draftIndex) => (draftIndex === index ? value : draft)))
    setSaveState(IDLE)
  }

  const createMissingRecipe = (target: Pick<CatalogItem, 'id' | 'name'>) => {
    const batchHint = batchHintFromName(target.name)
    const next = [
      ...currentDrafts,
      { ...createRecipeDraft(target), yield: batchHint?.suggestedYield ?? '1' },
    ]
    setDrafts(next)
    setSelectedIndex(next.length - 1)
    setSaveState(IDLE)
  }

  // Autosave-safe payload: every valid draft is saved as edited; an invalid
  // draft NEVER reaches the server — its previously stored version (if any)
  // is kept untouched, and a brand-new incomplete recipe is simply left out.
  const buildSaveableRecipes = (): { readonly recipes: readonly RecipeDefinition[]; readonly invalidCount: number } => {
    const storedById = new Map(book.recipes.map((recipe) => [recipe.itemId, recipe]))
    const recipes: RecipeDefinition[] = []
    let invalidCount = 0
    for (const draft of currentDrafts) {
      const result = validateRecipeDrafts([draft])
      if (result.valid && result.recipes.length === 1) {
        recipes.push(result.recipes[0]!)
      } else {
        invalidCount += 1
        const stored = storedById.get(draft.itemId)
        if (stored !== undefined) recipes.push(stored)
      }
    }
    return { recipes, invalidCount }
  }

  const save = async (auto: boolean) => {
    if (saveState.kind === 'saving') return
    if (!book.saveable) {
      setSaveState({ kind: 'error', message: 'אי אפשר לשמור כרגע — יש בעיה במתכונים השמורים. שום מתכון קיים לא הוחלף.' })
      return
    }
    const candidate = buildSaveableRecipes()
    const candidateIds = new Set(candidate.recipes.map((recipe) => recipe.itemId))
    if (candidateIds.size !== candidate.recipes.length) {
      setSaveState({ kind: 'error', message: 'עוד אי אפשר לשמור — יש שתי גרסאות לאותה מנה. משאירים אחת.' })
      return
    }
    const candidateJson = JSON.stringify(candidate.recipes)
    const alreadyStored =
      candidateJson === JSON.stringify(book.recipes) ||
      candidateJson === lastSavedRecipesJsonRef.current
    if (alreadyStored) {
      if (!auto) {
        if (candidate.invalidCount > 0) {
          const firstInvalid = currentDrafts.findIndex((draft) => !validateRecipeDrafts([draft]).valid)
          if (firstInvalid !== -1) setSelectedIndex(firstInvalid)
          setSaveState({
            kind: 'error',
            message: 'עוד אי אפשר לשמור — חסר משהו במתכון שנפתח למטה. מה שחסר מסומן בפנים.',
          })
        } else {
          setSaveState({ kind: 'saved', message: 'הכל כבר שמור.' })
        }
      }
      return
    }
    if (!onSave) {
      if (!auto) setSaveState({ kind: 'error', message: 'השמירה עדיין לא מחוברת למסך הזה. שום דבר לא השתנה בשרת.' })
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
        reason: 'recipes',
        baseEnvelope,
        baseStore,
        nextStore: applyRecipesToStore(baseStore, candidate.recipes, catalogResult.catalog),
      })) as VersionedStateEnvelope | undefined
      lastSavedRecipesJsonRef.current = candidateJson
      if (candidate.invalidCount === 0) lastSavedDraftsJsonRef.current = JSON.stringify(currentDrafts)
      if (result != null && isVersionedStateEnvelope(result)) {
        const nextBaseStore = result.data as LegacyStore
        const nextCatalogResult = loadSettingsCatalog(nextBaseStore)
        initialization.baseEnvelope = result
        initialization.baseStore = nextBaseStore
        initialization.catalogResult = nextCatalogResult
        initialization.book = loadRecipeBook(nextBaseStore, nextCatalogResult.catalog)
      }
      setSaveState({
        kind: 'saved',
        message:
          candidate.invalidCount > 0
            ? `${auto ? 'נשמר אוטומטית.' : 'המתכונים נשמרו.'} מתכון שעוד חסר בו משהו נשאר כטיוטה עם סימון.`
            : auto
              ? 'נשמר אוטומטית.'
              : 'המתכונים נשמרו.',
      })
    } catch {
      setSaveState({ kind: 'error', message: 'השמירה נכשלה. הטיוטה נשארה כאן ואפשר לנסות שוב.' })
    }
  }
  fireAutosaveRef.current = () => {
    if (onSave && dirtyRef.current) void save(true)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-primary sm:text-4xl">מתכונים ומצרכים</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">לכל מוצר רושמים מה נכנס בו — ומזה נבנית רשימת הקניות.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <span className="sr-only">חיפוש מנה</span>
            <input
              aria-label="חיפוש מנה"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="חיפוש מנה..."
              className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button
            type="button"
            aria-pressed={onlyMissing}
            onClick={() => setOnlyMissing((previous) => !previous)}
            className={chipClassName(onlyMissing)}
          >
            <LocalIcon name="ph:funnel-bold" className="me-2" />
            <span>רק בלי מתכון</span>
          </button>
          <button
            type="button"
            disabled={saveState.kind === 'saving'}
            onClick={() => void save(false)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-black text-primary-foreground disabled:opacity-50"
          >
            <LocalIcon name="ph:check-circle-bold" />
            <span>שמירת כל המתכונים</span>
          </button>
        </div>
      </header>
      <div className="mt-3"><Status state={saveState} /></div>

      {book.issues.length > 0 && (
        <section className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-5" role="alert">
          <div className="flex items-start gap-3">
            <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-xl text-destructive" />
            <div>
              <h2 className="font-black text-primary">יש בעיה במתכונים השמורים</h2>
              <p className="mt-1 text-sm font-bold text-rose-900">השמירה חסומה כדי שאף מתכון קיים לא ילך לאיבוד. הפרטים הטכניים:</p>
              <ul className="mt-2 list-inside list-disc text-xs font-bold text-rose-900" dir="ltr">
                {book.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-3xl border border-border bg-card p-5" role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-black text-primary">יש מתכון ל־{doneCount} מתוך {targets.length} מנות</p>
          {missingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
              {missingCount} עוד בלי מתכון
            </span>
          )}
        </div>
        {missingCount > 0 && (
          <p className="mt-1 text-xs font-bold text-muted-foreground">מנה בלי מתכון לא נכנסת לרשימת הקניות — הכמויות לא יומצאו.</p>
        )}
      </section>

      {selectedDraft !== null && selectedIndex !== null && (
        <div ref={editorRef} className="mt-8 scroll-mt-6">
          <RecipeEditor
            key={selectedDraft.itemId}
            draft={selectedDraft}
            title={recipeName(selectedDraft, targetsById)}
            usage={usage}
            duplicateSources={duplicateSources}
            productLibrary={productLibrary}
            onChange={(value) => updateDraft(selectedIndex, value)}
            onClose={() => setSelectedIndex(null)}
          />
        </div>
      )}

      <section className="mt-8 overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5 sm:px-8">
          <h2 className="text-xl font-black text-primary">המנות</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{doneCount} עם מתכון · {missingCount} עוד בלי</p>
        </div>
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.base} className={group.rows.length > 1 ? 'bg-secondary/10' : undefined}>
              {group.rows.length > 1 && (
                <p className="px-6 pt-4 text-xs font-black text-muted-foreground sm:px-8">כמה גדלים של {group.base}:</p>
              )}
              {group.rows.map((row) => {
                const categoryLabel = CATEGORY_LABELS[categoryById.get(row.id) ?? '']
                const sizeLabel = batchHintFromName(row.name)?.sizeLabel
                const metaChips = (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    {categoryLabel !== undefined && (
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[0.625rem] font-black text-muted-foreground">{categoryLabel}</span>
                    )}
                    {sizeLabel !== undefined && (
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[0.625rem] font-black text-muted-foreground">{sizeLabel}</span>
                    )}
                  </span>
                )
                if (row.kind === 'missing') {
                  return (
                    <div key={row.id} className="flex flex-col gap-4 bg-amber-50/30 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                          <LocalIcon name="ph:cooking-pot-bold" className="text-xl" />
                        </span>
                        <div>
                          <h3 className="text-sm font-black text-primary">{row.name}</h3>
                          <p className="mt-1 text-xs font-black text-amber-800">עוד אין מתכון</p>
                          {metaChips}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`יצירת מתכון — ${row.name}`}
                        onClick={() => createMissingRecipe({ id: row.id, name: row.name })}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-black text-primary-foreground"
                      >
                        <LocalIcon name="ph:plus-bold" />
                        <span>יצירת מתכון</span>
                      </button>
                    </div>
                  )
                }
                const editing = selectedIndex === row.index
                return (
                  <div
                    key={`${row.id}-${row.index}`}
                    onClick={() => setSelectedIndex(row.index)}
                    className={`flex cursor-pointer flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 ${editing ? 'bg-secondary/40' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                        <LocalIcon name="ph:check-circle-bold" className="text-xl" />
                      </span>
                      <div>
                        <h3 className="text-sm font-black text-primary">{row.name}</h3>
                        <p className="mt-1 text-xs font-bold text-muted-foreground">
                          {row.draft.ingredients.length} מצרכים
                          {/^[1-9]\d*$/.test(row.draft.yield.trim())
                            ? row.draft.yield.trim() === '1'
                              ? ' · מוצר של מנה אחת'
                              : ` · מוצר של ${row.draft.yield.trim()} מנות`
                            : ''}
                        </p>
                        {metaChips}
                      </div>
                      {editing && (
                        <span className="rounded-full bg-primary px-3 py-1 text-xs font-black text-primary-foreground">בעריכה עכשיו</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedIndex(row.index)
                      }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 text-xs font-black text-primary"
                    >
                      <LocalIcon name="ph:pencil-simple-bold" />
                      <span>עריכת מתכון</span>
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
          {visibleRows.length === 0 && (
            <div className="px-6 py-12 text-center text-sm font-bold text-muted-foreground">
              {onlyMissing && missingCount === 0
                ? 'לכל המנות כבר יש מתכון.'
                : 'לא נמצאה מנה בשם הזה.'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default RecipesScreen
