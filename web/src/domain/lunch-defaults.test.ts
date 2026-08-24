import { describe, expect, it } from 'vitest'

import { buildOrderEditorMenu } from './order-editor'
import { DEFAULT_SETTINGS_CATALOG } from './settings-catalog'
import type { LegacyStore } from './store.ts'

// The weekday lunch menu is declared twice in this app: order-editor.ts owns
// the copy that PRICES an order, settings-catalog.ts the copy the menu editor
// shows and saves. They are separate objects with slightly different field
// names, so nothing but this test stops one from drifting away from the
// other — and a drifted `includedSides` is not a cosmetic bug, it bills a
// customer for a side the menu says the plate already includes.
describe('the two weekday lunch declarations', () => {
  const pricing = buildOrderEditorMenu({ orders: [] } satisfies LegacyStore).lunch
  const catalog = DEFAULT_SETTINGS_CATALOG.lunch

  it('describe the same items in the same order', () => {
    expect(pricing.map((item) => item.key)).toEqual(catalog.map((item) => item.key))
    expect(pricing.map((item) => item.name)).toEqual(catalog.map((item) => item.name))
    expect(pricing.map((item) => item.priceMinorUnits)).toEqual(
      catalog.map((item) => item.priceMinorUnits),
    )
  })

  it('agree on every variant price, weekend rule, and included side allowance', () => {
    for (const [index, item] of pricing.entries()) {
      const twin = catalog[index]!
      expect(item.variants.map((variant) => variant.key)).toEqual(
        twin.variants.map((variant) => variant.key),
      )
      for (const [variantIndex, variant] of item.variants.entries()) {
        const variantTwin = twin.variants[variantIndex]!
        expect({
          key: variant.key,
          label: variant.label,
          priceMinorUnits: variant.priceMinorUnits,
          weekendOnly: variant.weekendOnly === true,
          includedSides: variant.includedSides,
          // The catalog stores "this variant takes no paid sides" as null,
          // the pricing copy as 0 — same rule, two spellings.
          sidePriceMinorUnits: variant.sidePriceMinorUnits,
        }).toEqual({
          key: variantTwin.key,
          label: variantTwin.name,
          priceMinorUnits: variantTwin.priceMinorUnits,
          weekendOnly: variantTwin.weekendOnly,
          includedSides: variantTwin.includedSides,
          sidePriceMinorUnits: variantTwin.extraSideMinorUnits ?? 0,
        })
      }
      expect(item.addon?.priceMinorUnits ?? null).toEqual(twin.addon?.priceMinorUnits ?? null)
      expect(item.addon?.name ?? null).toEqual(twin.addon?.name ?? null)
    }
  })

  it('give the schnitzel plate the side choice its price covers', () => {
    // docs/menu-source-of-truth-2026-08-14.md: "Plate requires a side choice
    // ... Family size includes 2 side choices; extra sides available for
    // additional payment."
    const plate = pricing.find((item) => item.key === 'schnitzel-plate')!
    expect(
      Object.fromEntries(plate.variants.map((variant) => [variant.key, variant.includedSides])),
    ).toEqual({ single: 1, couple: 1, family: 2 })
  })
})
