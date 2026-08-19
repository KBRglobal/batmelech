import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'
import { Footer } from '../components/footer'
import { useSiteCatalog, type CatalogDish } from '../catalog-context'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

const PHOTO_URLS = [
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Hgw2QN4Smv3.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/bq8wCPGKU11.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/fbh1mGqHGeE.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/Tr7Zvl6EB0X.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/d31Kxj4sAHE.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/hqJqmcg5k3O.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/T9Q0QhPImYP.jpeg',
  'https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/xE7I0jbpGOl.jpeg',
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
  kitchenTitle: 'מהמטבח שלנו',
  kitchenSubtitle: 'המנות עצמן, בתמונות אמיתיות — ישר מהתפריט החי שלנו.',
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
    kitchenTitle: 'From Our Kitchen',
    kitchenSubtitle: 'The dishes themselves, in real photos — straight from our live menu.',
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
    kitchenTitle: 'De notre cuisine',
    kitchenSubtitle: 'Les plats eux-mêmes, en photos réelles — directement de notre menu en direct.',
    ctaTitle: "Venez faire partie de l'image",
    ctaBody: 'Vos prochaines vacances à Dubaï pourraient ressembler à cela. Contactez-nous dès aujourd\'hui.',
    ctaButton: 'Échangez avec nous sur WhatsApp',
  },
}

export function Gallery() {
  const { locale, dir } = useLocale()
  const { catalog } = useSiteCatalog()
  const t = COPY[locale]

  // Every live-catalog dish that has a photo, in the admin's menu order,
  // deduplicated by canonical name. No catalog (or no photos) — no section.
  const kitchenDishes = useMemo<CatalogDish[]>(() => {
    if (catalog === null) return []
    const seen = new Set<string>()
    const dishes: CatalogDish[] = []
    for (const list of [...Object.values(catalog.categories), catalog.extras]) {
      for (const dish of list) {
        if (dish.imageUrl === null || seen.has(dish.name)) continue
        seen.add(dish.name)
        dishes.push(dish)
      }
    }
    return dishes
  }, [catalog])

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/gallery"
        size="compact"
        badge={t.badge}
        title={t.title as [string, string]}
        subtitle={t.subtitle}
        image={PHOTO_URLS[0]}
        imageAlt={t.photoAlts[0]}
      />
      <main className="pt-10 md:pt-16 pb-16 md:pb-32 max-w-7xl mx-auto px-6">
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {PHOTO_URLS.map((img, i) => (
            <Reveal key={img} delay={(i % 4) * 80} className="break-inside-avoid">
              <img src={img} alt={t.photoAlts[i]} className="w-full rounded-xl md:rounded-[2rem] shadow-lg border-2 border-white transition-transform hover:scale-[1.02]" />
            </Reveal>
          ))}
        </div>
        {kitchenDishes.length > 0 && (
          <section className="mt-32">
            <Reveal>
              <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-black font-heading mb-4">{t.kitchenTitle}</h2>
                <p className="text-[#3B151A]/60 text-lg font-bold max-w-2xl mx-auto">{t.kitchenSubtitle}</p>
              </div>
            </Reveal>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {kitchenDishes.map((dish, i) => (
                <Reveal key={dish.name} delay={(i % 4) * 80}>
                  <figure className="bg-white rounded-[2rem] overflow-hidden shadow-lg border-2 border-white transition-transform hover:scale-[1.02] h-full">
                    <img
                      src={dish.imageUrl ?? undefined}
                      alt={dishName(dish.name, locale)}
                      loading="lazy"
                      className="w-full aspect-square object-cover"
                    />
                    <figcaption className="p-4 md:p-5">
                      <h3 className="font-black text-sm md:text-base leading-tight" dir="auto">{dishName(dish.name, locale)}</h3>
                      {dish.description !== '' && (
                        <p className="text-[#3B151A]/50 font-bold text-xs md:text-sm mt-1 leading-snug" dir="auto">{dish.description}</p>
                      )}
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </section>
        )}
        <Reveal>
          <section className="mt-16 md:mt-32 bg-white p-8 md:p-24 rounded-[2.5rem] md:rounded-[5rem] text-center border-2 border-[#EDB2C1]/20 shadow-2xl">
            <h2 className="text-3xl md:text-5xl font-black font-heading mb-4 md:mb-8">{t.ctaTitle}</h2>
            <p className="text-[#3B151A]/70 text-base md:text-xl font-bold mb-8 md:mb-12">{t.ctaBody}</p>
            <a
              href="https://wa.me/971586288776"
              className="inline-flex items-center justify-center gap-3 md:gap-6 bg-[#3B151A] text-white px-8 py-4 md:px-16 md:py-8 rounded-2xl md:rounded-full font-black text-lg md:text-2xl shadow-2xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all transform hover:scale-105"
            >
              {t.ctaButton} <Icon icon="ph:chat-circle-dots-fill" className="text-2xl md:text-3xl shrink-0" />
            </a>
          </section>
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
