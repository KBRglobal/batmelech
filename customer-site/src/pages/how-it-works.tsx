import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'
import { Footer } from '../components/footer'
import { DELIVERY_FEES_USD } from '../cart-context'
import { useLocale, type Locale } from '../locale-context'

const WHATSAPP_NUMBER = '+971 58 628 8776'
const WHATSAPP_URL = 'https://wa.me/971586288776'

const HERO_IMAGE = 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Tr7Zvl6EB0X.jpeg'

// One icon per step — real icon-library icons only, never built inline.
const STEP_ICONS = [
  'ph:book-open-text-fill',
  'ph:chat-circle-dots-fill',
  'ph:cooking-pot-fill',
  'ph:moped-fill',
  'ph:hand-coins-fill',
] as const

// Localized copy. Hebrew is the source of truth; English is written for an
// American Jewish audience and French for a French Jewish audience — native
// copy, never word-by-word (always Shabbat/Chabbat, casher, vouvoiement).
const HE = {
  badge: 'From Our Kitchen to Your Hotel',
  heroTitle: ['איך זה', 'עובד'] as [string, string],
  heroSubtitle: 'נחתם בדובאי ומתחשק אוכל חם של בית? חמישה צעדים פשוטים מפרידים ביניכם לבין שולחן ערוך.',
  heroImageAlt: 'שולחן ערוך לאירוח כשר בדובאי',
  stepsKicker: 'Step by Step',
  stepsTitle: 'מהתפריט ועד הצלחת',
  steps: [
    {
      title: 'בוחרים תפריט',
      body: 'מציצים בתפריט יום החול או בתפריט השבת שלנו ובוחרים מה שהלב חושק בו.',
    },
    {
      title: 'מזמינים',
      body: 'מזמינים כאן באתר או בהודעת וואטסאפ — איך שנוח לכם.',
    },
    {
      title: 'אנחנו מבשלים',
      body: 'הכל מתבשל טרי באותו יום, כמו בבית.',
    },
    {
      title: 'מקבלים חם עד המלון',
      body: 'ההזמנה מגיעה חמה עד דלת המלון בדובאי או באבו דאבי. מעדיפים לאסוף בעצמכם? בשמחה, בלי עלות.',
    },
    {
      title: 'משלמים בקבלה',
      body: 'בלי תשלום באתר — משלמים רק כשהאוכל אצלכם: מזומן, העברה בנקאית, ביט או פייבוקס.',
    },
  ],
  deliveryDubai: 'משלוח לדובאי',
  deliveryAbuDhabi: 'משלוח לאבו דאבי',
  deliveryPickup: 'איסוף עצמי',
  deliveryPickupFree: 'חינם',
  menusTitle: 'מאיפה מתחילים?',
  menuWeekday: 'תפריט יום חול',
  menuShabbat: 'תפריט שבת',
  ctaTitle: 'יש שאלה? דברו איתנו',
  ctaBody: 'אנחנו זמינים בוואטסאפ לכל שאלה, בקשה מיוחדת או הזמנה.',
  ctaButton: 'לשיחה בוואטסאפ',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    badge: 'From Our Kitchen to Your Hotel',
    heroTitle: ['How It', 'Works'],
    heroSubtitle: 'Just landed in Dubai and craving a hot, home-cooked meal? Five simple steps stand between you and a full table.',
    heroImageAlt: 'A table set for kosher hosting in Dubai',
    stepsKicker: 'Step by Step',
    stepsTitle: 'From the Menu to Your Plate',
    steps: [
      {
        title: 'Browse the menu',
        body: 'Take a look at our weekday menu or our Shabbat menu and pick whatever your heart desires.',
      },
      {
        title: 'Place your order',
        body: 'Order right here on the site or send us a WhatsApp message — whatever is easiest for you.',
      },
      {
        title: 'We cook it fresh',
        body: 'Everything is cooked fresh that same day, just like home.',
      },
      {
        title: 'Delivered hot to your hotel',
        body: 'Your order arrives hot at your hotel door in Dubai or Abu Dhabi. Prefer to pick it up yourself? Gladly — free of charge.',
      },
      {
        title: 'Pay on delivery',
        body: 'No payment on the site — you pay only when the food is in your hands: cash, bank transfer, Bit, or PayBox.',
      },
    ],
    deliveryDubai: 'Delivery to Dubai',
    deliveryAbuDhabi: 'Delivery to Abu Dhabi',
    deliveryPickup: 'Self-pickup',
    deliveryPickupFree: 'Free',
    menusTitle: 'Where to Start?',
    menuWeekday: 'Weekday Menu',
    menuShabbat: 'Shabbat Menu',
    ctaTitle: 'Have a Question? Talk to Us',
    ctaBody: 'We are on WhatsApp for any question, special request, or order.',
    ctaButton: 'Chat on WhatsApp',
  },
  fr: {
    badge: 'From Our Kitchen to Your Hotel',
    heroTitle: ['Comment ça', 'marche'],
    heroSubtitle: 'Vous venez d\'arriver à Dubaï et rêvez d\'un repas chaud fait maison ? Cinq étapes simples vous séparent d\'une table dressée.',
    heroImageAlt: 'Une table dressée pour une réception casher à Dubaï',
    stepsKicker: 'Step by Step',
    stepsTitle: 'Du menu à votre assiette',
    steps: [
      {
        title: 'Parcourez le menu',
        body: 'Découvrez notre menu de semaine ou notre menu de Chabbat, et choisissez ce qui vous fait envie.',
      },
      {
        title: 'Passez commande',
        body: 'Commandez directement sur le site ou par message WhatsApp — comme vous préférez.',
      },
      {
        title: 'Nous cuisinons pour vous',
        body: 'Tout est cuisiné frais le jour même, comme à la maison.',
      },
      {
        title: 'Livraison chaude à votre hôtel',
        body: 'Votre commande arrive chaude à la porte de votre hôtel, à Dubaï ou à Abou Dhabi. Vous préférez venir la chercher ? Avec plaisir — gratuitement.',
      },
      {
        title: 'Réglez à la réception',
        body: 'Aucun paiement sur le site — vous réglez uniquement à la livraison : espèces, virement bancaire, Bit ou PayBox.',
      },
    ],
    deliveryDubai: 'Livraison à Dubaï',
    deliveryAbuDhabi: 'Livraison à Abou Dhabi',
    deliveryPickup: 'Retrait sur place',
    deliveryPickupFree: 'Gratuit',
    menusTitle: 'Par où commencer ?',
    menuWeekday: 'Menu de semaine',
    menuShabbat: 'Menu de Chabbat',
    ctaTitle: 'Une question ? Parlons-en',
    ctaBody: 'Nous sommes sur WhatsApp pour toute question, demande particulière ou commande.',
    ctaButton: 'Échanger sur WhatsApp',
  },
}

export function HowItWorks() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir={dir}>
      <PageHero
        active="/how-it-works"
        size="compact"
        badge={t.badge}
        title={t.heroTitle}
        subtitle={t.heroSubtitle}
        image={HERO_IMAGE}
        imageAlt={t.heroImageAlt}
      />

      <main className="max-w-5xl mx-auto px-6 pt-20">
        <Reveal>
          <div className="text-center mb-16">
            <span className="text-[#F5A83A] text-xs md:text-sm font-black uppercase tracking-[0.3em] md:tracking-[0.4em] block mb-4">
              {t.stepsKicker}
            </span>
            <h2 className="text-3xl md:text-6xl font-black font-heading tracking-tight">{t.stepsTitle}</h2>
          </div>
        </Reveal>

        <div className="flex flex-col gap-8 md:gap-10">
          {t.steps.map((step, i) => (
            <Reveal key={step.title} delay={(i % 5) * 80}>
              <div className="bg-white rounded-[2.5rem] md:rounded-[3.5rem] p-8 md:p-12 shadow-xl border-2 border-[#EDB2C1]/20 flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-10">
                <div className="flex items-center gap-5 shrink-0">
                  <span className="text-5xl md:text-7xl font-black font-heading text-[#EDB2C1]/60 leading-none">
                    {i + 1}
                  </span>
                  <span className="w-16 h-16 md:w-20 md:h-20 rounded-[1.5rem] md:rounded-[2rem] bg-[#3B151A] text-[#F5A83A] flex items-center justify-center shadow-xl">
                    <Icon icon={STEP_ICONS[i]} className="text-3xl md:text-4xl" />
                  </span>
                </div>
                <div className="flex-grow">
                  <h3 className="text-2xl md:text-3xl font-black font-heading mb-2">{step.title}</h3>
                  <p className="text-[#3B151A]/60 font-bold text-lg leading-relaxed">{step.body}</p>
                  {i === 3 && (
                    <div className="flex flex-wrap gap-3 mt-5">
                      <span className="flex items-center gap-2 bg-[#F7ECE6] rounded-full px-5 py-2.5 font-black text-sm">
                        <Icon icon="ph:map-pin-fill" className="text-[#F5A83A]" />
                        {t.deliveryDubai} — ${DELIVERY_FEES_USD.dubai}
                      </span>
                      <span className="flex items-center gap-2 bg-[#F7ECE6] rounded-full px-5 py-2.5 font-black text-sm">
                        <Icon icon="ph:map-pin-fill" className="text-[#F5A83A]" />
                        {t.deliveryAbuDhabi} — ${DELIVERY_FEES_USD['abu-dhabi']}
                      </span>
                      <span className="flex items-center gap-2 bg-[#F7ECE6] rounded-full px-5 py-2.5 font-black text-sm">
                        <Icon icon="ph:storefront-fill" className="text-[#F5A83A]" />
                        {t.deliveryPickup} — {t.deliveryPickupFree}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <section className="mt-24 text-center">
            <h2 className="text-3xl md:text-5xl font-black font-heading mb-10">{t.menusTitle}</h2>
            <div className="flex flex-col sm:flex-row justify-center gap-5">
              <Link
                to={href('/weekdays')}
                className="inline-flex items-center justify-center gap-3 bg-[#3B151A] text-white px-10 py-6 rounded-full font-black text-xl shadow-2xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all transform hover:scale-105"
              >
                <Icon icon="ph:sun-fill" className="text-2xl" />
                {t.menuWeekday}
              </Link>
              <Link
                to={href('/shabbat-order')}
                className="inline-flex items-center justify-center gap-3 bg-[#F5A83A] text-white px-10 py-6 rounded-full font-black text-xl shadow-2xl hover:bg-[#3B151A] transition-all transform hover:scale-105"
              >
                <Icon icon="ph:crown-fill" className="text-2xl" />
                {t.menuShabbat}
              </Link>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section className="mt-24 bg-white p-12 md:p-20 rounded-[4rem] md:rounded-[5rem] text-center border-2 border-[#EDB2C1]/20 shadow-2xl">
            <h2 className="text-3xl md:text-5xl font-black font-heading mb-6">{t.ctaTitle}</h2>
            <p className="text-[#3B151A]/70 text-lg md:text-xl font-bold mb-4">{t.ctaBody}</p>
            <p className="text-2xl md:text-3xl font-black mb-10" dir="ltr">{WHATSAPP_NUMBER}</p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-5 bg-[#3B151A] text-white px-12 md:px-16 py-6 md:py-8 rounded-full font-black text-xl md:text-2xl shadow-2xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all transform hover:scale-105"
            >
              {t.ctaButton} <Icon icon="ph:whatsapp-logo-fill" className="text-3xl" />
            </a>
          </section>
        </Reveal>
      </main>

      <Footer className="mt-24" />
    </div>
  )
}
