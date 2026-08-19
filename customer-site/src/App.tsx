import { useEffect } from 'react'
import { Outlet, Routes, Route, useLocation } from 'react-router'
import { ConciergeChat } from './components/concierge-chat'
import { FloatingCartBar } from './components/floating-cart-bar'
import { SiteBanner } from './components/site-banner'
import { ShabbatClosure } from './components/shabbat-closure'
import { useSiteStatus } from './site-status-context'
import { DeviceLocaleRedirect, LocaleLayout, canonicalPath, localizedHref, type Locale } from './locale-context'
import { Home } from './pages/home'
import { Weekdays } from './pages/weekdays'
import { Story } from './pages/story'
import { ShabbatOrder } from './pages/shabbat-order'
import { ShabbatExtras } from './pages/shabbat-extras'
import { Checkout } from './pages/checkout'
import { Legal } from './pages/legal'
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
    '/': { title: 'מטעמי בת מלך | אוכל ביתי כשר בדובאי', description: 'מטבח ביתי כשר בדובאי. תפריט יום חול ומארזי שבת יוקרתיים, מבושל טרי ומגיע חם אליכם.' },
    '/weekdays': { title: 'מטעמי יום חול | מטעמי בת מלך', description: 'תפריט יום חול טרי - בגטים, קובה, סלטים ועוד. משלוח כשר בכל רחבי דובאי.' },
    '/shabbat-order': { title: 'מטעמי שבת קודש | מטעמי בת מלך', description: 'הרכיבו מארז שבת זוגי יוקרתי - סלטים, ראשונות, עיקריות ועוד. כשר וטרי, מגיע עד אליכם.' },
    '/shabbat-extras': { title: 'חיזוקים לסופ״ש | מטעמי בת מלך', description: 'מנות שבת מלכותיות בהזמנה חופשית, בלי שום התחייבות למארז - כשר וטרי, מגיע עד אליכם.' },
    '/checkout': { title: 'סיכום הזמנה | מטעמי בת מלך', description: 'סיכום ההזמנה ופרטי המשלוח.' },
    '/story': { title: 'הסיפור שלנו | מטעמי בת מלך', description: 'הסיפור מאחורי מטעמי בת מלך - מטבח ביתי כשר בדובאי.' },
    '/legal': { title: 'תנאי שימוש ופרטיות | מטעמי בת מלך', description: 'תנאי שימוש, מדיניות פרטיות והצהרת אלרגיות.' },
    '/kashrut': { title: 'כשרות ואיכות | מטעמי בת מלך', description: 'הסטנדרטים המחמירים של הכשרות שלנו בדובאי.' },
    '/gallery': { title: 'גלריה | מטעמי בת מלך', description: 'תמונות מהאירועים והמנות של מטעמי בת מלך.' },
    '/how-it-works': { title: 'איך זה עובד | מטעמי בת מלך', description: 'מהתפריט ועד דלת המלון — בוחרים, מזמינים באתר או בוואטסאפ, אנחנו מבשלים טרי ומגיעים חם. התשלום רק במסירה.' },
    '/events': { title: 'חוויות קולינריות VIP | מטעמי בת מלך', description: 'BBQ פרטי, אירועי יאכטה, מסיבות בוילה, ארוחות בסוויטה וסעודות מדבר.' },
    '/experiences/bbq': { title: 'שף מנגליסט VIP | מטעמי בת מלך', description: 'חוויית BBQ פרטית עם שף מנגליסט בדובאי.' },
    '/experiences/yacht': { title: 'אירועים על יאכטה | מטעמי בת מלך', description: 'קייטרינג כשר יוקרתי ליאכטות בדובאי.' },
    '/experiences/villa': { title: 'מסיבות בוילה | מטעמי בת מלך', description: 'קייטרינג מלא למסיבות ואירועים בוילות בדובאי.' },
    '/experiences/suite': { title: 'ארוחות בסוויטה | מטעמי בת מלך', description: 'ארוחות שף פרטיות ואינטימיות בסוויטות מלון.' },
    '/experiences/desert': { title: 'סעודת מדבר VIP | מטעמי בת מלך', description: 'סעודת גורמה כשרה בלב מדבר דובאי.' },
  },
  en: {
    '/': { title: 'Bat Melech Kitchen | Kosher Homemade Food in Dubai', description: 'A kosher home kitchen in Dubai. Fresh weekday menu and elegant Shabbat packages, cooked fresh and delivered hot to your hotel.' },
    '/weekdays': { title: 'Weekday Menu | Bat Melech Kitchen', description: 'Fresh weekday favorites - baguettes, kubbeh soup, salads and more. Kosher delivery across Dubai.' },
    '/shabbat-order': { title: 'Shabbat Menu | Bat Melech Kitchen', description: 'Build your Shabbat package for two - salads, fish courses, mains and more. Kosher, fresh, delivered to you.' },
    '/shabbat-extras': { title: 'Shabbat Extras | Bat Melech Kitchen', description: 'Royal Shabbat dishes a la carte, no package required - kosher and fresh, delivered to you.' },
    '/checkout': { title: 'Your Order | Bat Melech Kitchen', description: 'Order summary and delivery details.' },
    '/story': { title: 'Our Story | Bat Melech Kitchen', description: 'The story behind Bat Melech - a kosher home kitchen in Dubai.' },
    '/legal': { title: 'Terms & Privacy | Bat Melech Kitchen', description: 'Terms of use, privacy policy and allergy notice.' },
    '/kashrut': { title: 'Kashrut & Quality | Bat Melech Kitchen', description: 'Our strict kashrut standards in Dubai.' },
    '/gallery': { title: 'Gallery | Bat Melech Kitchen', description: 'Photos from Bat Melech events and dishes.' },
    '/how-it-works': { title: 'How It Works | Bat Melech Kitchen', description: 'From the menu to your hotel door — browse, order on the site or WhatsApp, we cook fresh that day and deliver hot. Pay on delivery.' },
    '/events': { title: 'VIP Culinary Experiences | Bat Melech Kitchen', description: 'Private BBQ, yacht events, villa parties, in-suite dining and desert feasts.' },
    '/experiences/bbq': { title: 'Private BBQ Chef | Bat Melech Kitchen', description: 'A private kosher BBQ experience with a grill chef in Dubai.' },
    '/experiences/yacht': { title: 'Yacht Events | Bat Melech Kitchen', description: 'Luxury kosher catering for yachts in Dubai.' },
    '/experiences/villa': { title: 'Villa Parties | Bat Melech Kitchen', description: 'Full kosher catering for villa parties and events in Dubai.' },
    '/experiences/suite': { title: 'In-Suite Dining | Bat Melech Kitchen', description: 'Private, intimate chef dinners in hotel suites.' },
    '/experiences/desert': { title: 'VIP Desert Feast | Bat Melech Kitchen', description: 'A kosher gourmet feast in the heart of the Dubai desert.' },
  },
  fr: {
    '/': { title: 'Bat Melech | Cuisine casher maison à Dubaï', description: 'Une cuisine familiale casher à Dubaï. Menu de semaine et coffrets de Chabbat raffinés, cuisinés frais et livrés chauds à votre hôtel.' },
    '/weekdays': { title: 'Menu de semaine | Bat Melech', description: 'Les plats frais de la semaine - baguettes, soupe de kubés, salades et plus. Livraison casher dans tout Dubaï.' },
    '/shabbat-order': { title: 'Menu de Chabbat | Bat Melech', description: 'Composez votre coffret de Chabbat pour deux - salades, poissons, plats et plus. Casher, frais, livré chez vous.' },
    '/shabbat-extras': { title: 'Suppléments Chabbat | Bat Melech', description: 'Plats de Chabbat royaux à la carte, sans coffret obligatoire - casher et frais, livrés chez vous.' },
    '/checkout': { title: 'Votre commande | Bat Melech', description: 'Récapitulatif de commande et informations de livraison.' },
    '/story': { title: 'Notre histoire | Bat Melech', description: "L'histoire de Bat Melech - une cuisine familiale casher à Dubaï." },
    '/legal': { title: 'Conditions et confidentialité | Bat Melech', description: "Conditions d'utilisation, politique de confidentialité et allergènes." },
    '/kashrut': { title: 'Cacherout et qualité | Bat Melech', description: 'Nos standards stricts de cacherout à Dubaï.' },
    '/gallery': { title: 'Galerie | Bat Melech', description: 'Photos des événements et des plats de Bat Melech.' },
    '/how-it-works': { title: 'Comment ça marche | Bat Melech', description: 'Du menu à la porte de votre hôtel — choisissez, commandez sur le site ou par WhatsApp, nous cuisinons frais le jour même et livrons chaud. Paiement à la livraison.' },
    '/events': { title: 'Expériences culinaires VIP | Bat Melech', description: 'BBQ privé, événements sur yacht, soirées en villa, dîners en suite et festins dans le désert.' },
    '/experiences/bbq': { title: 'Chef BBQ privé | Bat Melech', description: 'Une expérience BBQ casher privée avec un chef grillades à Dubaï.' },
    '/experiences/yacht': { title: 'Événements sur yacht | Bat Melech', description: 'Traiteur casher de luxe pour yachts à Dubaï.' },
    '/experiences/villa': { title: 'Soirées en villa | Bat Melech', description: 'Traiteur casher complet pour fêtes et événements en villa à Dubaï.' },
    '/experiences/suite': { title: 'Dîner en suite | Bat Melech', description: "Dîners de chef privés et intimes en suite d'hôtel." },
    '/experiences/desert': { title: 'Festin du désert VIP | Bat Melech', description: 'Un festin gastronomique casher au cœur du désert de Dubaï.' },
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
    const canonicalUrl = `https://www.batmelech.ae/site${pathname === '/' ? '/' : pathname}`
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl)
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl)
    // Every page announces its two siblings; Hebrew is the default.
    for (const alternate of ['he', 'en', 'fr'] as const) {
      const alternatePath = localizedHref(alternate, path)
      upsertLinkTag('alternate', alternate, `https://www.batmelech.ae/site${alternatePath === '/' ? '/' : alternatePath}`)
    }
    upsertLinkTag('alternate', 'x-default', `https://www.batmelech.ae/site${path === '/' ? '/' : path}`)
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

function LocaleOutlet({ showFloatingCart }: { readonly showFloatingCart: boolean }) {
  return (
    <>
      <Outlet />
      {showFloatingCart && <FloatingCartBar />}
      <ConciergeChat />
    </>
  )
}
