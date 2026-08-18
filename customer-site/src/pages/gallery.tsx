import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const PHOTO_URLS = [
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Hgw2QN4Smv3.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/bq8wCPGKU11.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/fbh1mGqHGeE.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Tr7Zvl6EB0X.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/d31Kxj4sAHE.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hqJqmcg5k3O.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/T9Q0QhPImYP.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/XE7I0jbpGOl.jpeg',
]

const HE = {
  badge: 'Our Luxury Moments',
  title: ['הטעם', 'בעיניים'],
  subtitle: 'מבט קרוב על האירועים, המנות והאנשים שהופכים את "בת מלך" לחוויה הקולינרית הכשרה המובילה בדובאי.',
  photoAlts: [
    'אירוע קייטרינג כשר של מטעמי בת מלך בדובאי',
    'בשרים על האש - קייטרינג BBQ כשר בדובאי',
    'שולחן ערוך לאירוח יוקרתי במדבר דובאי',
    'הגשה יוקרתית של מטעמי בת מלך',
    'מנה עיקרית מהתפריט הכשר של מטעמי בת מלך',
    'מטבח ביתי כשר בדובאי - מטעמי בת מלך',
    'רגע מאירועי מטעמי בת מלך בדובאי',
    'הגשת מנות כשרות באירוע VIP בדובאי',
  ],
  ctaTitle: 'בואו להיות חלק מהתמונה',
  ctaBody: 'החופשה הבאה שלכם בדובאי יכולה להיראות ככה. צרו איתנו קשר עוד היום.',
  ctaButton: 'לשיחה אישית בוואטסאפ',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    badge: 'Our Luxury Moments',
    title: ['Taste', 'with Your Eyes'],
    subtitle: 'A close look at the events, the dishes, and the people who make Bat Melech the leading kosher culinary experience in Dubai.',
    photoAlts: [
      'A kosher catering event by Bat Melech in Dubai',
      'Meats on the grill — kosher BBQ catering in Dubai',
      'A table set for luxury hosting in the Dubai desert',
      'Elegant plating by Bat Melech',
      "A main course from Bat Melech's kosher menu",
      'A kosher home kitchen in Dubai — Bat Melech',
      'A moment from Bat Melech events in Dubai',
      'Kosher dishes served at a VIP event in Dubai',
    ],
    ctaTitle: 'Come Be Part of the Picture',
    ctaBody: 'Your next Dubai vacation could look like this. Get in touch today.',
    ctaButton: 'Chat with Us on WhatsApp',
  },
  fr: {
    badge: 'Our Luxury Moments',
    title: ['Le goût', 'par les yeux'],
    subtitle: "Un regard rapproché sur les événements, les plats et les personnes qui font de Bat Melech la première expérience culinaire casher de Dubaï.",
    photoAlts: [
      'Un événement traiteur casher signé Bat Melech à Dubaï',
      'Viandes au feu de bois — traiteur BBQ casher à Dubaï',
      "Une table dressée pour une réception de luxe dans le désert de Dubaï",
      'Dressage raffiné signé Bat Melech',
      'Un plat principal du menu casher de Bat Melech',
      'Une cuisine familiale casher à Dubaï — Bat Melech',
      "Un moment des événements Bat Melech à Dubaï",
      'Service de plats casher lors d\'un événement VIP à Dubaï',
    ],
    ctaTitle: "Venez faire partie de l'image",
    ctaBody: 'Vos prochaines vacances à Dubaï pourraient ressembler à cela. Contactez-nous dès aujourd\'hui.',
    ctaButton: 'Échangez avec nous sur WhatsApp',
  },
}

export function Gallery() {
  const { locale, dir } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir={dir}>
      <PageHero
        active="/gallery"
        size="compact"
        badge={t.badge}
        title={t.title as [string, string]}
        subtitle={t.subtitle}
        image={PHOTO_URLS[0]}
        imageAlt={t.photoAlts[0]}
      />
      <main className="pt-16 max-w-7xl mx-auto px-6">
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {PHOTO_URLS.map((img, i) => (
            <Reveal key={img} delay={(i % 4) * 80} className="break-inside-avoid">
              <img src={img} alt={t.photoAlts[i]} className="w-full rounded-[2rem] shadow-lg border-2 border-white transition-transform hover:scale-[1.02]" />
            </Reveal>
          ))}
        </div>
        <Reveal>
          <section className="mt-32 bg-white p-12 md:p-24 rounded-[5rem] text-center border-2 border-[#EDB2C1]/20 shadow-2xl">
            <h2 className="text-4xl md:text-5xl font-black font-heading mb-8">{t.ctaTitle}</h2>
            <p className="text-[#3B151A]/70 text-xl font-bold mb-12">{t.ctaBody}</p>
            <a
              href="https://wa.me/971586288776"
              className="inline-flex items-center gap-6 bg-[#3B151A] text-white px-16 py-8 rounded-full font-black text-2xl shadow-2xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all transform hover:scale-105"
            >
              {t.ctaButton} <Icon icon="ph:chat-circle-dots-fill" className="text-3xl" />
            </a>
          </section>
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
