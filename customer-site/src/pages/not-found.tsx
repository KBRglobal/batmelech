import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  title: ['הדף', 'לא נמצא'],
  subtitle: 'הקישור שהגעתם דרכו כבר לא קיים, אבל התפריט שלנו כן.',
  heroAlt: 'מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  backHome: 'חזרה לדף הבית',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    title: ['Page', 'Not Found'],
    subtitle: 'The link you followed no longer exists — but our menu certainly does.',
    heroAlt: 'Bat Melech — a kosher home kitchen in Dubai',
    backHome: 'Back to Home',
  },
  fr: {
    title: ['Page', 'introuvable'],
    subtitle: "Le lien que vous avez suivi n'existe plus — notre menu, lui, existe toujours.",
    heroAlt: 'Bat Melech — une cuisine familiale casher à Dubaï',
    backHome: "Retour à l'accueil",
  },
}

export function NotFound() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-20" dir={dir}>
      <PageHero
        active=""
        size="compact"
        title={t.title as [string, string]}
        subtitle={t.subtitle}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZEd1RfEEqbe.jpeg"
        imageAlt={t.heroAlt}
      />
      <main className="max-w-3xl mx-auto px-6 py-20 text-center">
        <Link
          to={href('/')}
          className="bg-[#3B151A] text-white px-10 py-5 rounded-full font-black text-lg hover:bg-[#F5A83A] transition-all shadow-xl inline-flex items-center gap-3"
        >
          {t.backHome} <Icon icon="ph:house-fill" />
        </Link>
      </main>
      <Footer />
    </div>
  )
}
