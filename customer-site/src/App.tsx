import { useEffect } from 'react'
import { Outlet, Routes, Route, useLocation } from 'react-router'
import { ConciergeChat } from './components/concierge-chat'
import { FloatingCartBar } from './components/floating-cart-bar'
import { SiteBanner } from './components/site-banner'
import { ShabbatClosure } from './components/shabbat-closure'
import { useSiteStatus } from './site-status-context'
import { DeviceLocaleRedirect, LocaleLayout, canonicalPath, localizedHref, useLocale, type Locale } from './locale-context'
import { Home } from './pages/home'
import { Weekdays } from './pages/weekdays'
import { Story } from './pages/story'
import { ShabbatOrder } from './pages/shabbat-order'
import { ShabbatExtras } from './pages/shabbat-extras'
import { Checkout } from './pages/checkout'
import { Legal } from './pages/legal'
import { Accessibility } from './pages/accessibility'
import { KashrutQuality } from './pages/kashrut-quality'
import { Gallery } from './pages/gallery'
import { HowItWorks } from './pages/how-it-works'
import { Events } from './pages/events'
import { PrivateBBQExperience } from './pages/experience-bbq'
import { YachtPartyExperience } from './pages/experience-yacht'
import { VillaPartyExperience } from './pages/experience-villa'
import { SuiteDiningExperience } from './pages/experience-suite'
import { DesertSafariExperience } from './pages/experience-desert'
import { NotFound } from './pages/not-found'

interface PageMeta {
  readonly title: string
  readonly description: string
}

// Per-locale page meta — written natively for each audience (Hebrew is the
// source of truth; English speaks to American Jews, French to French Jews).
const PAGE_META: Readonly<Record<Locale, Record<string, PageMeta>>> = {
  he: {
    '/': { title: 'אוכל כשר בדובאי — משלוח מארזי שבת ואוכל ביתי | מטעמי בת מלך', description: 'מטבח ביתי כשר בדובאי. מארזי שבת ותפריט יום חול, מבושל טרי ומגיע חם למלון, לוילה או ליאכטה. משלוחים בכל האמירויות.' },
    '/weekdays': { title: 'משלוח אוכל כשר בדובאי — תפריט יום חול | מטעמי בת מלך', description: 'תפריט יום חול טרי: בגטים, קובה, סלטים ומנות עיקריות. משלוח כשר בדובאי ובכל האמירויות.' },
    '/shabbat-order': { title: 'מארז שבת כשר בדובאי — הזמנה ומשלוח | מטעמי בת מלך', description: 'מארז שבת זוגי עם 12 סלטים, דגים, עיקריות וקינוח. כשר, מבושל טרי, מגיע חם עד אליכם. הזמנות עד חמישי ב-18:00.' },
    '/shabbat-extras': { title: 'מנות שבת כשרות בדובאי להזמנה בודדת | מטעמי בת מלך', description: 'מנות שבת להזמנה חופשית בלי מארז — חמין, דגים, קוגלים ועוד. כשר וטרי, מגיע עד אליכם בדובאי.' },
    '/checkout': { title: 'סיכום הזמנה | מטעמי בת מלך', description: 'סיכום ההזמנה ופרטי המשלוח.' },
    '/story': { title: 'מי אנחנו — מטבח כשר ישראלי בדובאי | מטעמי בת מלך', description: 'הסיפור של לין, המטבח הביתי הכשר שעבר מישראל לדובאי.' },
    '/legal': { title: 'תנאי שימוש ופרטיות | מטעמי בת מלך', description: 'תנאי שימוש, מדיניות פרטיות, אלרגנים ופרטי החברה.' },
    '/accessibility': { title: 'הצהרת נגישות | מטעמי בת מלך', description: 'מה נגיש באתר, מה עוד לא, ואיך לדווח על בעיה.' },
    '/kashrut': { title: 'כשרות — אוכל כשר בהשגחה בדובאי | מטעמי בת מלך', description: 'איך נשמרת הכשרות במטבח: מטבח ייעודי, חומרי גלם ותהליכי עבודה.' },
    '/gallery': { title: 'גלריה — אוכל כשר ואירועים בדובאי | מטעמי בת מלך', description: 'תמונות אמיתיות ממנות, ממארזי שבת ומאירועים שהפקנו בדובאי.' },
    '/how-it-works': { title: 'איך מזמינים אוכל כשר בדובאי | מטעמי בת מלך', description: 'בוחרים מהתפריט, מזמינים באתר או בוואטסאפ, אנחנו מבשלים טרי ומגיעים חם עד הדלת.' },
    '/events': { title: 'קייטרינג כשר בדובאי לאירועים פרטיים | מטעמי בת מלך', description: 'קייטרינג כשר לאירועים בדובאי: מנגל פרטי, יאכטה, וילה, סוויטה ומדבר.' },
    '/experiences/bbq': { title: 'שף על האש בדובאי — מנגל כשר לאירוע | מטעמי בת מלך', description: 'שף מנגליסט מגיע אליכם עם בשרים כשרים וסלטים טריים.' },
    '/experiences/yacht': { title: 'קייטרינג כשר ליאכטה בדובאי | מטעמי בת מלך', description: 'ארוחות ואירועים כשרים על יאכטה, עם הגשה מלאה.' },
    '/experiences/villa': { title: 'קייטרינג כשר לוילה בדובאי | מטעמי בת מלך', description: 'קייטרינג מלא למסיבות ואירועים בוילות בדובאי.' },
    '/experiences/suite': { title: 'שף פרטי בסוויטה בדובאי — ארוחה כשרה | מטעמי בת מלך', description: 'ארוחת שף פרטית בסוויטת המלון שלכם, כשרה ומוגשת.' },
    '/experiences/desert': { title: 'סעודת מדבר כשרה בדובאי | מטעמי בת מלך', description: 'סעודה כשרה בלב הדיונות, עם בישול שטח והגשה.' },
  },
  en: {
    '/': { title: 'Kosher Food Delivery in Dubai — Shabbat Meals | Bat Melech', description: 'A kosher home kitchen in Dubai. Shabbat packages and a weekday menu, cooked fresh and delivered hot to your hotel, villa or yacht. Delivery across the UAE.' },
    '/weekdays': { title: 'Kosher Food Delivery Dubai — Weekday Menu | Bat Melech', description: 'Fresh weekday dishes: baguettes, kubbeh soup, salads and mains. Kosher delivery in Dubai and across the UAE.' },
    '/shabbat-order': { title: 'Kosher Shabbat Meals in Dubai — Order & Delivery | Bat Melech', description: 'A Shabbat package for two with 12 salads, fish, mains and dessert. Kosher, cooked fresh, delivered hot. Orders close Thursday 18:00.' },
    '/shabbat-extras': { title: 'Kosher Shabbat Dishes in Dubai, A La Carte | Bat Melech', description: 'Shabbat dishes ordered on their own, no package required — cholent, fish, kugels and more, delivered across Dubai.' },
    '/checkout': { title: 'Your Order | Bat Melech Kitchen', description: 'Order summary and delivery details.' },
    '/story': { title: 'About Us — An Israeli Kosher Kitchen in Dubai | Bat Melech', description: 'Lynn\'s story: the kosher home kitchen that moved from Israel to Dubai.' },
    '/legal': { title: 'Terms & Privacy | Bat Melech Kitchen', description: 'Terms of use, privacy policy, allergens and company details.' },
    '/accessibility': { title: 'Accessibility Statement | Bat Melech Kitchen', description: 'What this site does for accessibility, what is unfinished, and how to report a problem.' },
    '/kashrut': { title: 'Kashrut — Supervised Kosher Food in Dubai | Bat Melech', description: 'How kashrut is kept in the kitchen: a dedicated kitchen, ingredients and working practice.' },
    '/gallery': { title: 'Gallery — Kosher Food & Events in Dubai | Bat Melech', description: 'Real photos of dishes, Shabbat packages and events we catered in Dubai.' },
    '/how-it-works': { title: 'How to Order Kosher Food in Dubai | Bat Melech', description: 'Choose from the menu, order on the site or WhatsApp, we cook fresh that day and deliver hot to your door.' },
    '/events': { title: 'Kosher Catering in Dubai for Private Events | Bat Melech', description: 'Kosher catering for events in Dubai: private BBQ, yacht, villa, hotel suite and desert.' },
    '/experiences/bbq': { title: 'Private Kosher BBQ Chef in Dubai | Bat Melech', description: 'A grill chef comes to you with kosher meats and fresh salads.' },
    '/experiences/yacht': { title: 'Kosher Catering for Yachts in Dubai | Bat Melech', description: 'Kosher meals and events on a yacht, fully served.' },
    '/experiences/villa': { title: 'Kosher Catering for Villa Parties in Dubai | Bat Melech', description: 'Full kosher catering for parties and events in Dubai villas.' },
    '/experiences/suite': { title: 'Private Kosher Chef, Hotel Suite Dubai | Bat Melech', description: 'A private chef dinner in your hotel suite, kosher and served.' },
    '/experiences/desert': { title: 'Kosher Desert Feast in Dubai | Bat Melech', description: 'A kosher feast in the heart of the dunes, cooked on site and served.' },
  },
  fr: {
    '/': { title: 'Traiteur casher à Dubaï — repas de Chabbat | Bat Melech', description: 'Une cuisine familiale cachère à Dubaï. Coffrets de Chabbat et menu de semaine, cuisinés frais et livrés chauds à votre hôtel, villa ou yacht. Livraison dans tous les Émirats.' },
    '/weekdays': { title: 'Livraison de repas cachers à Dubaï — menu semaine | Bat Melech', description: 'Les plats frais de la semaine : baguettes, soupe de kubés, salades et plats. Livraison cachère à Dubaï et dans tous les Émirats.' },
    '/shabbat-order': { title: 'Coffret de Chabbat casher à Dubaï — commande | Bat Melech', description: 'Un coffret de Chabbat pour deux : 12 salades, poisson, plats et dessert. Casher, cuisiné frais, livré chaud. Commandes jusqu’au jeudi 18h00.' },
    '/shabbat-extras': { title: 'Plats de Chabbat cachers à Dubaï, à la carte | Bat Melech', description: 'Des plats de Chabbat commandés seuls, sans coffret : hamin, poissons, kugels et plus, livrés à Dubaï.' },
    '/checkout': { title: 'Votre commande | Bat Melech', description: 'Récapitulatif de commande et informations de livraison.' },
    '/story': { title: 'Qui sommes-nous — cuisine casher israélienne à Dubaï | Bat Melech', description: 'L\'histoire de Lynn : la cuisine familiale cachère passée d\'Israël à Dubaï.' },
    '/legal': { title: 'Conditions et confidentialité | Bat Melech', description: 'Conditions d\'utilisation, confidentialité, allergènes et informations légales.' },
    '/accessibility': { title: 'Déclaration d’accessibilité | Bat Melech', description: 'Ce que ce site fait pour l’accessibilité, ce qui reste à faire, et comment signaler un problème.' },
    '/kashrut': { title: 'Cacherout — cuisine casher supervisée à Dubaï | Bat Melech', description: 'Comment la cacherout est tenue en cuisine : cuisine dédiée, ingrédients et méthodes.' },
    '/gallery': { title: 'Galerie — cuisine casher et événements à Dubaï | Bat Melech', description: 'De vraies photos de plats, de coffrets de Chabbat et d’événements à Dubaï.' },
    '/how-it-works': { title: 'Comment commander casher à Dubaï | Bat Melech', description: 'Choisissez au menu, commandez sur le site ou par WhatsApp, nous cuisinons frais et livrons chaud.' },
    '/events': { title: 'Traiteur casher à Dubaï pour événements privés | Bat Melech', description: 'Traiteur casher pour vos événements à Dubaï : BBQ privé, yacht, villa, suite et désert.' },
    '/experiences/bbq': { title: 'Chef BBQ casher privé à Dubaï | Bat Melech', description: 'Un chef grillades vient chez vous avec viandes cachères et salades fraîches.' },
    '/experiences/yacht': { title: 'Traiteur casher pour yacht à Dubaï | Bat Melech', description: 'Repas et événements cachers sur un yacht, entièrement servis.' },
    '/experiences/villa': { title: 'Traiteur casher pour villa à Dubaï | Bat Melech', description: 'Traiteur casher complet pour fêtes et événements en villa à Dubaï.' },
    '/experiences/suite': { title: 'Chef privé casher en suite à Dubaï | Bat Melech', description: 'Un dîner de chef privé dans votre suite, casher et servi.' },
    '/experiences/desert': { title: 'Festin casher dans le désert de Dubaï | Bat Melech', description: 'Un festin casher au cœur des dunes, cuisiné sur place et servi.' },
  },
}

function upsertLinkTag(rel: string, hreflang: string | null, href: string) {
  const selector = hreflang === null
    ? `link[rel="${rel}"]:not([hreflang])`
    : `link[rel="${rel}"][hreflang="${hreflang}"]`
  let tag = document.head.querySelector<HTMLLinkElement>(selector)
  if (!tag) {
    tag = document.createElement('link')
    tag.rel = rel
    if (hreflang !== null) tag.hreflang = hreflang
    document.head.appendChild(tag)
  }
  tag.href = href
}

function localeRoutes() {
  return (
    <>
      <Route index element={<Home />} />
      <Route path="weekdays" element={<Weekdays />} />
      <Route path="story" element={<Story />} />
      <Route path="shabbat-order" element={<ShabbatOrder />} />
      <Route path="shabbat-extras" element={<ShabbatExtras />} />
      <Route path="checkout" element={<Checkout />} />
      <Route path="legal" element={<Legal />} />
      <Route path="accessibility" element={<Accessibility />} />
      <Route path="kashrut" element={<KashrutQuality />} />
      <Route path="gallery" element={<Gallery />} />
      <Route path="events" element={<Events />} />
      <Route path="how-it-works" element={<HowItWorks />} />
      <Route path="experiences/bbq" element={<PrivateBBQExperience />} />
      <Route path="experiences/yacht" element={<YachtPartyExperience />} />
      <Route path="experiences/villa" element={<VillaPartyExperience />} />
      <Route path="experiences/suite" element={<SuiteDiningExperience />} />
      <Route path="experiences/desert" element={<DesertSafariExperience />} />
      <Route path="*" element={<NotFound />} />
    </>
  )
}

export default function App() {
  const { pathname, hash } = useLocation()
  const { locale, path } = canonicalPath(pathname)
  const { shabbatClosed } = useSiteStatus()

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    const meta = PAGE_META[locale][path]
    if (meta) {
      document.title = meta.title
      document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', meta.title)
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', meta.description)
      document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', meta.title)
      document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', meta.description)
    }
    const canonicalUrl = `https://www.batmelech.ae${pathname === '/' ? '/' : pathname}`
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl)
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl)
    // Every page announces its two siblings; Hebrew is the default.
    for (const alternate of ['he', 'en', 'fr'] as const) {
      const alternatePath = localizedHref(alternate, path)
      upsertLinkTag('alternate', alternate, `https://www.batmelech.ae${alternatePath === '/' ? '/' : alternatePath}`)
    }
    upsertLinkTag('alternate', 'x-default', `https://www.batmelech.ae${path === '/' ? '/' : path}`)
    document
      .querySelector('meta[name="robots"]')
      ?.setAttribute('content', path === '/checkout' ? 'noindex,nofollow' : 'index,follow,max-image-preview:large')
  }, [pathname, hash, locale, path])

  const showFloatingCart = path !== '/checkout' && path !== '/shabbat-extras' && path !== '/shabbat-order'

  // Every route at once, not a banner on top of a live menu: the site rests.
  // The status fetch defaults to open, so a failed or slow call never hides
  // the shop — only the server saying so does.
  if (shabbatClosed) {
    return <ShabbatClosure />
  }

  return (
    <div key={pathname} className="page-transition">
      <Routes location={pathname}>
        <Route
          element={(
            <LocaleLayout locale="he">
              <DeviceLocaleRedirect />
              <SiteBanner />
              <LocaleOutlet showFloatingCart={showFloatingCart} />
            </LocaleLayout>
          )}
        >
          {localeRoutes()}
        </Route>
        <Route
          path="/en"
          element={(
            <LocaleLayout locale="en">
              <SiteBanner />
              <LocaleOutlet showFloatingCart={showFloatingCart} />
            </LocaleLayout>
          )}
        >
          {localeRoutes()}
        </Route>
        <Route
          path="/fr"
          element={(
            <LocaleLayout locale="fr">
              <SiteBanner />
              <LocaleOutlet showFloatingCart={showFloatingCart} />
            </LocaleLayout>
          )}
        >
          {localeRoutes()}
        </Route>
      </Routes>
    </div>
  )
}

const SKIP_LABEL: Readonly<Record<Locale, string>> = {
  he: 'דילוג לתוכן הראשי',
  en: 'Skip to main content',
  fr: 'Aller au contenu principal',
}

// Invisible until it has keyboard focus: someone tabbing through the page
// lands here first and can jump past the header instead of walking the nav,
// the language buttons and the cart on every single page.
function SkipToContent() {
  const { locale } = useLocale()
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:rounded-full focus:bg-white focus:px-5 focus:py-3 focus:text-sm focus:font-black focus:text-[#3B151A] focus:shadow-2xl focus:outline-none focus:ring-4 focus:ring-[#F5A83A]"
    >
      {SKIP_LABEL[locale]}
    </a>
  )
}

function LocaleOutlet({ showFloatingCart }: { readonly showFloatingCart: boolean }) {
  return (
    <>
      <SkipToContent />
      <Outlet />
      {showFloatingCart && <FloatingCartBar />}
      <ConciergeChat />
    </>
  )
}
