import { useEffect, useRef, useState } from 'react'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import {
  applyRecipesToStore,
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

interface RecipesInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
  readonly catalogResult: CatalogResult
  readonly book: RecipeBook
}

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

// Batch-sold dishes ("ל־4 אנשים", "זוגי", "מגש", "סיר"): the recipe always
// describes the WHOLE batch, so we pre-suggest the matching yield and spell it
// out in words. Quantities are never divided or multiplied — only the wording
// makes the batch explicit.
interface BatchHint {
  readonly suggestedYield: string
  readonly note: string
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
      }
    }
  }
  if (normalized.includes('זוגי')) {
    return {
      suggestedYield: '2',
      note: 'המנה הזאת נמכרת כזוג — הכמויות צריכות לכסות את שתי המנות.',
    }
  }
  if (/(?:^|[\s(])מגש/.test(normalized)) {
    return { suggestedYield: '1', note: 'רושמים את הכמויות למגש כולו — כל מה שנכנס בו.' }
  }
  if (/(?:^|[\s(])סיר/.test(normalized)) {
    return { suggestedYield: '1', note: 'רושמים את הכמויות לסיר כולו — כל מה שנכנס בו.' }
  }
  return null
}

// Friendly wording over the exact same constraints the save path enforces
// (RecipeDraftSchema + RecipeDefinitionSchema). The schemas stay the only
// gate; these hints only translate them to human Hebrew.
function yieldHint(value: string): string | null {
  return /^[1-9]\d*$/.test(value.trim()) ? null : 'צריך מספר שלם של מנות — למשל 4'
}

function wholeRecipeSentence(yieldValue: string): string | null {
  const trimmed = yieldValue.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  return trimmed === '1'
    ? 'המצרכים שלמטה הם לכל המתכון — מנה אחת.'
    : `המצרכים שלמטה הם לכל המתכון — ${trimmed} מנות ביחד.`
}

function ingredientHints(ingredient: RecipeDraft['ingredients'][number]): readonly string[] {
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
  onChange,
}: {
  readonly draft: RecipeDraft
  readonly onChange: (draft: RecipeDraft) => void
}) {
  const [customUnitIds, setCustomUnitIds] = useState<ReadonlySet<string>>(new Set())
  const [wasteOpenIds, setWasteOpenIds] = useState<ReadonlySet<string>>(new Set())

  const updateIngredient = (
    index: number,
    field: 'ingredientName' | 'quantity' | 'unit' | 'wastePercent',
    value: string,
  ) => {
    onChange({
      ...draft,
      ingredients: draft.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? { ...ingredient, [field]: value } : ingredient,
      ),
    })
  }

  const isPresetUnit = (unit: string): boolean =>
    (UNIT_PRESETS as readonly string[]).includes(unit)

  return (
    <div className="space-y-3">
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
        const hints = ingredientHints(ingredient)
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
                  value={ingredient.ingredientName}
                  onChange={(event) => updateIngredient(index, 'ingredientName', event.currentTarget.value)}
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
                  onChange={(event) => updateIngredient(index, 'quantity', event.currentTarget.value)}
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
                        updateIngredient(index, 'unit', preset)
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
                      onChange={(event) => updateIngredient(index, 'unit', event.currentTarget.value)}
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
                      updateIngredient(index, 'wastePercent', '')
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
                    onChange={(event) => updateIngredient(index, 'wastePercent', event.currentTarget.value)}
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
  const sentence = wholeRecipeSentence(draft.yield)
  return (
    <div>
      <label className="block text-xs font-black text-muted-foreground">
        לכמה מנות המתכון הזה?
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
            aria-label="לכמה מנות המתכון הזה?"
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
      </label>
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

function RecipeEditor({
  draft,
  title,
  onChange,
  onClose,
}: {
  readonly draft: RecipeDraft
  readonly title: string
  readonly onChange: (draft: RecipeDraft) => void
  readonly onClose: () => void
}) {
  const batchHint = batchHintFromName(title)
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

        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h3 className="font-black text-primary">מה נכנס פנימה</h3>
            {draft.ingredients.length > 0 && (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">
                {draft.ingredients.length} מצרכים
              </span>
            )}
          </div>
          <IngredientRows draft={draft} onChange={onChange} />
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

export function RecipesScreen({ onSave }: { readonly onSave?: StoreSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<RecipesInitialization | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
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

  const { baseEnvelope, baseStore, catalogResult, book } = initializationRef.current
  const currentDrafts = drafts ?? book.recipes.map(toDraft)
  const targets = recipeTargets(catalogResult.catalog, baseStore)
  const targetsById = new Map(targets.map((target) => [target.id, target.name]))
  const configuredIds = new Set(currentDrafts.map((draft) => draft.itemId))
  const missingTargets = targets.filter((target) => !configuredIds.has(target.id))
  const doneCount = targets.length - missingTargets.length
  const filteredConfigured = onlyMissing
    ? []
    : currentDrafts
        .map((draft, index) => ({ draft, index, target: { id: draft.itemId, name: recipeName(draft, targetsById) } }))
        .filter(({ target }) => matchesSearch(target, search))
  const filteredMissing = missingTargets.filter((target) => matchesSearch(target, search))
  const validation = validateRecipeDrafts(currentDrafts)
  const selectedDraft = selectedIndex === null ? null : currentDrafts[selectedIndex] ?? null

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

  const save = async () => {
    if (!book.saveable) {
      setSaveState({ kind: 'error', message: 'אי אפשר לשמור כרגע — יש בעיה במתכונים השמורים. שום מתכון קיים לא הוחלף.' })
      return
    }
    if (!validation.valid) {
      const firstInvalid = currentDrafts.findIndex((draft) => !validateRecipeDrafts([draft]).valid)
      if (firstInvalid !== -1) setSelectedIndex(firstInvalid)
      setSaveState({
        kind: 'error',
        message:
          firstInvalid === -1
            ? 'עוד אי אפשר לשמור — יש שתי גרסאות לאותה מנה. משאירים אחת.'
            : 'עוד אי אפשר לשמור — חסר משהו במתכון שנפתח למטה. מה שחסר מסומן בפנים.',
      })
      return
    }
    if (!onSave) {
      setSaveState({ kind: 'error', message: 'השמירה עדיין לא מחוברת למסך הזה. שום דבר לא השתנה בשרת.' })
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
      await onSave({
        reason: 'recipes',
        baseEnvelope,
        baseStore,
        nextStore: applyRecipesToStore(baseStore, validation.recipes, catalogResult.catalog),
      })
      setSaveState({ kind: 'saved', message: 'המתכונים נשמרו.' })
    } catch {
      setSaveState({ kind: 'error', message: 'השמירה נכשלה. הטיוטה נשארה כאן ואפשר לנסות שוב.' })
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-primary sm:text-4xl">מתכונים ומצרכים</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">לכל מנה רושמים מה נכנס בה — ומזה נבנית רשימת הקניות.</p>
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
            onClick={() => void save()}
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
          {missingTargets.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
              {missingTargets.length} עוד בלי מתכון
            </span>
          )}
        </div>
        {missingTargets.length > 0 && (
          <p className="mt-1 text-xs font-bold text-muted-foreground">מנה בלי מתכון לא נכנסת לרשימת הקניות — הכמויות לא יומצאו.</p>
        )}
      </section>

      {selectedDraft !== null && selectedIndex !== null && (
        <div ref={editorRef} className="mt-8 scroll-mt-6">
          <RecipeEditor
            key={selectedDraft.itemId}
            draft={selectedDraft}
            title={recipeName(selectedDraft, targetsById)}
            onChange={(value) => updateDraft(selectedIndex, value)}
            onClose={() => setSelectedIndex(null)}
          />
        </div>
      )}

      <section className="mt-8 overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5 sm:px-8">
          <h2 className="text-xl font-black text-primary">המנות</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{doneCount} עם מתכון · {missingTargets.length} עוד בלי</p>
        </div>
        <div className="divide-y divide-border">
          {filteredConfigured.map(({ draft, index, target }) => {
            const editing = selectedIndex === index
            return (
              <div
                key={`${draft.itemId}-${index}`}
                className={`flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 ${editing ? 'bg-secondary/40' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                    <LocalIcon name="ph:check-circle-bold" className="text-xl" />
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-primary">{target.name}</h3>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      {draft.ingredients.length} מצרכים
                      {/^[1-9]\d*$/.test(draft.yield.trim()) ? ` · ל־${draft.yield.trim()} מנות` : ''}
                    </p>
                  </div>
                  {editing && (
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-black text-primary-foreground">בעריכה עכשיו</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 text-xs font-black text-primary"
                >
                  <LocalIcon name="ph:pencil-simple-bold" />
                  <span>עריכת מתכון</span>
                </button>
              </div>
            )
          })}
          {filteredMissing.map((target) => (
            <div key={target.id} className="flex flex-col gap-4 bg-amber-50/30 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <div className="flex items-center gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                  <LocalIcon name="ph:cooking-pot-bold" className="text-xl" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-primary">{target.name}</h3>
                  <p className="mt-1 text-xs font-black text-amber-800">עוד אין מתכון</p>
                </div>
              </div>
              <button
                type="button"
                aria-label={`יצירת מתכון — ${target.name}`}
                onClick={() => createMissingRecipe(target)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-black text-primary-foreground"
              >
                <LocalIcon name="ph:plus-bold" />
                <span>יצירת מתכון</span>
              </button>
            </div>
          ))}
          {filteredConfigured.length === 0 && filteredMissing.length === 0 && (
            <div className="px-6 py-12 text-center text-sm font-bold text-muted-foreground">
              {onlyMissing && missingTargets.length === 0
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
