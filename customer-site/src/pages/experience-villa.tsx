import { ExperienceLayout } from '../components/experience-layout'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  tag: 'Villa & Pool Catering',
  title: ['מסיבות', 'בוילה פרטית'] as [string, string],
  body: 'אירוע בוילה הוא תמיד מיוחד, אבל עם הקייטרינג שלנו הוא הופך לבלתי נשכח. אנו מציעים פתרונות הסעדה מלאים הכוללים בופט עשיר, עמדות שף פעילות ושירות VIP, הכל בכשרות מהודרת ובטעם של בית.',
  bullets: [
    { icon: 'ph:drop-half-bottom-fill', text: 'בופט יוקרתי ומעוצב לצד הבריכה' },
    { icon: 'ph:check-circle-fill', text: 'צוות הפקה ומלצרים מקצועי' },
    { icon: 'ph:check-circle-fill', text: 'תפריט בהתאמה אישית לכל אירוע' },
  ],
  galleryTitle: 'האירועים שלנו',
  galleryAlt: [
    'בופט קייטרינג יוקרתי לצד הבריכה בוילה בדובאי',
    'מסיבת וילה עם קייטרינג כשר מלא',
    'הגשת מנות בוטיק באירוע וילה פרטי',
  ] as [string, string, string],
  ctaTitle: 'חגיגה שלא תישכח',
  ctaBody: 'הופכים כל וילה למסעדת יוקרה. צרו איתנו קשר לתיאום האירוע שלכם.',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    tag: 'Villa & Pool Catering',
    title: ['Private Villa', 'Parties'],
    body: 'A villa event is always special — with our catering, it becomes unforgettable. We offer complete catering solutions: a lavish buffet, live chef stations, and VIP service, all strictly kosher and full of homestyle flavor.',
    bullets: [
      { icon: 'ph:drop-half-bottom-fill', text: 'An elegant, beautifully styled buffet by the pool' },
      { icon: 'ph:check-circle-fill', text: 'A professional production and service team' },
      { icon: 'ph:check-circle-fill', text: 'A custom menu for every event' },
    ],
    galleryTitle: 'Our Events',
    galleryAlt: [
      'Luxury catering buffet by the pool at a Dubai villa',
      'Villa party with full kosher catering',
      'Boutique plated dishes at a private villa event',
    ],
    ctaTitle: 'A Celebration to Remember',
    ctaBody: 'We turn any villa into a fine-dining destination. Reach out to plan your event.',
  },
  fr: {
    tag: 'Villa & Pool Catering',
    title: ['Fêtes en', 'Villa Privée'],
    body: 'Un événement en villa est toujours spécial — avec notre traiteur, il devient inoubliable. Nous proposons des solutions de restauration complètes : buffet généreux, stations de chef en direct et service VIP, le tout strictement cacher avec le goût de la maison.',
    bullets: [
      { icon: 'ph:drop-half-bottom-fill', text: 'Buffet de luxe au bord de la piscine' },
      { icon: 'ph:check-circle-fill', text: 'Équipe de production et serveurs professionnels' },
      { icon: 'ph:check-circle-fill', text: 'Menu personnalisé pour chaque événement' },
    ],
    galleryTitle: 'Nos Événements',
    galleryAlt: [
      'Buffet traiteur de luxe au bord de la piscine d’une villa à Dubaï',
      'Fête en villa avec traiteur cacher complet',
      'Plats raffinés servis lors d’un événement privé en villa',
    ],
    ctaTitle: 'Une célébration inoubliable',
    ctaBody: 'Nous transformons chaque villa en restaurant de luxe. Contactez-nous pour organiser votre événement.',
  },
}

export function VillaPartyExperience() {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <ExperienceLayout
      content={{
        ...t,
        heroImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/T9Q0QhPImYP.jpeg',
        cornerImg: 'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/hqJqmcg5k3O.jpeg',
        gallery: [
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Ows6YIFL56o.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Lh0FCekcbt7.jpeg',
          'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/twpm8363MgJ.jpeg',
        ],
      }}
    />
  )
}
