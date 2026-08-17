import { useRef, useState } from 'react'
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
import type { RecipeDefinition } from '../domain/recipes.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type SaveState =
  | { readonly kind: 'idle'; readonly message: '' }
  | { readonly kind: 'saving'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const IDLE: SaveState = { kind: 'idle', message: '' }

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

function IngredientRows({
  draft,
  onChange,
}: {
  readonly draft: RecipeDraft
  readonly onChange: (draft: RecipeDraft) => void
}) {
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

  return (
    <div className="space-y-3">
      {draft.ingredients.map((ingredient, index) => (
        <div
          key={ingredient.ingredientId}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-secondary/30 p-4 md:grid-cols-[minmax(10rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_auto]"
        >
          <label className="text-xs font-black text-muted-foreground">
            מצרך
            <input
              aria-label={`שם מצרך ${index + 1}`}
              value={ingredient.ingredientName}
              onChange={(event) => updateIngredient(index, 'ingredientName', event.currentTarget.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="text-xs font-black text-muted-foreground">
            כמות
            <input
              aria-label={`כמות מצרך ${index + 1}`}
              inputMode="decimal"
              value={ingredient.quantity}
              onChange={(event) => updateIngredient(index, 'quantity', event.currentTarget.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="text-xs font-black text-muted-foreground">
            יחידה
            <input
              aria-label={`יחידת מצרך ${index + 1}`}
              value={ingredient.unit}
              onChange={(event) => updateIngredient(index, 'unit', event.currentTarget.value)}
              placeholder="גרם / ק״ג / יחידה"
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="text-xs font-black text-muted-foreground">
            פחת באחוזים
            <input
              aria-label={`פחת מצרך ${index + 1}`}
              inputMode="decimal"
              value={ingredient.wastePercent ?? ''}
              onChange={(event) => updateIngredient(index, 'wastePercent', event.currentTarget.value)}
              placeholder="אופציונלי"
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
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
            className="mt-0 flex size-11 items-center justify-center self-end rounded-xl border border-rose-100 bg-rose-50 text-destructive"
          >
            <LocalIcon name="ph:warning-circle-bold" />
          </button>
          <p className="text-[0.625rem] font-bold text-muted-foreground md:col-span-5" dir="ltr">
            ID: {ingredient.ingredientId}
          </p>
        </div>
      ))}

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
  const validation = validateRecipeDrafts([draft])
  return (
    <section className="overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-primary">
            <LocalIcon name="ph:cooking-pot-bold" className="text-xl" />
          </span>
          <div>
            <h2 className="text-lg font-black text-primary">עריכת מתכון: {title}</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">הכמויות נשמרות ביחידה שכתבת — אין המרה אוטומטית.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-border px-4 text-xs font-black text-primary">סגירה</button>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        <label className="block max-w-xs text-xs font-black text-muted-foreground">
          תפוקת המתכון במנות
          <input
            aria-label="תפוקת המתכון במנות"
            inputMode="numeric"
            value={draft.yield}
            onChange={(event) => onChange({ ...draft, yield: event.currentTarget.value })}
            placeholder="מספר שלם וחיובי"
            className="mt-2 min-h-11 w-full rounded-xl border border-border bg-secondary/30 px-4 text-sm font-black text-primary outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-black text-primary">מצרכים נדרשים</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">כמות, יחידה ופחת נבדקים בדיוק כפי שהוקלדו.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">{draft.ingredients.length} מצרכים</span>
          </div>
          <IngredientRows draft={draft} onChange={onChange} />
        </div>

        {!validation.valid && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4" role="alert">
            <p className="text-sm font-black text-destructive">המתכון עדיין לא מוכן לשמירה.</p>
            <p className="mt-1 text-xs font-bold text-rose-900">צריך תפוקה חיובית ולפחות מצרך אחד עם שם, כמות חיובית ויחידה. הפחת יכול להיות בין 0 ל־100.</p>
          </div>
        )}
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
  const [drafts, setDrafts] = useState<readonly RecipeDraft[] | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [saveState, setSaveState] = useState<SaveState>(IDLE)

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
  const filteredConfigured = currentDrafts
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
    const next = [...currentDrafts, createRecipeDraft(target)]
    setDrafts(next)
    setSelectedIndex(next.length - 1)
    setSaveState(IDLE)
  }

  const save = async () => {
    if (!book.saveable) {
      setSaveState({ kind: 'error', message: 'יש התנגשות בנתוני המתכונים השמורים. שום רשומה קיימת לא הוחלפה.' })
      return
    }
    if (!validation.valid) {
      setSaveState({ kind: 'error', message: 'יש מתכון לא תקין. צריך לתקן אותו לפני שמירה.' })
      return
    }
    if (!onSave) {
      setSaveState({ kind: 'error', message: 'השמירה המוגנת עדיין אינה מחוברת. לא בוצע שינוי בשרת.' })
      return
    }
    if (baseEnvelope === null || !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      setSaveState({
        kind: 'error',
        message: 'הנתונים התעדכנו מאז פתיחת הטיוטה. לא בוצעה שמירה; צריך לפתוח מחדש את המסך.',
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
      setSaveState({ kind: 'error', message: 'השמירה נכשלה. הטיוטה נשארה כאן והנתונים הקיימים לא סומנו כנשמרו.' })
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-primary sm:text-4xl">מתכונים ומצרכים</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">הגדרת מצרכים, תפוקה ופחת לכל מנה עם מזהה יציב.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <span className="sr-only">חיפוש מתכונים</span>
            <input
              aria-label="חיפוש מתכונים"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="חיפוש מנה..."
              className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button type="button" disabled={saveState.kind === 'saving'} onClick={() => void save()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-black text-primary-foreground disabled:opacity-50">
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
              <h2 className="font-black text-primary">המתכונים השמורים כוללים התנגשות או מבנה לא תקין</h2>
              <p className="mt-1 text-sm font-bold text-rose-900">השמירה חסומה כדי שאף רשומה קיימת לא תלך לאיבוד.</p>
              <ul className="mt-2 list-inside list-disc text-xs font-bold text-rose-900">
                {book.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}
              </ul>
            </div>
          </div>
        </section>
      )}

      {missingTargets.length > 0 && (
        <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5" role="alert">
          <h2 className="font-black text-primary">חסרים מתכונים ל־{missingTargets.length} מנות</h2>
          <p className="mt-1 text-sm font-bold text-amber-900">רשימת הקניות לא תמציא כמויות למנה שאין לה מתכון תקין.</p>
        </section>
      )}

      {selectedDraft !== null && selectedIndex !== null && (
        <div className="mt-8">
          <RecipeEditor
            draft={selectedDraft}
            title={recipeName(selectedDraft, targetsById)}
            onChange={(value) => updateDraft(selectedIndex, value)}
            onClose={() => setSelectedIndex(null)}
          />
        </div>
      )}

      <section className="mt-8 overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5 sm:px-8">
          <h2 className="text-xl font-black text-primary">מנות ומתכונים</h2>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{currentDrafts.length} מתכונים מוגדרים · {missingTargets.length} חסרים</p>
        </div>
        <div className="divide-y divide-border">
          {filteredConfigured.map(({ draft, index, target }) => (
            <div key={`${draft.itemId}-${index}`} className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <div className="flex items-center gap-4">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary"><LocalIcon name="ph:cooking-pot-bold" className="text-xl" /></span>
                <div>
                  <h3 className="text-sm font-black text-primary">{target.name}</h3>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{draft.ingredients.length} מצרכים · תפוקה {draft.yield || 'לא הוגדרה'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedIndex(index)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 text-xs font-black text-primary">
                <LocalIcon name="ph:pencil-simple-bold" />
                <span>עריכת מתכון</span>
              </button>
            </div>
          ))}
          {filteredMissing.map((target) => (
            <div key={target.id} className="flex flex-col gap-4 bg-amber-50/30 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <div className="flex items-center gap-4">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><LocalIcon name="ph:warning-circle-bold" className="text-xl" /></span>
                <div>
                  <h3 className="text-sm font-black text-primary">{target.name}</h3>
                  <p className="mt-1 text-xs font-black text-amber-800">חסר מתכון</p>
                </div>
              </div>
              <button type="button" onClick={() => createMissingRecipe(target)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-black text-primary-foreground">
                <LocalIcon name="ph:plus-bold" />
                <span>יצירת מתכון</span>
              </button>
            </div>
          ))}
          {filteredConfigured.length === 0 && filteredMissing.length === 0 && (
            <div className="px-6 py-12 text-center text-sm font-bold text-muted-foreground">לא נמצאה מנה שמתאימה לחיפוש.</div>
          )}
        </div>
      </section>
    </div>
  )
}

export default RecipesScreen
