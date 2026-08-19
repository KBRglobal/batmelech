import { ExperienceLayout } from '../components/experience-layout'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  tag: 'Private Suite Dining',
  title: ['ארוחת שף', 'בסוויטה הפרטית'] as [string, string],
  body: 'אין דבר יוקרתי יותר מארוחת גורמה אישית המוגשת בסוויטה שלכם. אנו מביאים את חווית מסעדת המישלן אליכם, עם שף פרטי שמבשל ומגיש מנות יצירתיות, כשרות ומרשימות מול הנוף הפנורמי של דובאי.',
  bullets: [
    { icon: 'ph:sparkle-fill', text: 'חווית Fine Dining פרטית ואינטימית' },
    { icon: 'ph:check-circle-fill', text: 'שף פרטי צמוד והגשה אישית' },
    { icon: 'ph:check-circle-fill', text: 'תפריט בהתאמה אישית מלאה' },
  ],
  galleryTitle: 'רגעי יוקרה',
  galleryAlt: [
    'ארוחת שף פרטית וכשרה בסוויטת מלון בדובאי',
    'הגשה אינטימית ורומנטית בסוויטה פרטית',
    'מנת גורמה כשרה מוגשת מול נוף דובאי',
  ] as [string, string, string],
  ctaTitle: 'אינטימיות וטעם ללא פשרות',
  ctaBody: 'הופכים כל סוויטה לחוויה קולינרית יוצאת דופן. דברו איתנו עכשיו.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    tag: 'Private Suite Dining',
    title: ['A Chef’s Dinner', 'in Your Private Suite'],
    body: 'Nothing is more luxurious than a personal gourmet dinner served in your own suite. We bring a Michelin-caliber dining experience to you, with a private chef cooking and serving creative, impressive kosher courses against Dubai’s panoramic skyline.',
    bullets: [
      { icon: 'ph:sparkle-fill', text: 'A private, intimate fine-dining experience' },
      { icon: 'ph:check-circle-fill', text: 'A dedicated private chef with personal service' },
      { icon: 'ph:check-circle-fill', text: 'A fully personalized menu' },
    ],
    galleryTitle: 'Moments of Luxury',
    galleryAlt: [
      'Private kosher chef dinner in a Dubai hotel suite',
      'Intimate, romantic table service in a private suite',
      'Kosher gourmet course served against the Dubai skyline',
    ],
    ctaTitle: 'Intimacy and Flavor, Without Compromise',
    ctaBody: 'We turn any suite into an extraordinary culinary experience. Message us today.',
  },
  fr: {
    tag: 'Private Suite Dining',
    title: ['Dîner de Chef', 'en Suite Privée'],
    body: 'Rien n’est plus luxueux qu’un dîner gastronomique personnel servi dans votre suite. Nous vous apportons l’expérience d’un restaurant étoilé, avec un chef privé qui cuisine et sert des plats créatifs, cachers et impressionnants face à la vue panoramique de Dubaï.',
    bullets: [
      { icon: 'ph:sparkle-fill', text: 'Expérience Fine Dining privée et intime' },
      { icon: 'ph:check-circle-fill', text: 'Chef privé dédié et service personnalisé' },
      { icon: 'ph:check-circle-fill', text: 'Menu entièrement personnalisé' },
    ],
    galleryTitle: 'Moments de Luxe',
    galleryAlt: [
      'Dîner de chef privé et cacher dans une suite d’hôtel à Dubaï',
      'Service intime et romantique en suite privée',
      'Plat gastronomique cacher servi face à la vue de Dubaï',
    ],
    ctaTitle: 'Intimité et saveurs sans compromis',
    ctaBody: 'Nous transformons chaque suite en une expérience culinaire d’exception. Parlez-nous dès maintenant.',
  },
}

export function SuiteDiningExperience() {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <ExperienceLayout
      content={{
        ...t,
        heroImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/7LwAsxOnwJr.jpeg',
        cornerImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/eOOVHEcx5tD.jpeg',
        gallery: [
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/xE7I0jbpGOl.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/SuJ0WdhHMRh.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ktV7lQAiCxj.jpeg',
        ],
      }}
    />
  )
}
