import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router'
import { FloatingCartBar } from './components/floating-cart-bar'
import { SiteBanner } from './components/site-banner'
import { Home } from './pages/home'
import { Weekdays } from './pages/weekdays'
import { Story } from './pages/story'
import { ShabbatOrder } from './pages/shabbat-order'
import { ShabbatExtras } from './pages/shabbat-extras'
import { Checkout } from './pages/checkout'
import { Legal } from './pages/legal'
import { KashrutQuality } from './pages/kashrut-quality'
import { Gallery } from './pages/gallery'
import { Events } from './pages/events'
import { PrivateBBQExperience } from './pages/experience-bbq'
import { YachtPartyExperience } from './pages/experience-yacht'
import { VillaPartyExperience } from './pages/experience-villa'
import { SuiteDiningExperience } from './pages/experience-suite'
import { DesertSafariExperience } from './pages/experience-desert'
import { NotFound } from './pages/not-found'

const PAGE_META: Record<string, { title: string; description: string }> = {
  '/': { title: 'מטעמי בת מלך | אוכל ביתי כשר בדובאי', description: 'מטבח ביתי כשר בדובאי. תפריט יום חול ומארזי שבת יוקרתיים, מבושל טרי ומגיע חם אליכם.' },
  '/weekdays': { title: 'מטעמי יום חול | מטעמי בת מלך', description: 'תפריט יום חול טרי - בגטים, קובה, סלטים ועוד. משלוח כשר בכל רחבי דובאי.' },
  '/shabbat-order': { title: 'מטעמי שבת קודש | מטעמי בת מלך', description: 'הרכיבו מארז שבת זוגי יוקרתי - סלטים, ראשונות, עיקריות ועוד. כשר וטרי, מגיע עד אליכם.' },
  '/shabbat-extras': { title: 'חיזוקים לסופ״ש | מטעמי בת מלך', description: 'מנות שבת מלכותיות בהזמנה חופשית, בלי שום התחייבות למארז - כשר וטרי, מגיע עד אליכם.' },
  '/checkout': { title: 'סיכום הזמנה | מטעמי בת מלך', description: 'סיכום ההזמנה ופרטי המשלוח.' },
  '/story': { title: 'הסיפור שלנו | מטעמי בת מלך', description: 'הסיפור מאחורי מטעמי בת מלך - מטבח ביתי כשר בדובאי.' },
  '/legal': { title: 'תנאי שימוש ופרטיות | מטעמי בת מלך', description: 'תנאי שימוש, מדיניות פרטיות והצהרת אלרגיות.' },
  '/kashrut': { title: 'כשרות ואיכות | מטעמי בת מלך', description: 'הסטנדרטים המחמירים של הכשרות שלנו בדובאי.' },
  '/gallery': { title: 'גלריה | מטעמי בת מלך', description: 'תמונות מהאירועים והמנות של מטעמי בת מלך.' },
  '/events': { title: 'חוויות קולינריות VIP | מטעמי בת מלך', description: 'BBQ פרטי, אירועי יאכטה, מסיבות בוילה, ארוחות בסוויטה וסעודות מדבר.' },
  '/experiences/bbq': { title: 'שף מנגליסט VIP | מטעמי בת מלך', description: 'חוויית BBQ פרטית עם שף מנגליסט בדובאי.' },
  '/experiences/yacht': { title: 'אירועים על יאכטה | מטעמי בת מלך', description: 'קייטרינג כשר יוקרתי ליאכטות בדובאי.' },
  '/experiences/villa': { title: 'מסיבות בוילה | מטעמי בת מלך', description: 'קייטרינג מלא למסיבות ואירועים בוילות בדובאי.' },
  '/experiences/suite': { title: 'ארוחות בסוויטה | מטעמי בת מלך', description: 'ארוחות שף פרטיות ואינטימיות בסוויטות מלון.' },
  '/experiences/desert': { title: 'סעודת מדבר VIP | מטעמי בת מלך', description: 'סעודת גורמה כשרה בלב מדבר דובאי.' },
}

export default function App() {
  const { pathname, hash } = useLocation()

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
    const meta = PAGE_META[pathname]
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
    document
      .querySelector('meta[name="robots"]')
      ?.setAttribute('content', pathname === '/checkout' ? 'noindex,nofollow' : 'index,follow,max-image-preview:large')
  }, [pathname, hash])

  return (
    <div key={pathname} className="page-transition">
      <SiteBanner />
      <Routes location={pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/weekdays" element={<Weekdays />} />
        <Route path="/story" element={<Story />} />
        <Route path="/shabbat-order" element={<ShabbatOrder />} />
        <Route path="/shabbat-extras" element={<ShabbatExtras />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/kashrut" element={<KashrutQuality />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/events" element={<Events />} />
        <Route path="/experiences/bbq" element={<PrivateBBQExperience />} />
        <Route path="/experiences/yacht" element={<YachtPartyExperience />} />
        <Route path="/experiences/villa" element={<VillaPartyExperience />} />
        <Route path="/experiences/suite" element={<SuiteDiningExperience />} />
        <Route path="/experiences/desert" element={<DesertSafariExperience />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {pathname !== '/checkout' && pathname !== '/shabbat-extras' && <FloatingCartBar />}
    </div>
  )
}
