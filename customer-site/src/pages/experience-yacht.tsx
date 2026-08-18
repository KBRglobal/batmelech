import { ExperienceLayout } from '../components/experience-layout'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  tag: 'Luxury Yacht Events',
  title: ['חווית יוקרה', 'על היאכטה'] as [string, string],
  body: 'הפלגה בלב ים היא חוויה מדהימה, אבל עם הקייטרינג שלנו היא הופכת לאירוע של פעם בחיים. אנו מציעים תפריטי דגים, סלטים טריים ומגשי אירוח יוקרתיים בכשרות מהודרת, המותאמים במיוחד לאווירת הים והשמש.',
  bullets: [
    { icon: 'ph:anchor-fill', text: 'תפריט דגים וסושי כשר ויוקרתי' },
    { icon: 'ph:check-circle-fill', text: 'שירות אישי ומלצרים על הסיפון' },
    { icon: 'ph:check-circle-fill', text: 'הגשה מעוצבת וכלים יוקרתיים' },
  ],
  galleryTitle: 'רגעי קסם בים',
  galleryAlt: [
    'קייטרינג גורמה כשר על יאכטה בדובאי',
    'הגשה מעוצבת ליד המרינה - קייטרינג יאכטה',
    'אירוע יאכטה פרטי עם קייטרינג כשר יוקרתי',
  ] as [string, string, string],
  ctaTitle: 'מפליגים בטעם שלכם',
  ctaBody: 'אנחנו כאן כדי להפוך את ההפלגה הבאה שלכם לחוויה קולינרית מושלמת. דברו איתנו להצעת מחיר.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    tag: 'Luxury Yacht Events',
    title: ['A Luxury Experience', 'on the Yacht'],
    body: 'Sailing the open sea is unforgettable on its own — with our catering, it becomes a once-in-a-lifetime event. We offer fish menus, fresh salads, and elegant hospitality platters, all strictly kosher and designed for the sun-and-sea setting.',
    bullets: [
      { icon: 'ph:anchor-fill', text: 'A luxury kosher fish and sushi menu' },
      { icon: 'ph:check-circle-fill', text: 'Personal service with waitstaff on deck' },
      { icon: 'ph:check-circle-fill', text: 'Styled plating and elegant tableware' },
    ],
    galleryTitle: 'Magic Moments at Sea',
    galleryAlt: [
      'Gourmet kosher catering aboard a yacht in Dubai',
      'Styled plating by the marina — yacht catering',
      'Private yacht event with luxury kosher catering',
    ],
    ctaTitle: 'Set Sail, Your Way',
    ctaBody: 'We’re here to turn your next cruise into a flawless culinary experience. Message us for a quote.',
  },
  fr: {
    tag: 'Luxury Yacht Events',
    title: ['Expérience de Luxe', 'sur le Yacht'],
    body: 'Naviguer en pleine mer est déjà une expérience incroyable — avec notre traiteur, elle devient un événement unique. Nous proposons des menus de poisson, des salades fraîches et des plateaux de réception prestigieux, strictement cachers et pensés pour l’ambiance marine.',
    bullets: [
      { icon: 'ph:anchor-fill', text: 'Menu poisson et sushi cacher de luxe' },
      { icon: 'ph:check-circle-fill', text: 'Service personnalisé et serveurs à bord' },
      { icon: 'ph:check-circle-fill', text: 'Présentation soignée et vaisselle de luxe' },
    ],
    galleryTitle: 'Moments magiques en mer',
    galleryAlt: [
      'Traiteur gastronomique cacher à bord d’un yacht à Dubaï',
      'Présentation soignée près de la marina — traiteur sur yacht',
      'Événement privé sur yacht avec traiteur cacher de luxe',
    ],
    ctaTitle: 'Naviguez selon vos goûts',
    ctaBody: 'Nous sommes là pour transformer votre prochaine croisière en une expérience culinaire parfaite. Contactez-nous pour un devis.',
  },
}

export function YachtPartyExperience() {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <ExperienceLayout
      content={{
        ...t,
        heroImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/sjRUzhRX09D.jpeg',
        cornerImg: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Tr7Zvl6EB0X.jpeg',
        gallery: [
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ciDIhEK0crg.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/s3QaubcTbIN.jpeg',
          'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/OIC46tu7QUo.jpeg',
        ],
      }}
    />
  )
}
