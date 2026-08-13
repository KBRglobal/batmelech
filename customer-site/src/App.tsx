import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router'
import { Home } from './pages/home'
import { Weekdays } from './pages/weekdays'
import { Story } from './pages/story'
import { ShabbatOrder } from './pages/shabbat-order'
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

export default function App() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <div key={pathname} className="page-transition">
      <Routes location={pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/weekdays" element={<Weekdays />} />
        <Route path="/story" element={<Story />} />
        <Route path="/shabbat-order" element={<ShabbatOrder />} />
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
      </Routes>
    </div>
  )
}
