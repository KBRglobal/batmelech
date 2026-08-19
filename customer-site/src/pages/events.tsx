import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const CARDS = [
  {
    to: '/experiences/bbq',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/nsSTu1IMHv0.jpeg',
    icon: 'ph:fire-fill',
  },
  {
    to: '/experiences/yacht',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/OIC46tu7QUo.jpeg',
    icon: 'ph:waves-fill',
  },
  {
    to: '/experiences/villa',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Lh0FCekcbt7.jpeg',
    icon: 'ph:house-fill',
  },
  {
    to: '/experiences/suite',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/SuJ0WdhHMRh.jpeg',
    icon: 'ph:heart-fill',
  },
  {
    to: '/experiences/desert',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hQfhwTbpf9J.jpeg',
    icon: 'ph:mountains-fill',
  },
]

const HE = {
  heroBadge: 'Exclusive VIP Experiences',
  heroTitle: ['חוויות קולינריות', 'VIP בדובאי'] as [string, string],
  heroSubtitle:
    'אנחנו מביאים את השף ואת האוכל הכי טוב בדובאי – בדיוק לאן שאתם נמצאים. גלו את מגוון האפשרויות שלנו לאירועים פרטיים ויוקרתיים.',
  cards: [
    {
      tag: 'Private BBQ',
      title: 'שף מנגליסט פרטי',
      desc: 'חווית בשרים על האש אצלכם בווילה. צלייה מקצועית וסלטים טריים.',
    },
    {
      tag: 'Yacht Party',
      title: 'אירועים על יאכטה',
      desc: 'מסיבות ואירועים בלב ים עם קייטרינג גורמה כשר ונוף למרינה.',
    },
    {
      tag: 'Villa Events',
      title: 'מסיבות בוילה',
      desc: 'קייטרינג מלא למסיבות בריכה ואירועים חברתיים בוילות המפוארות.',
    },
    {
      tag: 'Suite Dining',
      title: 'ארוחות בסוויטה',
      desc: 'ארוחות שף פרטיות ואינטימיות בסוויטות מלון. חוויה רומנטית ויוקרתית.',
    },
    {
      tag: 'Desert Safari',
      title: 'סעודת מדבר VIP',
      desc: 'בישול שטח יוקרתי בלב הדיונות. חוויה מדברית עם טעמי בית אמיתיים.',
    },
  ],
  detailsCta: 'לפרטים והזמנה',
  customTitle: 'אירוע בהתאמה אישית',
  customBody: 'יש לכם חלום קולינרי אחר? אנחנו כאן כדי להגשים אותו. דברו איתנו בוואטסאפ.',
  customCta: 'שלחו הודעה',
  planTitle: 'מתכננים אירוע בדובאי?',
  planBody: 'אנחנו דואגים לכל מה שצריך – מהשף ועד הציוד והשירות – כדי שאתם תוכלו פשוט ליהנות.',
  planCta: 'לקבלת הצעת מחיר',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    heroBadge: 'Exclusive VIP Experiences',
    heroTitle: ['VIP Culinary', 'Experiences in Dubai'],
    heroSubtitle:
      'We bring the chef and the finest kosher dining in Dubai right to wherever you are. Explore our collection of private, luxury event experiences.',
    cards: [
      {
        tag: 'Private BBQ',
        title: 'Private Grill Chef',
        desc: 'A fire-grilled feast at your villa. Expert grilling and fresh salads.',
      },
      {
        tag: 'Yacht Party',
        title: 'Yacht Events',
        desc: 'Parties and events out at sea with gourmet kosher catering and marina views.',
      },
      {
        tag: 'Villa Events',
        title: 'Villa Parties',
        desc: 'Full-service catering for pool parties and gatherings in Dubai’s finest villas.',
      },
      {
        tag: 'Suite Dining',
        title: 'Suite Chef Dinners',
        desc: 'Private, intimate chef-prepared dinners in hotel suites. Romantic and luxurious.',
      },
      {
        tag: 'Desert Safari',
        title: 'VIP Desert Feast',
        desc: 'Luxury open-fire dining in the heart of the dunes. A desert experience with true homestyle flavor.',
      },
    ],
    detailsCta: 'Details & Booking',
    customTitle: 'A Custom Event',
    customBody: 'Dreaming up something different? We’re here to make it happen. Message us on WhatsApp.',
    customCta: 'Send a Message',
    planTitle: 'Planning an Event in Dubai?',
    planBody: 'We take care of everything — from the chef to the equipment and service — so you can simply enjoy.',
    planCta: 'Get a Quote',
  },
  fr: {
    heroBadge: 'Exclusive VIP Experiences',
    heroTitle: ['Expériences Culinaires', 'VIP à Dubaï'],
    heroSubtitle:
      'Nous amenons le chef et la meilleure cuisine cachère de Dubaï exactement là où vous êtes. Découvrez notre gamme d’expériences pour vos événements privés et prestigieux.',
    cards: [
      {
        tag: 'Private BBQ',
        title: 'Chef Grillardin Privé',
        desc: 'Une expérience de grillades dans votre villa. Cuisson professionnelle et salades fraîches.',
      },
      {
        tag: 'Yacht Party',
        title: 'Événements sur Yacht',
        desc: 'Fêtes et événements en pleine mer avec traiteur gastronomique cacher et vue sur la marina.',
      },
      {
        tag: 'Villa Events',
        title: 'Fêtes en Villa',
        desc: 'Traiteur complet pour pool parties et événements privés dans les villas les plus luxueuses.',
      },
      {
        tag: 'Suite Dining',
        title: 'Dîners en Suite',
        desc: 'Dîners de chef privés et intimes en suite d’hôtel. Une expérience romantique et prestigieuse.',
      },
      {
        tag: 'Desert Safari',
        title: 'Festin Désert VIP',
        desc: 'Cuisine de plein air luxueuse au cœur des dunes. L’expérience du désert avec le vrai goût de la maison.',
      },
    ],
    detailsCta: 'Détails et réservation',
    customTitle: 'Événement sur mesure',
    customBody: 'Vous avez un autre rêve culinaire ? Nous sommes là pour le réaliser. Écrivez-nous sur WhatsApp.',
    customCta: 'Envoyer un message',
    planTitle: 'Vous organisez un événement à Dubaï ?',
    planBody: 'Nous nous occupons de tout — du chef à l’équipement et au service — pour que vous puissiez simplement profiter.',
    planCta: 'Demander un devis',
  },
}

export function Events() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  const arrowIcon = dir === 'rtl' ? 'ph:arrow-left-bold' : 'ph:arrow-right-bold'
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/events"
        size="tall"
        badge={t.heroBadge}
        title={t.heroTitle}
        subtitle={t.heroSubtitle}
        image={CARDS[0].img}
        imageAlt={t.cards[0].title}
      />
      <main className="pt-10 md:pt-16 pb-16 md:pb-32 max-w-7xl mx-auto px-6">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mb-16 md:mb-32">
          {CARDS.map((card, i) => (
            <Reveal key={card.to} delay={(i % 3) * 100}>
              <Link
                to={href(card.to)}
                className="group relative min-h-[26rem] md:min-h-[35rem] rounded-[2.5rem] md:rounded-[4rem] overflow-hidden shadow-2xl border-2 border-white block"
              >
                <img src={card.img} alt={t.cards[i].title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-[2s] group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                <div className="absolute bottom-8 right-8 left-8 md:bottom-10 md:right-10 md:left-10">
                  <div className="mb-4 flex items-center gap-3">
                    <Icon icon={card.icon} className="text-[#F5A83A] text-3xl" />
                    <span className="text-white/60 font-black tracking-widest uppercase text-xs">{t.cards[i].tag}</span>
                  </div>
                  <h3 className="text-3xl md:text-4xl font-black text-white mb-4 font-heading">{t.cards[i].title}</h3>
                  <p className="text-white/80 text-sm md:text-base font-bold mb-6">{t.cards[i].desc}</p>
                  <div className="inline-flex items-center gap-3 bg-white text-[#3B151A] px-8 py-4 rounded-2xl font-black text-lg group-hover:bg-[#F5A83A] transition-all shadow-xl">
                    {t.detailsCta} <Icon icon={arrowIcon} className="text-xl" />
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
          <Reveal delay={(CARDS.length % 3) * 100}>
            <div className="bg-[#3B151A] rounded-[2.5rem] md:rounded-[4rem] p-8 md:p-10 flex flex-col items-center justify-center text-center border-4 border-[#F5A83A]/30 shadow-2xl h-full">
              <Icon icon="ph:sparkle-fill" className="text-6xl text-[#F5A83A] mb-6 animate-pulse" />
              <h3 className="text-3xl font-black text-white mb-4">{t.customTitle}</h3>
              <p className="text-white/60 font-bold mb-8 text-lg">{t.customBody}</p>
              <a
                href="https://wa.me/971586288776"
                className="w-full bg-[#F5A83A] text-[#3B151A] py-4 md:py-6 rounded-2xl md:rounded-3xl font-black text-lg md:text-2xl hover:bg-white transition-all shadow-2xl"
              >
                {t.customCta} <Icon icon="ph:whatsapp-logo-fill" className="inline-block ms-2" />
              </a>
            </div>
          </Reveal>
        </section>
        <Reveal>
          <section className="bg-[#8D182C] p-8 md:p-24 rounded-[2.5rem] md:rounded-[5rem] text-center shadow-2xl">
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-6xl font-black text-white mb-4 md:mb-8 font-heading leading-tight">{t.planTitle}</h2>
              <p className="text-white/80 text-base md:text-xl font-bold mb-8 md:mb-12 leading-relaxed">{t.planBody}</p>
              <a
                href="https://wa.me/971586288776"
                className="inline-flex items-center justify-center gap-3 md:gap-6 bg-white text-[#3B151A] px-8 py-4 md:px-16 md:py-8 rounded-2xl md:rounded-[3rem] font-black text-lg md:text-3xl shadow-2xl hover:bg-[#F5A83A] transition-all transform hover:scale-105"
              >
                {t.planCta} <Icon icon="ph:whatsapp-logo-fill" className="text-2xl md:text-4xl text-[#25D366] shrink-0" />
              </a>
            </div>
          </section>
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
