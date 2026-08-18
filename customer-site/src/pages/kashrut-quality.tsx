import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  badge: 'Kashrut & Premium Quality',
  title: ['כשרות', 'ואיכות'],
  heroAlt: 'כשרות מהודרת - מטעמי בת מלך דובאי',
  intro:
    'אנחנו מבינים שנושא הכשרות הוא הקריטי ביותר עבורכם. לכן, אנו מקפידים על הסטנדרטים המחמירים ביותר, תוך עבודה צמודה עם גופי הכשרות המוכרים והמוערכים ביותר באיחוד האמירויות.',
  certificateAlt: 'תעודת כשרות של מטעמי בת מלך',
  cards: [
    {
      title: 'גופי כשרות',
      body: 'אנו עובדים תחת פיקוח הדוק ובהשגחת רבנים מובילים. כל חומרי הגלם נרכשים מספקים מורשים בלבד.',
    },
    {
      title: 'מטבח נפרד',
      body: 'כל הבישולים מתבצעים במטבח כשר ייעודי ומבודד, עם הפרדה מוחלטת של כלים, משטחי עבודה ותנורים.',
    },
    {
      title: 'חומרי גלם',
      body: 'אנו משתמשים בירקות איכותיים, בשר "חלק" בכשרות מהודרת, ומוצרי חלב מוקפדים. כל מוצר עובר בדיקה דקדקנית.',
    },
    {
      title: 'משלוח מבוקר',
      body: 'המזון נשלח בצידניות תרמיות אטומות וחתומות, כדי להבטיח את הטמפרטורה, הטריות והכשרות עד לרגע ההגעה אליכם.',
    },
  ],
  faqTitle: 'שאלות נפוצות על הכשרות',
  faq: [
    {
      q: 'האם כל התפריט כשר?',
      a: 'כן. כל המנות שלנו מוכנות במטבח כשר ייעודי בדובאי, בהשגחת רבנים ובכשרות מהודרת, ללא יוצא מן הכלל.',
    },
    {
      q: 'איך נשמרת הכשרות במשלוח?',
      a: 'המזון נשלח בצידניות תרמיות אטומות וחתומות, כדי לשמור על הטמפרטורה, הטריות והכשרות עד לרגע ההגעה אליכם, בכל רחבי דובאי.',
    },
    {
      q: 'מאיפה מגיעים חומרי הגלם?',
      a: 'כל חומרי הגלם נרכשים מספקים מורשים בלבד - ירקות איכותיים, בשר "חלק" בכשרות מהודרת ומוצרי חלב מוקפדים, העוברים בדיקה דקדקנית.',
    },
  ],
  quote: '"השקט הנפשי שלכם הוא המשימה שלנו"',
  outroBody: 'יש לכם שאלות ספציפיות על הכשרות? אנחנו כאן לענות על הכל.',
  outroCta: 'לבירור כשרות בוואטסאפ',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    badge: 'Kashrut & Premium Quality',
    title: ['Kashrut', '& Quality'],
    heroAlt: 'Mehadrin kashrut — Bat Melech Dubai',
    intro:
      "We understand that kashrut is the most critical thing for you. That's why we hold ourselves to the strictest standards, working closely with the most recognized and respected kashrut authorities in the UAE.",
    certificateAlt: 'Bat Melech kashrut certificate',
    cards: [
      {
        title: 'Kashrut Supervision',
        body: 'We operate under close supervision and the hashgacha of leading rabbis. All ingredients are purchased from certified suppliers only.',
      },
      {
        title: 'A Dedicated Kitchen',
        body: 'All cooking takes place in a dedicated, separate kosher kitchen, with complete separation of utensils, work surfaces, and ovens.',
      },
      {
        title: 'Ingredients',
        body: 'We use quality vegetables, glatt ("chalak") meat with mehadrin certification, and carefully selected dairy products. Every item is meticulously checked.',
      },
      {
        title: 'Controlled Delivery',
        body: 'Food is delivered in sealed, tamper-evident thermal coolers, guaranteeing temperature, freshness, and kashrut until the moment it reaches you.',
      },
    ],
    faqTitle: 'Kashrut FAQ',
    faq: [
      {
        q: 'Is the entire menu kosher?',
        a: 'Yes. Every one of our dishes is prepared in a dedicated kosher kitchen in Dubai, under rabbinic supervision and mehadrin kashrut — no exceptions.',
      },
      {
        q: 'How is kashrut maintained during delivery?',
        a: 'Food is delivered in sealed, tamper-evident thermal coolers, preserving temperature, freshness, and kashrut until the moment it reaches you, anywhere in Dubai.',
      },
      {
        q: 'Where do the ingredients come from?',
        a: 'All ingredients are purchased from certified suppliers only — quality vegetables, glatt ("chalak") meat with mehadrin certification, and carefully selected dairy products, all meticulously checked.',
      },
    ],
    quote: '"Your peace of mind is our mission"',
    outroBody: "Have specific questions about our kashrut? We're here to answer everything.",
    outroCta: 'Ask About Kashrut on WhatsApp',
  },
  fr: {
    badge: 'Kashrut & Premium Quality',
    title: ['Cacherout', 'et qualité'],
    heroAlt: 'Cacherout mehadrin — Bat Melech Dubaï',
    intro:
      "Nous savons que la cacherout est pour vous le point le plus essentiel. C'est pourquoi nous respectons les normes les plus strictes, en travaillant en étroite collaboration avec les organismes de cacherout les plus reconnus et respectés des Émirats.",
    certificateAlt: 'Certificat de cacherout de Bat Melech',
    cards: [
      {
        title: 'Surveillance rabbinique',
        body: "Nous travaillons sous un contrôle rigoureux et la surveillance de rabbanim de premier plan. Toutes les matières premières proviennent exclusivement de fournisseurs agréés.",
      },
      {
        title: 'Une cuisine dédiée',
        body: "Toute la cuisine se fait dans une cuisine casher dédiée et isolée, avec une séparation totale des ustensiles, des plans de travail et des fours.",
      },
      {
        title: 'Matières premières',
        body: "Nous utilisons des légumes de qualité, de la viande « halak » avec une cacherout mehadrin et des produits laitiers rigoureusement sélectionnés. Chaque produit est minutieusement contrôlé.",
      },
      {
        title: 'Livraison contrôlée',
        body: "Les plats sont livrés dans des glacières thermiques hermétiques et scellées, afin de garantir la température, la fraîcheur et la cacherout jusqu'à leur arrivée chez vous.",
      },
    ],
    faqTitle: 'Questions fréquentes sur la cacherout',
    faq: [
      {
        q: 'Tout le menu est-il casher ?',
        a: "Oui. Tous nos plats sont préparés dans une cuisine casher dédiée à Dubaï, sous surveillance rabbinique et avec une cacherout mehadrin, sans aucune exception.",
      },
      {
        q: 'Comment la cacherout est-elle préservée pendant la livraison ?',
        a: "Les plats sont livrés dans des glacières thermiques hermétiques et scellées, afin de préserver la température, la fraîcheur et la cacherout jusqu'à leur arrivée chez vous, partout à Dubaï.",
      },
      {
        q: "D'où viennent les matières premières ?",
        a: "Toutes les matières premières proviennent exclusivement de fournisseurs agréés — des légumes de qualité, de la viande « halak » avec une cacherout mehadrin et des produits laitiers rigoureusement sélectionnés, tous minutieusement contrôlés.",
      },
    ],
    quote: "« Votre tranquillité d'esprit est notre mission »",
    outroBody: 'Vous avez des questions précises sur la cacherout ? Nous sommes là pour répondre à tout.',
    outroCta: 'Questions cacherout sur WhatsApp',
  },
}

export function KashrutQuality() {
  const { locale, dir } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir={dir}>
      <PageHero
        active="/kashrut"
        size="compact"
        badge={t.badge}
        title={t.title as [string, string]}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/d31Kxj4sAHE.jpeg"
        imageAlt={t.heroAlt}
      />
      <main className="pt-16 max-w-4xl mx-auto px-6">
        <section className="mb-20 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-[#3B151A] rounded-full text-[#F5A83A] text-5xl mb-8 shadow-2xl">
            <Icon icon="ph:certificate-fill" />
          </div>
          <p className="text-xl font-bold text-[#3B151A]/70 leading-relaxed mb-12">{t.intro}</p>
          <div className="rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white aspect-video mb-20">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7zzOf0cSMJb.jpeg"
              alt={t.certificateAlt}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-start">
            <InfoCard icon="ph:seal-check-fill" title={t.cards[0].title}>
              {t.cards[0].body}
            </InfoCard>
            <InfoCard icon="ph:chef-hat-fill" title={t.cards[1].title}>
              {t.cards[1].body}
            </InfoCard>
            <InfoCard icon="ph:leaf-fill" title={t.cards[2].title}>
              {t.cards[2].body}
            </InfoCard>
            <InfoCard icon="ph:truck-fill" title={t.cards[3].title}>
              {t.cards[3].body}
            </InfoCard>
          </div>
        </section>
        <section className="mb-20 space-y-8">
          <h2 className="text-3xl md:text-5xl font-black font-heading text-center mb-12">{t.faqTitle}</h2>
          {t.faq.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </section>
        <section className="bg-[#3B151A] p-12 rounded-[5rem] text-center shadow-2xl">
          <h4 className="text-2xl font-black text-white mb-6 font-heading italic">{t.quote}</h4>
          <p className="text-white/60 font-bold mb-10">{t.outroBody}</p>
          <a
            href="https://wa.me/971586288776"
            className="inline-flex items-center gap-4 bg-[#F5A83A] text-[#3B151A] px-12 py-6 rounded-2xl font-black text-xl hover:bg-white transition-all"
          >
            {t.outroCta} <Icon icon="ph:whatsapp-logo-fill" className="text-2xl" />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="bg-white p-8 rounded-[3rem] border-2 border-[#EDB2C1]/20 shadow-lg text-start">
      <h3 className="text-xl font-black mb-3">{q}</h3>
      <p className="font-bold text-[#3B151A]/70 leading-relaxed">{a}</p>
    </div>
  )
}

function InfoCard({ icon, title, children }: { icon: string; title: string; children: string }) {
  return (
    <div className="bg-white p-10 rounded-[3rem] border-2 border-[#EDB2C1]/20 shadow-lg">
      <h3 className="text-2xl font-black mb-4 flex items-center gap-3">
        <Icon icon={icon} className="text-[#F5A83A]" /> {title}
      </h3>
      <p className="font-bold text-[#3B151A]/70 leading-relaxed">{children}</p>
    </div>
  )
}
