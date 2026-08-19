import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { useLocale, type Locale } from '../locale-context'

const QUICK_LINK_PATHS = ['/', '/weekdays', '/shabbat-order', '/shabbat-extras', '/events', '/gallery', '/kashrut', '/story'] as const

const HE = {
  logoAlt: 'בת מלך',
  tagline: 'מטבח ביתי כשר בדובאי — מבושל טרי ומגיע חם אליכם.',
  quickLinksTitle: 'ניווט מהיר',
  quickLinks: ['בית', 'תפריט יום חול', 'שבת קודש', 'חיזוקים לסופ״ש', 'אירועים', 'גלריה', 'כשרות', 'עלינו'],
  contactTitle: 'יצירת קשר',
  whatsappOrders: 'הזמנות בוואטסאפ',
  delivery: 'משלוחים ברחבי דובאי',
  infoTitle: 'מידע',
  terms: 'תנאי שימוש',
  privacy: 'מדיניות פרטיות',
  allergies: 'מידע על אלרגיות',
  kashrutLink: 'כשרות ואיכות',
  rights: 'מטעמי בת מלך דובאי. כל הזכויות שמורות.',
  allergens: 'המזון עשוי להכיל אלרגנים. הפרטים המלאים בעמוד תנאי השימוש.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    logoAlt: 'Bat Melech',
    tagline: 'A kosher home kitchen in Dubai — cooked fresh and delivered hot to your door.',
    quickLinksTitle: 'Quick Links',
    quickLinks: ['Home', 'Weekday Menu', 'Shabbat', 'Shabbat Extras', 'Events', 'Gallery', 'Kashrut', 'Our Story'],
    contactTitle: 'Contact',
    whatsappOrders: 'Order on WhatsApp',
    delivery: 'Delivery across Dubai',
    infoTitle: 'Information',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    allergies: 'Allergy Information',
    kashrutLink: 'Kashrut & Quality',
    rights: 'Bat Melech Dubai. All rights reserved.',
    allergens: 'Food may contain allergens. Full details on the Terms of Service page.',
  },
  fr: {
    logoAlt: 'Bat Melech',
    tagline: 'Une cuisine familiale cachère à Dubaï — préparée fraîche et livrée chaude chez vous.',
    quickLinksTitle: 'Navigation',
    quickLinks: ['Accueil', 'Menu de semaine', 'Chabbat', 'Suppléments', 'Événements', 'Galerie', 'Cacherout', 'Notre histoire'],
    contactTitle: 'Contact',
    whatsappOrders: 'Commander sur WhatsApp',
    delivery: 'Livraison dans tout Dubaï',
    infoTitle: 'Informations',
    terms: 'Conditions d’utilisation',
    privacy: 'Politique de confidentialité',
    allergies: 'Informations allergènes',
    kashrutLink: 'Cacherout et qualité',
    rights: 'Bat Melech Dubaï. Tous droits réservés.',
    allergens: 'Les plats peuvent contenir des allergènes. Détails complets sur la page des conditions d’utilisation.',
  },
}

export function Footer({ className = '' }: { className?: string }) {
  const { locale, href } = useLocale()
  const t = COPY[locale]
  return (
    <footer className={`bg-white border-t-2 border-[#EDB2C1]/30 pt-14 md:pt-20 pb-10 ${className}`}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 pb-12 md:pb-16 border-b border-[#EDB2C1]/20">
          <div className="col-span-2 md:col-span-1 flex flex-col gap-4">
            <Link to={href('/')} className="w-16 h-16 rounded-full overflow-hidden border-2 border-[#EDB2C1]/30 shadow-md">
              <img src="/site/assets/logo.jpg" alt={t.logoAlt} className="w-full h-full object-cover" />
            </Link>
            <p className="text-[#3B151A]/60 font-bold text-sm leading-relaxed">{t.tagline}</p>
            <a
              href="https://www.instagram.com/bat_melech_kitchen/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-black text-sm w-fit"
            >
              <Icon icon="ph:instagram-logo-bold" className="text-xl" />
              Instagram
            </a>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">{t.quickLinksTitle}</h4>
            {QUICK_LINK_PATHS.map((to, i) => (
              <Link key={to} to={href(to)} className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
                {t.quickLinks[i]}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">{t.contactTitle}</h4>
            <a href="tel:+971586288776" className="flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm">
              <Icon icon="ph:phone-fill" />
              <span dir="ltr">+971 58 628 8776</span>
            </a>
            <a
              href="https://wa.me/971586288776"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm"
            >
              <Icon icon="ph:whatsapp-logo-fill" />
              {t.whatsappOrders}
            </a>
            <span className="flex items-center gap-2 text-[#3B151A]/60 font-bold text-sm">
              <Icon icon="ph:map-pin-fill" />
              {t.delivery}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">{t.infoTitle}</h4>
            <Link to={href('/legal')} className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              {t.terms}
            </Link>
            <Link to={href('/legal')} className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              {t.privacy}
            </Link>
            <Link to={href('/legal')} className="flex items-center gap-2 text-[#8D182C] hover:text-[#F5A83A] font-bold text-sm w-fit">
              <Icon icon="ph:warning-circle-bold" />
              {t.allergies}
            </Link>
            <Link to={href('/kashrut')} className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              {t.kashrutLink}
            </Link>
          </div>
        </div>

        <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[#3B151A]/50 font-bold text-xs">
          <span>© {new Date().getFullYear()} {t.rights}</span>
          <span>{t.allergens}</span>
        </div>
      </div>
    </footer>
  )
}
