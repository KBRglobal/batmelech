import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  title: ['תנאי שימוש', 'ופרטיות'],
  heroAlt: 'מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  terms: {
    title: 'תנאי שימוש',
    intro: 'ברוכים הבאים למטבח "בת מלך" דובאי. השימוש באתר ובשירותי ההזמנות כפוף לתנאים הבאים:',
    items: [
      'הזמנות לשבת יש לבצע עד יום חמישי בשעה 18:00.',
      'הביטול אפשרי עד 24 שעות לפני מועד האספקה.',
      'התשלום מתבצע במעמד ההזמנה או באיסוף, בהתאם לסיכום מראש.',
      'אנו עושים את מירב המאמצים לספק אוכל טרי ואיכותי, אך האחריות על צריכת המזון היא על הלקוח.',
    ],
  },
  privacy: {
    title: 'מדיניות פרטיות',
    intro: 'אנו מכבדים את הפרטיות שלך:',
    items: [
      'הפרטים האישיים (שם, טלפון, כתובת) משמשים למטרת ביצוע ההזמנה והמשלוח בלבד.',
      'איננו מעבירים מידע לצד ג׳ ללא הסכמה מפורשת.',
      'המידע נשמר במערכות מאובטחות לצורך שיפור השירות.',
      'האתר אינו משתמש בעוגיות מעקב או פרסום — רק במה שנדרש כדי לשלוח את ההזמנה בוואטסאפ.',
      'ניתן לבקש בכל עת לעיין, לתקן או למחוק את הפרטים שנשמרו — פנייה בטלפון או בוואטסאפ.',
    ],
  },
  general: {
    title: 'כללי',
    items: [
      'תנאים אלה כפופים לחוקי איחוד האמירויות הערביות.',
      'אנו רשאים לעדכן את התנאים מעת לעת; הגרסה המעודכנת תמיד מתפרסמת בעמוד זה.',
      'אנו שומרים לעצמנו את הזכות לסרב לקבל הזמנה, לרבות בשל אזור משלוח שאינו בטווח השירות.',
    ],
  },
  allergy: {
    title: 'הצהרת אלרגיות',
    body: 'המטבח שלנו מטפל במגוון רכיבים. למרות הזהירות הרבה, ייתכנו עקבות של אלרגנים כגון גלוטן, אגוזים, ביצים ושומשום בכל המנות. לקוחות עם אלרגיות מסכנות חיים מתבקשים לציין זאת בהערות ההזמנה וליצור קשר טלפוני לווידוא.',
  },
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    title: ['Terms of Use', '& Privacy'],
    heroAlt: 'Bat Melech — a kosher home kitchen in Dubai',
    terms: {
      title: 'Terms of Use',
      intro: 'Welcome to Bat Melech Dubai. Use of the site and the ordering services is subject to the following terms:',
      items: [
        'Shabbat orders must be placed by Thursday at 6:00 PM.',
        'Cancellation is possible up to 24 hours before the delivery time.',
        'Payment is made at the time of ordering or at pickup, as agreed in advance.',
        'We make every effort to provide fresh, quality food, but responsibility for consuming the food rests with the customer.',
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      intro: 'We respect your privacy:',
      items: [
        'Personal details (name, phone, address) are used solely to process your order and delivery.',
        'We do not share information with third parties without explicit consent.',
        'Information is stored in secure systems for the purpose of improving the service.',
        'The site does not use tracking or advertising cookies — only what is needed to send your order via WhatsApp.',
        'You may ask at any time to view, correct, or delete the details we keep — just reach out by phone or WhatsApp.',
      ],
    },
    general: {
      title: 'General',
      items: [
        'These terms are governed by the laws of the United Arab Emirates.',
        'We may update these terms from time to time; the current version is always published on this page.',
        'We reserve the right to decline an order, including when the delivery area is outside our service range.',
      ],
    },
    allergy: {
      title: 'Allergy Notice',
      body: 'Our kitchen handles a variety of ingredients. Despite great care, traces of allergens such as gluten, nuts, eggs, and sesame may be present in all dishes. Customers with life-threatening allergies are asked to note this in the order notes and to contact us by phone to confirm.',
    },
  },
  fr: {
    title: ['Conditions', 'et confidentialité'],
    heroAlt: 'Bat Melech — une cuisine familiale casher à Dubaï',
    terms: {
      title: "Conditions d'utilisation",
      intro: "Bienvenue chez Bat Melech Dubaï. L'utilisation du site et des services de commande est soumise aux conditions suivantes :",
      items: [
        'Les commandes pour Chabbat doivent être passées au plus tard le jeudi à 18h00.',
        "L'annulation est possible jusqu'à 24 heures avant la livraison prévue.",
        'Le paiement est effectué au moment de la commande ou au retrait, selon accord préalable.',
        'Nous mettons tout en œuvre pour fournir une cuisine fraîche et de qualité, mais la responsabilité de la consommation incombe au client.',
      ],
    },
    privacy: {
      title: 'Politique de confidentialité',
      intro: 'Nous respectons votre vie privée :',
      items: [
        'Les données personnelles (nom, téléphone, adresse) servent uniquement au traitement de la commande et à la livraison.',
        'Nous ne transmettons aucune information à des tiers sans consentement explicite.',
        "Les informations sont conservées dans des systèmes sécurisés afin d'améliorer le service.",
        "Le site n'utilise pas de cookies de suivi ni de publicité — uniquement ce qui est nécessaire pour envoyer votre commande via WhatsApp.",
        'Vous pouvez à tout moment demander à consulter, corriger ou supprimer les données conservées — par téléphone ou WhatsApp.',
      ],
    },
    general: {
      title: 'Dispositions générales',
      items: [
        'Les présentes conditions sont régies par les lois des Émirats arabes unis.',
        'Nous pouvons mettre à jour ces conditions de temps à autre ; la version en vigueur est toujours publiée sur cette page.',
        "Nous nous réservons le droit de refuser une commande, notamment lorsque la zone de livraison est hors de notre périmètre de service.",
      ],
    },
    allergy: {
      title: 'Déclaration allergènes',
      body: "Notre cuisine manipule des ingrédients variés. Malgré toutes nos précautions, des traces d'allergènes tels que gluten, fruits à coque, œufs et sésame peuvent être présentes dans tous les plats. Les clients présentant des allergies pouvant engager le pronostic vital sont priés de le signaler dans les notes de commande et de nous contacter par téléphone pour confirmation.",
    },
  },
}

export function Legal() {
  const { locale, dir } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/legal"
        size="compact"
        title={t.title as [string, string]}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ZEd1RfEEqbe.jpeg"
        imageAlt={t.heroAlt}
      />
      <main className="max-w-4xl mx-auto px-6 py-8 md:py-16 pb-16 md:pb-24 space-y-10 md:space-y-16 text-start">
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.terms.title}</h2>
          <div className="space-y-3 md:space-y-4 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
            <p>{t.terms.intro}</p>
            <ul className="list-disc ps-6 space-y-2">
              {t.terms.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.privacy.title}</h2>
          <div className="space-y-3 md:space-y-4 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
            <p>{t.privacy.intro}</p>
            <ul className="list-disc ps-6 space-y-2">
              {t.privacy.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.general.title}</h2>
          <div className="space-y-3 md:space-y-4 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
            <ul className="list-disc ps-6 space-y-2">
              {t.general.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
        <section className="bg-[#3B151A] p-7 md:p-10 rounded-[2rem] md:rounded-[3rem] text-white text-start">
          <h2 className="text-2xl font-black font-heading mb-4 text-[#F5A83A]">{t.allergy.title}</h2>
          <p className="text-base md:text-lg font-medium leading-relaxed">{t.allergy.body}</p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
