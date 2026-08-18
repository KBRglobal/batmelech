import {
  compareSuppliers,
  type ProductLibraryEntry,
  type SupplierComparison,
} from './product-library.ts'
import type { ShoppingListItem, ShoppingListResult } from './shopping-list.ts'

/**
 * Bolts supplier/pack pricing onto a built shopping list, without touching
 * buildShoppingList itself: an insignificant-flagged product drops off the list entirely,
 * everything else gets its Nesto/Rimon pack comparison attached (or null when the
 * ingredient has no product library entry yet).
 */

export interface ProcurementShoppingListItem extends ShoppingListItem {
  readonly procurement: SupplierComparison | null
}

export interface ProcurementShoppingListResult {
  readonly complete: boolean
  readonly items: readonly ProcurementShoppingListItem[]
  readonly warnings: ShoppingListResult['warnings']
  readonly excludedInsignificant: readonly Pick<ShoppingListItem, 'ingredientId' | 'ingredientName'>[]
}

export function attachProcurement(
  shoppingList: Readonly<ShoppingListResult>,
  productLibrary: ReadonlyMap<string, ProductLibraryEntry>,
): ProcurementShoppingListResult {
  const excludedInsignificant: Pick<ShoppingListItem, 'ingredientId' | 'ingredientName'>[] = []
  const items: ProcurementShoppingListItem[] = []

  for (const item of shoppingList.items) {
    const product = productLibrary.get(item.ingredientId)
    if (product?.insignificant === true) {
      excludedInsignificant.push({ ingredientId: item.ingredientId, ingredientName: item.ingredientName })
      continue
    }
    items.push({
      ...item,
      procurement: product === undefined ? null : compareSuppliers(product, item.quantity, item.unit),
    })
  }

  return { complete: shoppingList.complete, items, warnings: shoppingList.warnings, excludedInsignificant }
}
