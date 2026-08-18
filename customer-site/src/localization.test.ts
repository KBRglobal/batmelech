import { describe, expect, it } from 'vitest'

// בדיקת סף — the localization threshold check (Moshe, 2026-08-18): the
// English and French sites must read like they were written BY the
// community FOR the community, never like a translation. A Jewish site says
// Shabbat, not Saturday; Chabbat, not samedi. This test walks every page's
// exported COPY object and fails the build on translationese.

import { COPY as home } from './pages/home'
import { COPY as weekdays } from './pages/weekdays'
import { COPY as story } from './pages/story'
import { COPY as shabbatOrder } from './pages/shabbat-order'
import { COPY as shabbatExtras } from './pages/shabbat-extras'
import { COPY as checkout } from './pages/checkout'
import { COPY as legal } from './pages/legal'
import { COPY as kashrut } from './pages/kashrut-quality'
import { COPY as gallery } from './pages/gallery'
import { COPY as events } from './pages/events'
import { COPY as bbq } from './pages/experience-bbq'
import { COPY as yacht } from './pages/experience-yacht'
import { COPY as villa } from './pages/experience-villa'
import { COPY as suite } from './pages/experience-suite'
import { COPY as desert } from './pages/experience-desert'
import { COPY as howItWorks } from './pages/how-it-works'
import { COPY as notFound } from './pages/not-found'
import { DISH_NAMES } from './dish-names'

type LocaleCopy = Record<'he' | 'en' | 'fr', unknown>

const PAGES: Record<string, LocaleCopy> = {
  home, weekdays, story, shabbatOrder, shabbatExtras, checkout, legal,
  kashrut, gallery, events, bbq, yacht, villa, suite, desert, notFound, howItWorks,
}

function textOf(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

// Words that expose a TRANSLATION instead of a native Jewish-audience
// localization. "Saturday night" is allowed in English (that is how
// American Jews refer to Motzei Shabbat casually), plain "Saturday"/"Sabbath"
// for the day of rest is not.
const FORBIDDEN: Record<'en' | 'fr', readonly RegExp[]> = {
  en: [
    /\bSabbath\b/u,
    /\bSaturday(?!\s+night)\b/u,
    /\bJewish Sabbath\b/u,
  ],
  fr: [
    /\bsamedi\b/iu,
    /\bsabbat\b/iu,
    /\bkascher\b/iu,
  ],
}

// A native page for this audience is expected to actually use the
// community's own words somewhere on the Shabbat-related pages.
const REQUIRED_ON_SHABBAT_PAGES: Record<'en' | 'fr', RegExp> = {
  en: /Shabbat/u,
  fr: /Chabbat/u,
}

const SHABBAT_PAGES = ['home', 'shabbatOrder', 'shabbatExtras'] as const

describe('localization threshold — native copy, not translation', () => {
  it('every page ships all three locales', () => {
    for (const [name, copy] of Object.entries(PAGES)) {
      for (const locale of ['he', 'en', 'fr'] as const) {
        expect(copy[locale], `${name} is missing ${locale}`).toBeTruthy()
      }
    }
  })

  it('no translationese anywhere (Shabbat not Saturday; Chabbat not samedi)', () => {
    for (const [name, copy] of Object.entries(PAGES)) {
      for (const locale of ['en', 'fr'] as const) {
        const text = textOf(copy[locale])
        for (const pattern of FORBIDDEN[locale]) {
          expect(text, `${name}.${locale} matches forbidden ${pattern}`).not.toMatch(pattern)
        }
      }
    }
  })

  it('Shabbat pages speak the community language', () => {
    for (const name of SHABBAT_PAGES) {
      for (const locale of ['en', 'fr'] as const) {
        expect(textOf(PAGES[name][locale])).toMatch(REQUIRED_ON_SHABBAT_PAGES[locale])
      }
    }
  })

  it('English locales contain no Hebrew script and Hebrew locales stay Hebrew-first', () => {
    for (const [name, copy] of Object.entries(PAGES)) {
      // Hebrew letters inside en/fr copy would mean an untranslated leak.
      // (Dish names are exempt — they go through dish-names.ts, not COPY.)
      for (const locale of ['en', 'fr'] as const) {
        const text = textOf(copy[locale])
        expect(/[֐-ת]/u.test(text), `${name}.${locale} contains Hebrew script`).toBe(false)
      }
      const hebrewText = textOf(copy.he)
      expect(/[֐-ת]/u.test(hebrewText), `${name}.he contains no Hebrew at all`).toBe(true)
    }
  })

  it('dish dictionary is itself localization-clean', () => {
    for (const [hebrew, translation] of Object.entries(DISH_NAMES)) {
      expect(/[֐-ת]/u.test(translation.en), `EN for ${hebrew}`).toBe(false)
      expect(/[֐-ת]/u.test(translation.fr), `FR for ${hebrew}`).toBe(false)
      for (const pattern of FORBIDDEN.en) expect(translation.en).not.toMatch(pattern)
      for (const pattern of FORBIDDEN.fr) expect(translation.fr).not.toMatch(pattern)
    }
  })
})
