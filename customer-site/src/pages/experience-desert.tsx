import { ExperienceLayout } from '../components/experience-layout'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  tag: 'VIP Desert Dining',
  title: ['סעודת מדבר', 'יוקרתית VIP'] as [string, string],
  body: 'הקסם האמיתי של דובאי קורה תחת הכוכבים. אנו מפיקים סעודות גורמה כשרות בלב המדבר, עם אירוח מסורתי ברמה הגבוהה ביותר, שף פרטי שמבשל בשטח ושולחנות ערוכים בלב הדיונות.',
  bullets: [
    { icon: 'ph:moon-stars-fill', text: 'חוויית בישול שטח גורמה (כשר)' },
    { icon: 'ph:check-circle-fill', text: 'אירוח Majlis מפואר בלב הדיונות' },
    { icon: 'ph:check-circle-fill', text: 'אווירה קסומה מסביב למדורה' },
  ],
  galleryTitle: 'הקסם המדברי',
  galleryAlt: [
    'אירוח Majlis מפואר בלב דיונות המדבר בדובאי',
    'סעודת גורמה כשרה תחת הכוכבים במדבר',
    'שולחנות ערוכים לסעודת מדבר VIP כשרה',
  ] as [string, string, string],
  ctaTitle: 'סעודה בלתי נשכחת',
  ctaBody: 'מוכנים למשהו אחר לגמרי? דברו איתנו לתיאום סעודת המדבר הבאה שלכם.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    tag: 'VIP Desert Dining',
    title: ['A Lavish', 'VIP Desert Feast'],
    body: 'The real magic of Dubai happens under the stars. We produce gourmet kosher feasts deep in the desert — traditional hospitality at the highest level, a private chef cooking on site, and tables set among the dunes.',
    bullets: [
      { icon: 'ph:moon-stars-fill', text: 'A gourmet open-fire cooking experience (kosher)' },
      { icon: 'ph:check-circle-fill', text: 'Lavish Majlis hospitality among the dunes' },
      { icon: 'ph:check-circle-fill', text: 'A magical atmosphere around the campfire' },
    ],
    galleryTitle: 'Desert Magic',
    galleryAlt: [
      'Lavish Majlis hospitality among the desert dunes of Dubai',
      'Gourmet kosher feast under the desert stars',
      'Tables set for a VIP kosher desert feast',
    ],
    ctaTitle: 'A Feast to Remember',
    ctaBody: 'Ready for something completely different? Message us to plan your next desert feast.',
  },
  fr: {
    tag: 'VIP Desert Dining',
    title: ['Dîner Désert', 'Prestige VIP'],
    body: 'La vraie magie de Dubaï opère sous les étoiles. Nous produisons des festins gastronomiques cachers au cœur du désert — un accueil traditionnel de très haut niveau, un chef privé cuisinant sur place et des tables dressées au milieu des dunes.',
    bullets: [
      { icon: 'ph:moon-stars-fill', text: 'Expérience de cuisine gastronomique en plein air (cacher)' },
      { icon: 'ph:check-circle-fill', text: 'Accueil Majlis luxueux au cœur des dunes' },
      { icon: 'ph:check-circle-fill', text: 'Atmosphère magique autour du feu de camp' },
    ],
    galleryTitle: 'La Magie du Désert',
    galleryAlt: [
      'Accueil Majlis luxueux au cœur des dunes du désert de Dubaï',
      'Festin gastronomique cacher sous les étoiles du désert',
      'Tables dressées pour un dîner désert VIP cacher',
    ],
    ctaTitle: 'Un Festin Inoubliable',
    ctaBody: 'Envie de quelque chose de totalement différent ? Contactez-nous pour organiser votre prochain dîner dans le désert.',
  },
}

export function DesertSafariExperience() {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <ExperienceLayout
      content={{
        ...t,
        heroImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/NBoBkJO5uOO.jpeg',
        cornerImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/0z6cLGFdsyI.jpeg',
        gallery: [
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/3NjmofEbSU0.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/hQfhwTbpf9J.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/fbh1mGqHGeE.jpeg',
        ],
      }}
    />
  )
}
