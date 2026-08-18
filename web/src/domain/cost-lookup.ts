import { loadProductLibrary, productLibraryMap } from './product-library.ts'
import { costRecipe } from './recipe-costing.ts'
import { loadRecipeBook, loadSettingsCatalog, recipeTargets } from './settings-catalog.ts'
import type { LegacyStore } from './store.ts'

/**
 * Panel-only dish costs (Lin's eyes, never the customer's): one cheap index
 * built from the stored recipes and the product library, addressable by the
 * catalog item id AND by the dish name (holiday menus reference dishes by
 * name only). Missing recipe → simply absent from the index.
 */

export interface DishCost {
  readonly perPortionMinorUnits: number
  readonly per100gMinorUnits: number | null
  readonly complete: boolean
}

export interface DishCostIndex {
  readonly byItemId: ReadonlyMap<string, DishCost>
  readonly byName: ReadonlyMap<string, DishCost>
}

export function buildDishCostIndex(store: Readonly<LegacyStore>): DishCostIndex {
  const catalog = loadSettingsCatalog(store).catalog
  const book = loadRecipeBook(store, catalog)
  const productLibrary = productLibraryMap(loadProductLibrary(store).entries)
  const namesById = new Map(recipeTargets(catalog, store).map((target) => [target.id, target.name]))

  const byItemId = new Map<string, DishCost>()
  const byName = new Map<string, DishCost>()
  for (const recipe of book.recipes) {
    const cost = costRecipe(recipe, productLibrary)
    const dishCost: DishCost = {
      perPortionMinorUnits: cost.perYieldUnitMinorUnits,
      per100gMinorUnits: cost.minorUnitsPer100g,
      complete: cost.complete,
    }
    byItemId.set(recipe.itemId, dishCost)
    const name = (namesById.get(recipe.itemId) ?? recipe.name ?? '').trim()
    if (name !== '' && !byName.has(name)) byName.set(name, dishCost)
  }
  return { byItemId, byName }
}
