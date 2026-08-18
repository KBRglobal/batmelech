import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { HolidayMenuSection } from '../components/holiday-menu-section'
import { useReveal } from '../components/reveal'
import { useLocale, type Locale } from '../locale-context'

// Non-textual metadata per experience card — copy lives in COPY below,
// index-aligned with COPY[locale].experiences.
const EXPERIENCE_META = [
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

const TESTIMONIAL_META = [
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZEd1RfEEqbe.jpeg',
    avatar: 'https://randomuser.me/api/portraits/men/32.jpg',
  },
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/psq4DoJL0is.jpeg',
    avatar: 'https://randomuser.me/api/portraits/women/44.jpg',
  },
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/gpJVV6ZvEfk.jpeg',
    avatar: 'https://randomuser.me/api/portraits/men/12.jpg',
  },
]

const HE = {
  hero: {
    badge: 'Authentic Home Kitchen',
    title: ['הטעם של הבית', 'בלב דובאי'],
    subtitle: 'אוכל ישראלי שורשי, טרי בכל יום, מבושל עם כל הלב. האיכות המוכרת מישראל - עכשיו בחופשה שלכם.',
    imageAlt: 'אוכל ביתי כשר מוגש בדובאי - מטעמי בת מלך',
    ctaShabbat: 'הרכיבו חבילת קידוש מושלמת',
    ctaWeekday: 'תפריט יום חול',
  },
  story: {
    portraitAlt: 'לין - בת מלך',
    title: 'הסיפור שלי',
    body:
      'אני לין, והמטבח תמיד היה חלק ממני. מהקובה הביתית שכבשה את ישראל ועד המעבר המרגש לדובאי – חזרתי למטבח יחד עם בעלי כדי להביא לכם את הטעם של הבית, כשר וטרי, גם בחופשה שלכם.',
    readMore: 'קראו את הסיפור המלא',
  },
  shabbatPromo: {
    badge: 'The Shabbat Experience',
    imageAlt: 'מארז שבת זוגי יוקרתי - מטעמי שבת קודש כשר בדובאי',
    titleTop: 'מטעמי',
    titleAccent: 'שבת קודש',
    body: 'חבילות קידוש וסעודות שבת מפוארות שמגיעות עד אליכם. כל מה שצריך לשבת מושלמת, בטעם של בית ובכשרות מהודרת.',
    cta: 'לתפריט שבת המלא',
  },
  weekdayPromo: {
    badge: 'Fresh Daily Meals',
    imageAlt: 'תפריט יום חול כשר וטרי - מטעמי בת מלך דובאי',
    titleTop: 'משהו טעים',
    titleAccent: 'לאמצע שבוע',
    body: 'אוכל ישראלי טרי, סלטים צבעוניים ובשרים משובחים. המשלוח שלנו מגיע לכל מקום בדובאי, כל יום מחדש.',
    cta: 'לתפריט יום חול',
  },
  experiencesSection: {
    badge: 'Exclusive Events & Catering',
    titleTop: 'חוויות קולינריות',
    titleAccent: 'VIP בכל מקום',
    body: 'אנחנו מגיעים לכל נקודה בדובאי כדי ליצור לכם אירוע בלתי נשכח. אוכל כשר ברמה הגבוהה ביותר, הגשה יוקרתית ושירות אישי.',
    cardCta: 'לפרטים והזמנה',
    ideaTitle: 'יש לכם רעיון אחר?',
    ideaBody: 'אנחנו פתוחים לכל חלום קולינרי שיש לכם בדובאי. דברו איתנו ונגשים לכם אותו.',
    ideaCta: 'דברו איתנו',
  },
  experiences: [
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
      desc: 'קייטרינג מלא למסיבות בריכה ואירועים חברתיים בוילות המפוארות של דובאי.',
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
  testimonialsSection: {
    badge: 'The Wall of Love',
    titleTop: 'מה אומרים',
    titleAccent: 'האורחים שלנו?',
  },
  testimonials: [
    {
      quote: '"פשוט מושלם. האוכל הגיע חם, טרי ובטעם של הבית שכל כך היה חסר לנו."',
      name: 'יובל דיין',
      place: 'Palm Jumeirah Villa',
    },
    {
      quote: '"חגגנו יום הולדת על יאכטה ולין הפיקה לנו אירוע קולינרי מדהים. הדגים היו ברמה של מישלן."',
      name: 'מיכל אהרוני',
      place: 'Yacht Party VIP',
    },
    {
      quote: '"כאיש עסקים שנוסע הרבה לדובאי, למצוא אוכל כשר ואיכותי זה אתגר. השירות של בת מלך הציל אותי."',
      name: 'דניאל כהן',
      place: 'Business Dining',
    },
  ],
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    hero: {
      badge: 'Authentic Home Kitchen',
      title: ['The Taste of Home', 'in the Heart of Dubai'],
      subtitle: 'Authentic Israeli home cooking, fresh every day, made with all our heart. The quality you know from Israel — now on your vacation.',
      imageAlt: 'Kosher home-cooked food served in Dubai — Bat Melech',
      ctaShabbat: 'Build Your Perfect Shabbat Package',
      ctaWeekday: 'Weekday Menu',
    },
    story: {
      portraitAlt: 'Lynn — Bat Melech',
      title: 'My Story',
      body:
        "I'm Lynn, and the kitchen has always been part of me. From the homemade kubbeh that won over Israel to our exciting move to Dubai — I'm back in the kitchen, together with my husband, bringing you the taste of home, kosher and fresh, even on your vacation.",
      readMore: 'Read the Full Story',
    },
    shabbatPromo: {
      badge: 'The Shabbat Experience',
      imageAlt: 'Luxury Shabbat package for two — kosher Shabbat delicacies in Dubai',
      titleTop: 'Delicacies of',
      titleAccent: 'Shabbat Kodesh',
      body: 'Kiddush packages and lavish Shabbat meals, delivered right to you. Everything you need for a perfect Shabbat — the taste of home, under mehadrin kashrut.',
      cta: 'See the Full Shabbat Menu',
    },
    weekdayPromo: {
      badge: 'Fresh Daily Meals',
      imageAlt: 'Fresh kosher weekday menu — Bat Melech Dubai',
      titleTop: 'Something Delicious',
      titleAccent: 'for Midweek',
      body: 'Fresh Israeli cooking, colorful salads, and prime meats. We deliver everywhere in Dubai, fresh every single day.',
      cta: 'See the Weekday Menu',
    },
    experiencesSection: {
      badge: 'Exclusive Events & Catering',
      titleTop: 'VIP Culinary Experiences',
      titleAccent: 'Anywhere in Dubai',
      body: 'We come to any spot in Dubai to create an unforgettable event for you. Kosher food at the highest level, elegant presentation, and personal service.',
      cardCta: 'Details & Booking',
      ideaTitle: 'Have Another Idea?',
      ideaBody: "Whatever culinary dream you have in Dubai, we're open to it. Talk to us and we'll make it happen.",
      ideaCta: 'Talk to Us',
    },
    experiences: [
      {
        tag: 'Private BBQ',
        title: 'Private Grill Chef',
        desc: 'A live-fire meat experience at your villa. Expert grilling and fresh salads.',
      },
      {
        tag: 'Yacht Party',
        title: 'Events on a Yacht',
        desc: 'Parties and celebrations out at sea, with gourmet kosher catering and marina views.',
      },
      {
        tag: 'Villa Events',
        title: 'Villa Parties',
        desc: "Full catering for pool parties and social events in Dubai's finest villas.",
      },
      {
        tag: 'Suite Dining',
        title: 'Suite Dining',
        desc: 'Private, intimate chef dinners in hotel suites. A romantic, luxurious experience.',
      },
      {
        tag: 'Desert Safari',
        title: 'VIP Desert Feast',
        desc: 'Luxury open-fire cooking in the heart of the dunes. A desert experience with true home flavors.',
      },
    ],
    testimonialsSection: {
      badge: 'The Wall of Love',
      titleTop: 'What Our',
      titleAccent: 'Guests Are Saying',
    },
    testimonials: [
      {
        quote: '"Simply perfect. The food arrived hot, fresh, and with that taste of home we\'d been missing so much."',
        name: 'Yuval Dayan',
        place: 'Palm Jumeirah Villa',
      },
      {
        quote: '"We celebrated a birthday on a yacht and Lynn produced an incredible culinary event for us. The fish was Michelin-level."',
        name: 'Michal Aharoni',
        place: 'Yacht Party VIP',
      },
      {
        quote: '"As a businessman who travels to Dubai often, finding quality kosher food is a challenge. Bat Melech\'s service saved me."',
        name: 'Daniel Cohen',
        place: 'Business Dining',
      },
    ],
  },
  fr: {
    hero: {
      badge: 'Authentic Home Kitchen',
      title: ['Le goût de la maison', 'au cœur de Dubaï'],
      subtitle: "Une cuisine israélienne authentique, fraîche chaque jour, préparée avec tout notre cœur. La qualité que vous connaissez d'Israël — maintenant pendant vos vacances.",
      imageAlt: 'Cuisine casher faite maison servie à Dubaï — Bat Melech',
      ctaShabbat: 'Composez votre formule de Chabbat parfaite',
      ctaWeekday: 'Menu de semaine',
    },
    story: {
      portraitAlt: 'Lynn — Bat Melech',
      title: 'Mon histoire',
      body:
        "Je suis Lynn, et la cuisine a toujours fait partie de moi. Des kubés maison qui ont conquis Israël jusqu'à notre installation à Dubaï — je suis revenue aux fourneaux avec mon mari pour vous apporter le goût de la maison, casher et frais, même pendant vos vacances.",
      readMore: "Lire toute l'histoire",
    },
    shabbatPromo: {
      badge: 'The Shabbat Experience',
      imageAlt: 'Coffret de Chabbat de luxe pour deux — délices casher de Chabbat à Dubaï',
      titleTop: 'Les délices',
      titleAccent: 'du Chabbat',
      body: "Formules de Kiddouch et somptueux repas de Chabbat livrés jusqu'à vous. Tout ce qu'il faut pour un Chabbat parfait — le goût de la maison, avec une cacherout mehadrin.",
      cta: 'Voir le menu complet de Chabbat',
    },
    weekdayPromo: {
      badge: 'Fresh Daily Meals',
      imageAlt: 'Menu de semaine casher et frais — Bat Melech Dubaï',
      titleTop: 'Un délice',
      titleAccent: 'pour la semaine',
      body: "Cuisine israélienne fraîche, salades colorées et viandes d'exception. Nous livrons partout à Dubaï, chaque jour.",
      cta: 'Voir le menu de semaine',
    },
    experiencesSection: {
      badge: 'Exclusive Events & Catering',
      titleTop: 'Expériences culinaires VIP',
      titleAccent: 'partout à Dubaï',
      body: "Nous nous déplaçons partout à Dubaï pour créer votre événement inoubliable. Une cuisine casher du plus haut niveau, un dressage raffiné et un service personnalisé.",
      cardCta: 'Infos et réservation',
      ideaTitle: 'Une autre idée ?',
      ideaBody: 'Nous sommes ouverts à tous vos rêves culinaires à Dubaï. Parlez-nous-en, nous le réaliserons pour vous.',
      ideaCta: 'Contactez-nous',
    },
    experiences: [
      {
        tag: 'Private BBQ',
        title: 'Chef grillardin privé',
        desc: "L'expérience de la viande au feu de bois, chez vous en villa. Cuisson experte et salades fraîches.",
      },
      {
        tag: 'Yacht Party',
        title: 'Événements sur yacht',
        desc: 'Fêtes et événements en pleine mer, avec un traiteur casher gastronomique et vue sur la Marina.',
      },
      {
        tag: 'Villa Events',
        title: 'Fêtes en villa',
        desc: 'Traiteur complet pour pool parties et événements privés dans les plus belles villas de Dubaï.',
      },
      {
        tag: 'Suite Dining',
        title: 'Dîners en suite',
        desc: "Dîners de chef privés et intimes en suite d'hôtel. Une expérience romantique et raffinée.",
      },
      {
        tag: 'Desert Safari',
        title: 'Festin du désert VIP',
        desc: 'Cuisine de plein air haut de gamme au cœur des dunes. Une expérience du désert aux vrais goûts de la maison.',
      },
    ],
    testimonialsSection: {
      badge: 'The Wall of Love',
      titleTop: 'Ce que disent',
      titleAccent: 'nos invités',
    },
    testimonials: [
      {
        quote: '« Tout simplement parfait. Les plats sont arrivés chauds, frais, avec ce goût de la maison qui nous manquait tant. »',
        name: 'Yuval Dayan',
        place: 'Palm Jumeirah Villa',
      },
      {
        quote: "« Nous avons fêté un anniversaire sur un yacht et Lynn nous a organisé un événement culinaire époustouflant. Le poisson était digne d'un Michelin. »",
        name: 'Michal Aharoni',
        place: 'Yacht Party VIP',
      },
      {
        quote: "« En tant qu'homme d'affaires souvent à Dubaï, trouver une cuisine casher de qualité est un vrai défi. Le service de Bat Melech m'a sauvé. »",
        name: 'Daniel Cohen',
        place: 'Business Dining',
      },
    ],
  },
}

export function Home() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  const storyReveal = useReveal<HTMLElement>()
  const shabbatReveal = useReveal<HTMLElement>()
  const weekdayReveal = useReveal<HTMLElement>()
  const experiencesReveal = useReveal<HTMLElement>()
  const testimonialsReveal = useReveal<HTMLElement>()

  // Direction-dependent presentation: the promo gradients keep the dark side
  // behind the text (reading-start side), and arrows point "forward".
  const rtl = dir === 'rtl'
  const arrowIcon = rtl ? 'ph:arrow-left-bold' : 'ph:arrow-right-bold'
  const arrowHover = rtl ? 'group-hover:-translate-x-2' : 'group-hover:translate-x-2'
  const startGradient = rtl ? 'bg-gradient-to-l' : 'bg-gradient-to-r'
  const endGradient = rtl ? 'bg-gradient-to-r' : 'bg-gradient-to-l'

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 relative overflow-x-hidden" dir={dir}>
      <PageHero
        active="/"
        size="screen"
        badge={t.hero.badge}
        title={t.hero.title as [string, string]}
        subtitle={t.hero.subtitle}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/GQcIcze6r9C.jpeg"
        imageAlt={t.hero.imageAlt}
      >
        <div className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto justify-center mt-4">
          <Link
            to={href('/shabbat-order')}
            className="bg-white text-[#3B151A] px-14 py-7 rounded-full font-black text-2xl shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-4 group"
          >
            <Icon icon="ph:calendar-heart-fill" className="text-3xl group-hover:animate-bounce" />
            {t.hero.ctaShabbat}
          </Link>
          <Link
            to={href('/weekdays')}
            className="bg-[#3B151A] text-white px-14 py-7 rounded-full font-black text-2xl hover:bg-black transition-all flex items-center justify-center shadow-2xl border-2 border-[#EDB2C1]/30"
          >
            {t.hero.ctaWeekday}
          </Link>
        </div>
      </PageHero>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pb-32">
        <HolidayMenuSection />
        <section id="story" ref={storyReveal.ref} className={`mb-32 scroll-mt-24 pt-32 text-center ${storyReveal.className}`}>
          <div className="max-w-4xl mx-auto">
            <div className="mb-16 inline-block">
              <img
                src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/8BFD80FA-B647-4892-88DA-A42D9A482CDF-ednYRxQWIlt.png"
                alt={t.story.portraitAlt}
                className="w-40 h-40 md:w-56 md:h-56 rounded-full border-[12px] border-white shadow-2xl object-cover object-top mx-auto"
              />
            </div>
            <h2 className="text-5xl md:text-7xl font-black font-heading mb-10 tracking-tight">{t.story.title}</h2>
            <div className="space-y-8 text-xl md:text-2xl font-bold leading-relaxed text-[#3B151A]/80">
              <p className="max-w-2xl mx-auto">{t.story.body}</p>
              <div className="pt-10">
                <Link
                  to={href('/story')}
                  className="inline-flex items-center gap-4 text-[#8D182C] font-black text-2xl group border-b-4 border-[#EDB2C1]/30 pb-2 hover:border-[#F5A83A] transition-all"
                >
                  {t.story.readMore} <Icon icon={arrowIcon} className={`${arrowHover} transition-transform`} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="shabbat-promo" ref={shabbatReveal.ref} className={`mb-32 scroll-mt-24 ${shabbatReveal.className}`}>
          <div className="relative h-[30rem] md:h-[40rem] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white group">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/NPPrDqcdlgE.jpeg"
              alt={t.shabbatPromo.imageAlt}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"
            />
            <div className={`absolute inset-0 ${startGradient} from-black/80 via-black/20 to-transparent`} />
            <div className="absolute inset-0 flex flex-col justify-center items-start p-8 md:p-24 text-start">
              <div className="max-w-xl space-y-6 md:space-y-8">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#F5A83A] text-[#3B151A] rounded-full text-xs font-black tracking-widest uppercase">
                  <span>{t.shabbatPromo.badge}</span>
                </div>
                <h2 className="text-4xl md:text-7xl font-black font-heading text-white leading-tight">
                  {t.shabbatPromo.titleTop} <br />
                  <span className="text-[#F5A83A]">{t.shabbatPromo.titleAccent}</span>
                </h2>
                <p className="text-white/80 text-lg md:text-2xl font-bold leading-relaxed">{t.shabbatPromo.body}</p>
                <Link
                  to={href('/shabbat-order')}
                  className="inline-flex items-center gap-4 bg-white text-[#3B151A] px-8 md:px-12 py-4 md:py-6 rounded-full font-black text-lg md:text-2xl hover:bg-[#F5A83A] transition-all shadow-2xl group/btn"
                >
                  {t.shabbatPromo.cta} <Icon icon="ph:calendar-heart-fill" className="text-2xl md:text-3xl group-hover/btn:animate-bounce" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="weekday-promo" ref={weekdayReveal.ref} className={`mb-32 scroll-mt-24 ${weekdayReveal.className}`}>
          <div className="relative h-[30rem] md:h-[40rem] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white group">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/32nv8K7lIKf.jpeg"
              alt={t.weekdayPromo.imageAlt}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"
            />
            <div className={`absolute inset-0 ${endGradient} from-black/80 via-black/20 to-transparent`} />
            <div className="absolute inset-0 flex flex-col justify-center items-end p-8 md:p-24 text-start">
              <div className="max-w-xl space-y-6 md:space-y-8 flex flex-col items-end">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#3B151A] text-[#EDB2C1] rounded-full text-xs font-black tracking-widest uppercase">
                  <span>{t.weekdayPromo.badge}</span>
                </div>
                <h2 className="text-4xl md:text-7xl font-black font-heading text-white leading-tight">
                  {t.weekdayPromo.titleTop} <br />
                  <span className="text-[#EDB2C1]">{t.weekdayPromo.titleAccent}</span>
                </h2>
                <p className="text-white/80 text-lg md:text-2xl font-bold leading-relaxed">{t.weekdayPromo.body}</p>
                <Link
                  to={href('/weekdays')}
                  className="inline-flex items-center gap-4 bg-[#EDB2C1] text-[#3B151A] px-8 md:px-12 py-4 md:py-6 rounded-full font-black text-lg md:text-2xl hover:bg-white transition-all shadow-2xl group/btn"
                >
                  {t.weekdayPromo.cta} <Icon icon="ph:fork-knife-fill" className="text-2xl md:text-3xl group-hover/btn:rotate-12" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="experiences" ref={experiencesReveal.ref} className={`mb-32 scroll-mt-24 ${experiencesReveal.className}`}>
          <div className="mb-16 max-w-3xl">
            <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#3B151A] text-[#F5A83A] rounded-full text-xs font-black tracking-widest uppercase mb-6">
              <span>{t.experiencesSection.badge}</span>
            </div>
            <h2 className="text-4xl md:text-8xl font-black font-heading leading-none mb-8">
              {t.experiencesSection.titleTop} <br />
              <span className="text-[#8D182C]">{t.experiencesSection.titleAccent}</span>
            </h2>
            <p className="text-lg md:text-2xl font-bold text-[#3B151A]/70 leading-relaxed">{t.experiencesSection.body}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {EXPERIENCE_META.map((exp, i) => (
              <Link
                key={exp.to}
                to={href(exp.to)}
                className="group relative h-[28rem] md:h-[35rem] rounded-[3.5rem] overflow-hidden shadow-2xl border-2 border-white block"
              >
                <img src={exp.img} alt={t.experiences[i].title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-[2s] group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                <div className="absolute bottom-10 start-10 end-10">
                  <div className="mb-4 flex items-center gap-3">
                    <Icon icon={exp.icon} className="text-[#F5A83A] text-3xl" />
                    <span className="text-white/60 font-black tracking-widest uppercase text-xs">{t.experiences[i].tag}</span>
                  </div>
                  <h3 className="text-3xl md:text-4xl font-black text-white mb-4 font-heading">{t.experiences[i].title}</h3>
                  <p className="text-white/80 text-sm md:text-base font-bold mb-6">{t.experiences[i].desc}</p>
                  <div className="inline-flex items-center gap-3 bg-white text-[#3B151A] px-8 py-4 rounded-2xl font-black text-lg group-hover:bg-[#F5A83A] transition-all shadow-xl">
                    {t.experiencesSection.cardCta} <Icon icon={arrowIcon} className="text-xl" />
                  </div>
                </div>
              </Link>
            ))}
            <div className="bg-[#3B151A] rounded-[3.5rem] p-10 flex flex-col items-center justify-center text-center border-4 border-[#F5A83A]/30 shadow-2xl">
              <Icon icon="ph:sparkle-fill" className="text-6xl text-[#F5A83A] mb-6 animate-pulse" />
              <h3 className="text-3xl font-black text-white mb-4">{t.experiencesSection.ideaTitle}</h3>
              <p className="text-white/60 font-bold mb-8">{t.experiencesSection.ideaBody}</p>
              <a
                href="https://wa.me/971586288776"
                className="w-full bg-[#F5A83A] text-[#3B151A] py-5 rounded-2xl font-black text-xl hover:bg-white transition-all"
              >
                {t.experiencesSection.ideaCta} <Icon icon="ph:chat-circle-dots-fill" className="inline-block ms-2" />
              </a>
            </div>
          </div>
        </section>

        <section id="testimonials" ref={testimonialsReveal.ref} className={`mb-16 scroll-mt-24 ${testimonialsReveal.className}`}>
          <div className="flex flex-col items-center text-center mb-16">
            <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#F5A83A]/10 text-[#F5A83A] rounded-full text-xs font-black tracking-widest uppercase mb-6">
              <span>{t.testimonialsSection.badge}</span>
            </div>
            <h2 className="text-4xl md:text-8xl font-black font-heading leading-tight">
              {t.testimonialsSection.titleTop} <br />
              <span className="text-[#8D182C]">{t.testimonialsSection.titleAccent}</span>
            </h2>
          </div>
          <div className="flex overflow-x-auto pb-16 hide-scrollbar -mx-6 px-6 gap-8">
            {TESTIMONIAL_META.map((meta, i) => (
              <div key={meta.img} className="shrink-0 w-[85vw] md:w-[28rem]">
                <div className="bg-white rounded-[3.5rem] overflow-hidden shadow-2xl border-4 border-white transition-transform hover:-translate-y-2 duration-500">
                  <div className="aspect-square relative">
                    <img src={meta.img} alt={`${t.testimonials[i].name} - ${t.testimonials[i].place}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#3B151A]/80 to-transparent" />
                    <div className="absolute bottom-8 start-8 end-8 text-white">
                      <div className="flex gap-1 text-[#F5A83A] mb-3">
                        {Array.from({ length: 5 }).map((_, s) => (
                          <Icon key={s} icon="ph:star-fill" />
                        ))}
                      </div>
                      <p className="text-lg font-bold leading-relaxed italic mb-6">{t.testimonials[i].quote}</p>
                      <div className="flex items-center gap-3">
                        <img src={meta.avatar} alt={t.testimonials[i].name} className="w-12 h-12 rounded-full border-2 border-white shadow-lg" />
                        <div className="flex flex-col">
                          <span className="font-black text-sm">{t.testimonials[i].name}</span>
                          <span className="text-[10px] text-white/60 font-bold tracking-widest uppercase">{t.testimonials[i].place}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
