import { ExperienceLayout } from '../components/experience-layout'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  tag: 'Private BBQ Catering',
  title: ['שף מנגליסט', 'VIP עד אליכם'] as [string, string],
  body: 'אנחנו מביאים את חוויית הגריל היוקרתית ביותר לווילה שלכם. שף פרטי שמגיע עם נתחי פרימיום בכשרות מהודרת, מנגל מקצועי ושפע של סלטי בוטיק – הכל נעשה טרי במקום מול העיניים שלכם.',
  bullets: [
    { icon: 'ph:fire-fill', text: 'שף פרטי וצוות שירות מקצועי' },
    { icon: 'ph:check-circle-fill', text: 'נתחי בשר מובחרים (Wagyu & Prime)' },
    { icon: 'ph:check-circle-fill', text: 'כשרות מהודרת ללא פשרות' },
  ],
  galleryTitle: 'הסטנדרט שלנו',
  galleryAlt: [
    'שף מנגליסט פרטי צולה נתחי בשר פרימיום בווילה בדובאי',
    'נתחי בשר כשרים מובחרים לצליה - קייטרינג BBQ פרטי',
    'שולחן ערוך לחוויית גריל VIP כשרה בדובאי',
  ] as [string, string, string],
  ctaTitle: 'בשר משובח בלב דובאי',
  ctaBody: 'מוכנים לחוויית בשרים שתשאיר את כולם פעורי פה? שלחו לנו הודעה ונתאים לכם תפריט שף מושלם.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    tag: 'Private BBQ Catering',
    title: ['VIP Grill Chef', 'at Your Villa'],
    body: 'We bring Dubai’s most luxurious grilling experience to your villa. A private chef arrives with strictly kosher premium cuts, a professional grill, and an abundance of artisanal salads — everything prepared fresh, on site, right before your eyes.',
    bullets: [
      { icon: 'ph:fire-fill', text: 'A private chef and professional service staff' },
      { icon: 'ph:check-circle-fill', text: 'Premium meat cuts (Wagyu & Prime)' },
      { icon: 'ph:check-circle-fill', text: 'Strictly kosher — no compromises' },
    ],
    galleryTitle: 'Our Standard',
    galleryAlt: [
      'Private grill chef searing premium kosher cuts at a Dubai villa',
      'Choice kosher meat cuts for the grill — private BBQ catering',
      'A set table for a VIP kosher BBQ experience in Dubai',
    ],
    ctaTitle: 'Exceptional Meat in the Heart of Dubai',
    ctaBody: 'Ready for a BBQ that leaves everyone speechless? Send us a message and we’ll build your perfect chef’s menu.',
  },
  fr: {
    tag: 'Private BBQ Catering',
    title: ['Chef Grillardin', 'VIP chez vous'],
    body: 'Nous apportons l’expérience de grillades la plus luxueuse jusqu’à votre villa. Un chef privé arrive avec des pièces premium strictement cachères, un barbecue professionnel et une profusion de salades artisanales — tout est préparé frais, sur place, sous vos yeux.',
    bullets: [
      { icon: 'ph:fire-fill', text: 'Chef privé et personnel de service professionnel' },
      { icon: 'ph:check-circle-fill', text: 'Pièces de viande d’élite (Wagyu & Prime)' },
      { icon: 'ph:check-circle-fill', text: 'Cacherout stricte, sans compromis' },
    ],
    galleryTitle: 'Notre Standard',
    galleryAlt: [
      'Chef grillardin privé saisissant des pièces premium cachères dans une villa à Dubaï',
      'Pièces de viande cachères d’exception pour la grillade — traiteur BBQ privé',
      'Table dressée pour une expérience BBQ VIP cachère à Dubaï',
    ],
    ctaTitle: 'Une viande d’exception au cœur de Dubaï',
    ctaBody: 'Envie d’une expérience carnée qui laissera tout le monde sans voix ? Envoyez-nous un message et nous composerons votre menu de chef sur mesure.',
  },
}

export function PrivateBBQExperience() {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <ExperienceLayout
      content={{
        ...t,
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Pqb5NHS9yrn.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/tAiOfOnE1Pu.jpeg',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/bq8wCPGKU11.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/EXGsZ8YfU8c.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/nsSTu1IMHv0.jpeg',
        ],
      }}
    />
  )
}
