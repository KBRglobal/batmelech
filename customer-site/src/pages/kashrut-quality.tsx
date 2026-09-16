import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  badge: 'Kashrut & Premium Quality',
  title: ['כשרות בדובאי', 'ואיך היא נשמרת'],
  heroAlt: 'כשרות מהודרת - מטעמי בת מלך דובאי',
  intro:
    'המטבח שלנו בדובאי עובד תחת אישור פיקוח שוטף של הרב פז קולין, משגיח כשרות מוסמך. זהו מטבח בשרי למהדרין, והבישול לפי שיטת בית יוסף. התעודה המלאה כאן למטה, בתוקף עד אוגוסט 2027.',
  certificateAlt: 'אישור פיקוח כשרות של מטעמי בת מלך בדובאי, חתום על ידי הרב פז קולין',
  cards: [
    {
      icon: 'ph:seal-check-fill',
      title: 'ההשגחה',
      body: 'אישור פיקוח על שם לין אסולין, Bat Melech Kitchen UAE, מטעם הרב פז קולין, משגיח כשרות מוסמך. הפיקוח שוטף ולא חד פעמי.',
    },
    {
      icon: 'ph:chef-hat-fill',
      title: 'מטבח בשרי למהדרין',
      body: 'הבישול לפי שיטת בית יוסף, הבשר חלק בית יוסף והעוף מהדרין. זהו מטבח בשרי בלבד, בלי מוצרי חלב.',
    },
    {
      icon: 'ph:leaf-fill',
      title: 'חומרי גלם',
      body: 'כל חומרי הגלם נבדקים ומאושרים על ידי המשגיח עצמו. ירקות ועלים מנוקים ונבדקים, פירות יער וגוג׳י קפואים בלבד, ודגים עם קשקשים.',
    },
    {
      icon: 'ph:bread-fill',
      title: 'אפייה והפרשת חלה',
      body: 'כל המאפים פת ישראל, והקמחים מנופים בנפה. מפרישים חלה מכל בצק שעולה על 1.200 קילו.',
    },
    {
      icon: 'ph:moon-stars-fill',
      title: 'שבת ומועדים',
      body: 'המקום סגור בשבתות ובמועדי ישראל. אין במטבח חשש חמץ שעבר עליו הפסח ואין חשש חדש.',
    },
    {
      icon: 'ph:truck-fill',
      title: 'משלוח חתום',
      body: 'המזון יוצא בצידניות תרמיות אטומות וחתומות, כדי לשמור על הטמפרטורה, הטריות והכשרות עד הרגע שהוא מגיע אליכם.',
    },
  ],
  faqTitle: 'שאלות נפוצות על הכשרות',
  faq: [
    {
      q: 'האם כל התפריט כשר?',
      a: 'כן. כל המנות מוכנות במטבח בשרי למהדרין בדובאי, תחת אישור הפיקוח של הרב פז קולין. אין יוצא מן הכלל.',
    },
    {
      q: 'באיזו כשרות הבשר והעוף?',
      a: 'הבשר חלק בית יוסף והעוף מהדרין, והבישול עצמו לפי שיטת בית יוסף.',
    },
    {
      q: 'עד מתי התעודה בתוקף?',
      a: 'האישור הנוכחי בתוקף מאוגוסט 2026 עד אוגוסט 2027, ומתחדש. התעודה המלאה מוצגת בעמוד הזה.',
    },
    {
      q: 'איך נשמרת הכשרות במשלוח?',
      a: 'המזון נשלח בצידניות תרמיות אטומות וחתומות, בדובאי ובכל האמירויות, כדי לשמור על הטמפרטורה, הטריות והכשרות עד הרגע שהוא מגיע אליכם.',
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
    title: ['Kashrut in Dubai', 'and How It Is Kept'],
    heroAlt: 'Mehadrin kashrut — Bat Melech Dubai',
    intro:
      'Our Dubai kitchen works under the ongoing supervision of Rabbi Paz Kaulin, a certified kashrut supervisor. It is a mehadrin meat kitchen, cooking to the Beit Yosef standard. The full certificate is below, valid through August 2027.',
    certificateAlt: 'Kashrut supervision certificate for Bat Melech in Dubai, signed by Rabbi Paz Kaulin',
    cards: [
      {
        icon: 'ph:seal-check-fill',
        title: 'The supervision',
        body: 'A supervision certificate issued to Lin Asolin, Bat Melech Kitchen UAE, by Rabbi Paz Kaulin, a certified kashrut supervisor. The supervision is ongoing, not a one-off visit.',
      },
      {
        icon: 'ph:chef-hat-fill',
        title: 'A mehadrin meat kitchen',
        body: 'Cooking follows the Beit Yosef standard, the meat is Beit Yosef chalak and the chicken is mehadrin. This is a meat kitchen only — no dairy products.',
      },
      {
        icon: 'ph:leaf-fill',
        title: 'Ingredients',
        body: 'Every ingredient is checked and approved by the supervisor himself. Vegetables and leaves are cleaned and inspected, berries and goji are frozen only, and fish carry scales.',
      },
      {
        icon: 'ph:bread-fill',
        title: 'Baking and challah',
        body: 'All baking is pat yisrael and the flours are sifted. Challah is separated from any dough over 1.200 kg.',
      },
      {
        icon: 'ph:moon-stars-fill',
        title: 'Shabbat and festivals',
        body: 'The place is closed on Shabbat and Israeli festivals. There is no concern of chametz that passed over Pesach, and none of chadash.',
      },
      {
        icon: 'ph:truck-fill',
        title: 'Sealed delivery',
        body: 'Food leaves in sealed thermal boxes, to hold the temperature, the freshness and the kashrut until the moment it reaches you.',
      },
    ],
    faqTitle: 'Kashrut questions people ask',
    faq: [
      {
        q: 'Is the whole menu kosher?',
        a: 'Yes. Every dish is prepared in a mehadrin meat kitchen in Dubai under Rabbi Paz Kaulin\'s supervision certificate. Without exception.',
      },
      {
        q: 'What certification do the meat and chicken carry?',
        a: 'The meat is Beit Yosef chalak and the chicken is mehadrin; the cooking itself follows the Beit Yosef standard.',
      },
      {
        q: 'How long is the certificate valid?',
        a: 'The current certificate runs from August 2026 to August 2027 and is renewed. The full certificate is shown on this page.',
      },
      {
        q: 'How is kashrut kept during delivery?',
        a: 'Food travels in sealed thermal boxes, in Dubai and across the UAE, holding the temperature, the freshness and the kashrut until it reaches you.',
      },
    ],
    quote: '"Your peace of mind is our mission"',
    outroBody: 'Specific questions about kashrut? We are here to answer all of them.',
    outroCta: 'Ask about kashrut on WhatsApp',
  },
  fr: {
    badge: 'Kashrut & Premium Quality',
    title: ['Cacherout à Dubaï', 'et comment elle est tenue'],
    heroAlt: 'Cacherout mehadrin — Bat Melech Dubaï',
    intro:
      'Notre cuisine à Dubaï travaille sous la supervision continue du rabbin Paz Kaulin, superviseur de cacherout agréé. C’est une cuisine carnée mehadrin, la cuisson suivant la méthode Beit Yossef. Le certificat complet est ci-dessous, valable jusqu’en août 2027.',
    certificateAlt: 'Certificat de supervision cachère de Bat Melech à Dubaï, signé par le rabbin Paz Kaulin',
    cards: [
      {
        icon: 'ph:seal-check-fill',
        title: 'La supervision',
        body: 'Un certificat de supervision délivré à Lin Asolin, Bat Melech Kitchen UAE, par le rabbin Paz Kaulin, superviseur de cacherout agréé. La supervision est continue, pas une visite unique.',
      },
      {
        icon: 'ph:chef-hat-fill',
        title: 'Une cuisine carnée mehadrin',
        body: 'La cuisson suit la méthode Beit Yossef, la viande est halak Beit Yossef et la volaille mehadrin. C’est une cuisine carnée uniquement, sans produits laitiers.',
      },
      {
        icon: 'ph:leaf-fill',
        title: 'Matières premières',
        body: 'Chaque ingrédient est contrôlé et approuvé par le superviseur lui-même. Légumes et feuilles nettoyés et vérifiés, fruits rouges et baies de goji surgelés uniquement, poissons à écailles.',
      },
      {
        icon: 'ph:bread-fill',
        title: 'Pâtisserie et hafrachat challah',
        body: 'Toute la boulangerie est pat yisrael et les farines sont tamisées. La challah est prélevée sur toute pâte de plus de 1,200 kg.',
      },
      {
        icon: 'ph:moon-stars-fill',
        title: 'Chabbat et fêtes',
        body: 'Le lieu est fermé le Chabbat et les jours de fête. Aucun risque de hametz ayant passé Pessah, ni de hadach.',
      },
      {
        icon: 'ph:truck-fill',
        title: 'Livraison scellée',
        body: 'Les plats partent dans des glacières thermiques scellées, pour préserver la température, la fraîcheur et la cacherout jusqu’à votre porte.',
      },
    ],
    faqTitle: 'Questions fréquentes sur la cacherout',
    faq: [
      {
        q: 'Tout le menu est-il casher ?',
        a: 'Oui. Chaque plat est préparé dans une cuisine carnée mehadrin à Dubaï, sous le certificat de supervision du rabbin Paz Kaulin. Sans exception.',
      },
      {
        q: 'Quelle cacherout pour la viande et la volaille ?',
        a: 'La viande est halak Beit Yossef et la volaille mehadrin ; la cuisson elle-même suit la méthode Beit Yossef.',
      },
      {
        q: 'Jusqu’à quand le certificat est-il valable ?',
        a: 'Le certificat actuel court d’août 2026 à août 2027 et se renouvelle. Il est affiché en entier sur cette page.',
      },
      {
        q: 'Comment la cacherout est-elle préservée pendant la livraison ?',
        a: 'Les plats voyagent dans des glacières scellées, à Dubaï et dans tous les Émirats, préservant température, fraîcheur et cacherout jusqu’à vous.',
      },
    ],
    quote: '"Votre tranquillité d’esprit est notre mission"',
    outroBody: 'Des questions précises sur la cacherout ? Nous sommes là pour y répondre.',
    outroCta: 'Poser une question sur WhatsApp',
  },
}

export function KashrutQuality() {
  const { locale, dir } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/kashrut"
        size="compact"
        badge={t.badge}
        title={t.title as [string, string]}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/d31Kxj4sAHE.jpeg"
        imageAlt={t.heroAlt}
      />
      <main id="main" className="pt-10 md:pt-16 pb-16 md:pb-32 max-w-4xl mx-auto px-6">
        <section className="mb-14 md:mb-20 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-[#3B151A] rounded-full text-[#F5A83A] text-5xl mb-8 shadow-2xl">
            <Icon icon="ph:certificate-fill" />
          </div>
          <p className="text-base md:text-xl font-bold text-[#3B151A]/70 leading-relaxed mb-8 md:mb-12">{t.intro}</p>
          <a
            href="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/kashrut-certificate-pk-2026.jpg"
            target="_blank"
            rel="noreferrer"
            className="block rounded-3xl md:rounded-[4rem] overflow-hidden shadow-2xl border-2 md:border-4 border-white mb-12 md:mb-20"
          >
            <img
              src="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/kashrut-certificate-pk-2026.jpg"
              alt={t.certificateAlt}
              className="w-full h-auto"
            />
          </a>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-start">
            {t.cards.map((card) => (
              <InfoCard key={card.title} icon={card.icon} title={card.title}>
                {card.body}
              </InfoCard>
            ))}
          </div>
        </section>
        <section className="mb-20 space-y-8">
          <h2 className="text-3xl md:text-5xl font-black font-heading text-center mb-12">{t.faqTitle}</h2>
          {t.faq.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </section>
        <section className="bg-[#3B151A] p-8 md:p-12 rounded-[2.5rem] md:rounded-[5rem] text-center shadow-2xl">
          <h4 className="text-2xl font-black text-white mb-6 font-heading italic">{t.quote}</h4>
          <p className="text-white/60 font-bold mb-10">{t.outroBody}</p>
          <a
            href="https://wa.me/971586288776"
            className="inline-flex items-center justify-center gap-3 md:gap-4 bg-[#F5A83A] text-[#3B151A] px-8 py-4 md:px-12 md:py-6 rounded-2xl font-black text-lg md:text-xl hover:bg-white transition-all"
          >
            {t.outroCta} <Icon icon="ph:whatsapp-logo-fill" className="text-2xl shrink-0" />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="bg-white p-6 md:p-8 rounded-[2rem] md:rounded-[3rem] border-2 border-[#EDB2C1]/20 shadow-lg text-start">
      <h3 className="text-xl font-black mb-3">{q}</h3>
      <p className="font-bold text-[#3B151A]/70 leading-relaxed">{a}</p>
    </div>
  )
}

function InfoCard({ icon, title, children }: { icon: string; title: string; children: string }) {
  return (
    <div className="bg-white p-7 md:p-10 rounded-[2rem] md:rounded-[3rem] border-2 border-[#EDB2C1]/20 shadow-lg">
      <h3 className="text-2xl font-black mb-4 flex items-center gap-3">
        <Icon icon={icon} className="text-[#F5A83A]" /> {title}
      </h3>
      <p className="font-bold text-[#3B151A]/70 leading-relaxed">{children}</p>
    </div>
  )
}
