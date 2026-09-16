import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

// The privacy policy, on its own page because terms and privacy answer
// different questions and a reader looking for one should not have to read the
// other. The processor list below is the real one — every company that touches
// a customer's details on the way to a delivered meal. Anyone who adds or
// removes a service the site depends on updates this list and the date.

const LAST_UPDATED = '16.09.2026'

const HE = {
  title: ['מדיניות', 'פרטיות'],
  heroAlt: 'מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  termsLink: 'לתנאי השימוש',
  sections: [
    {
      title: 'מי אחראי על המידע',
      items: [
        'החברה שמפעילה את האתר היא Bat Melech For Ready-made Meals & Dishes Preparation L.L.C, רישיון מסחרי 1624395, משרד רשום ב-Office M_08, Naif, Deira, Dubai.',
        'לכל פנייה בנושא המידע שלכם: וואטסאפ או טלפון 971586288776+. אנחנו עונים בתוך יום עסקים.',
      ],
    },
    {
      title: 'לפי איזה חוק',
      items: [
        'המידע מנוהל לפי חוק הגנת המידע האישי של איחוד האמירויות, מרסום פדרלי מספר 45 משנת 2021.',
        'גם מי שנמצא בישראל או באירופה יכול לבקש מאיתנו בדיוק את אותם דברים: לראות, לתקן ולמחוק.',
      ],
    },
    {
      title: 'איזה מידע נאסף',
      items: [
        'שם, טלפון וכתובת מסירה — כדי להגיע אליכם עם ההזמנה.',
        'תוכן ההזמנה, המחיר והמועד, וכן מה שכתבתם לנו בצ׳אט באתר או בוואטסאפ.',
        'אין באתר הרשמה, אין סיסמה, ולא מקלידים בו פרטי כרטיס אשראי.',
        'לספירת מבקרים אנונימית נאספים נתוני ביקור כלליים, בלי עוגיות ובלי זיהוי.',
      ],
    },
    {
      title: 'למה משתמשים בו',
      items: [
        'לבשל ולמסור את ההזמנה, ולעדכן אתכם בדרך.',
        'לענות על שאלות לפני ואחרי ההזמנה.',
        'להוציא חשבונית ולנהל את הספרים של העסק.',
        'איננו מוכרים מידע ואיננו מעבירים אותו לפרסום.',
      ],
    },
    {
      title: 'מי עוד רואה אותו בשבילנו',
      items: [
        'וואטסאפ, של Meta — ההודעות שאתם שולחים אלינו עוברות דרכה.',
        'טלגרם — ההזמנה מגיעה לצוות המטבח ולשליח דרך הודעה פנימית.',
        'Railway — השרתים שעליהם רצים האתר ומערכת ההזמנות.',
        'Cloudflare — הדומיין, הגשת האתר, אחסון התמונות וספירת המבקרים.',
        'OpenAI — הצ׳אט באתר והקריאה של הזמנות שמגיעות בטקסט חופשי. מה שמקלידים בצ׳אט נשלח לשם כדי להרכיב את התשובה.',
        'Resend — שליחת מיילים של אישור וחשבונית.',
        'כל אחד מהם מקבל רק את מה שדרוש לו, ורק כדי לבצע את השירות עבורנו.',
      ],
    },
    {
      title: 'כמה זמן נשמר',
      items: [
        'פרטי ההזמנה נשמרים כל עוד הם דרושים לשירות ולניהול הספרים של העסק.',
        'הצ׳אט באתר זוכר רק חלון קצר של השיחה האחרונה, לא היסטוריה מלאה.',
        'אפשר לבקש מחיקה בכל רגע, ונמחק מה שאיננו חייבים לשמור בחוק.',
      ],
    },
    {
      title: 'מה מותר לכם לבקש',
      items: [
        'לראות איזה מידע יש עליכם אצלנו.',
        'לתקן פרט שגוי.',
        'למחוק את הפרטים.',
        'לבקש שנפסיק לפנות אליכם.',
        'הבקשה נעשית בוואטסאפ או בטלפון, ואנחנו עונים בתוך יום עסקים.',
      ],
    },
    {
      title: 'עוגיות ואחסון בדפדפן',
      items: [
        'אין באתר עוגיות מעקב ואין עוגיות פרסום.',
        'הדפדפן שלכם שומר מקומית את בחירת השפה ואת העגלה, כדי שלא יימחקו כשעוברים עמוד. המידע הזה נשאר אצלכם.',
      ],
    },
    {
      title: 'ילדים ושינויים',
      items: [
        'האתר אינו מיועד לילדים ואיננו אוספים מידע ביודעין על מי שמתחת לגיל 18.',
        'אם המדיניות תשתנה, הגרסה המעודכנת תתפרסם בעמוד הזה עם תאריך חדש.',
      ],
    },
  ],
  updated: 'עודכן לאחרונה בתאריך',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    title: ['Privacy', 'Policy'],
    heroAlt: 'Bat Melech — a kosher home kitchen in Dubai',
    termsLink: 'Read the terms of service',
    sections: [
      {
        title: 'Who is responsible for your details',
        items: [
          'The company behind this site is Bat Melech For Ready-made Meals & Dishes Preparation L.L.C, commercial licence 1624395, registered office at Office M_08, Naif, Deira, Dubai.',
          'For anything about your details: WhatsApp or phone +971586288776. We answer within one business day.',
        ],
      },
      {
        title: 'The law we work under',
        items: [
          'Your details are handled under the UAE Personal Data Protection Law, Federal Decree-Law No. 45 of 2021.',
          'If you are in Israel or in Europe you may ask us for exactly the same things: to see, to correct and to delete.',
        ],
      },
      {
        title: 'What we collect',
        items: [
          'Name, phone and delivery address — so we can reach you with the order.',
          'The order itself, its price and time, and whatever you write to us in the site chat or on WhatsApp.',
          'There is no sign-up, no password, and no card details are typed into this site.',
          'For an anonymous visitor count, general visit data is collected, with no cookies and no identification.',
        ],
      },
      {
        title: 'What we use it for',
        items: [
          'Cooking and delivering your order, and keeping you posted along the way.',
          'Answering questions before and after an order.',
          'Issuing an invoice and keeping the books.',
          'We do not sell your details and we do not pass them to advertisers.',
        ],
      },
      {
        title: 'Who else sees it, on our behalf',
        items: [
          'WhatsApp, by Meta — the messages you send us travel through it.',
          'Telegram — the order reaches the kitchen team and the courier as an internal message.',
          'Railway — the servers running the site and the ordering system.',
          'Cloudflare — the domain, serving the site, image storage and the visitor count.',
          'OpenAI — the chat on the site and the reading of orders that arrive as free text. What you type into the chat is sent there to compose the answer.',
          'Resend — sending confirmation and invoice emails.',
          'Each of them receives only what it needs, and only to perform the service for us.',
        ],
      },
      {
        title: 'How long we keep it',
        items: [
          'Order details are kept as long as they are needed for the service and for the company books.',
          'The site chat remembers only a short recent window of the conversation, not a full history.',
          'You can ask for deletion at any time, and we delete whatever the law does not require us to keep.',
        ],
      },
      {
        title: 'What you may ask for',
        items: [
          'To see what we hold about you.',
          'To correct something wrong.',
          'To have your details deleted.',
          'To ask us to stop contacting you.',
          'Ask on WhatsApp or by phone, and we answer within one business day.',
        ],
      },
      {
        title: 'Cookies and browser storage',
        items: [
          'This site has no tracking cookies and no advertising cookies.',
          'Your browser stores your language choice and your cart locally, so they survive moving between pages. That stays on your device.',
        ],
      },
      {
        title: 'Children and changes',
        items: [
          'This site is not aimed at children and we do not knowingly collect details about anyone under 18.',
          'If this policy changes, the updated version is published on this page with a new date.',
        ],
      },
    ],
    updated: 'Last updated on',
  },
  fr: {
    title: ['Politique de', 'confidentialité'],
    heroAlt: 'Bat Melech — une cuisine familiale cachère à Dubaï',
    termsLink: 'Lire les conditions d’utilisation',
    sections: [
      {
        title: 'Qui est responsable de vos données',
        items: [
          'La société derrière ce site est Bat Melech For Ready-made Meals & Dishes Preparation L.L.C, licence commerciale 1624395, siège social Office M_08, Naif, Deira, Dubaï.',
          'Pour toute question sur vos données : WhatsApp ou téléphone +971586288776. Nous répondons sous un jour ouvré.',
        ],
      },
      {
        title: 'La loi applicable',
        items: [
          'Vos données sont traitées selon la loi émirienne sur la protection des données personnelles, décret-loi fédéral n° 45 de 2021.',
          'Si vous êtes en Israël ou en Europe, vous pouvez nous demander exactement les mêmes choses : consulter, corriger et supprimer.',
        ],
      },
      {
        title: 'Ce que nous collectons',
        items: [
          'Nom, téléphone et adresse de livraison — pour vous apporter la commande.',
          'La commande elle-même, son prix et son horaire, ainsi que ce que vous nous écrivez dans le chat du site ou sur WhatsApp.',
          'Aucune inscription, aucun mot de passe, et aucune donnée de carte n’est saisie sur ce site.',
          'Pour un comptage anonyme des visiteurs, des données de visite générales sont collectées, sans cookie et sans identification.',
        ],
      },
      {
        title: 'À quoi cela sert',
        items: [
          'Cuisiner et livrer votre commande, et vous tenir informé en chemin.',
          'Répondre à vos questions avant et après la commande.',
          'Émettre une facture et tenir la comptabilité.',
          'Nous ne vendons pas vos données et ne les transmettons pas à des annonceurs.',
        ],
      },
      {
        title: 'Qui d’autre y a accès, pour notre compte',
        items: [
          'WhatsApp, de Meta — les messages que vous nous envoyez y transitent.',
          'Telegram — la commande parvient à l’équipe et au livreur par un message interne.',
          'Railway — les serveurs qui font tourner le site et le système de commandes.',
          'Cloudflare — le domaine, la diffusion du site, le stockage des images et le comptage des visiteurs.',
          'OpenAI — le chat du site et la lecture des commandes reçues en texte libre. Ce que vous tapez dans le chat y est envoyé pour composer la réponse.',
          'Resend — l’envoi des e-mails de confirmation et de facture.',
          'Chacun ne reçoit que ce qui lui est nécessaire, et uniquement pour exécuter le service pour nous.',
        ],
      },
      {
        title: 'Durée de conservation',
        items: [
          'Les détails de commande sont conservés tant qu’ils sont nécessaires au service et à la comptabilité.',
          'Le chat du site ne garde qu’une courte fenêtre récente de la conversation, pas un historique complet.',
          'Vous pouvez demander la suppression à tout moment ; nous supprimons ce que la loi ne nous oblige pas à conserver.',
        ],
      },
      {
        title: 'Ce que vous pouvez demander',
        items: [
          'Consulter les données que nous détenons sur vous.',
          'Corriger une information erronée.',
          'Faire supprimer vos données.',
          'Nous demander de cesser de vous contacter.',
          'La demande se fait sur WhatsApp ou par téléphone, réponse sous un jour ouvré.',
        ],
      },
      {
        title: 'Cookies et stockage du navigateur',
        items: [
          'Ce site n’utilise ni cookie de suivi ni cookie publicitaire.',
          'Votre navigateur conserve localement votre choix de langue et votre panier, pour qu’ils survivent au changement de page. Cela reste sur votre appareil.',
        ],
      },
      {
        title: 'Enfants et modifications',
        items: [
          'Ce site ne s’adresse pas aux enfants et nous ne collectons pas sciemment de données sur des personnes de moins de 18 ans.',
          'En cas de modification, la version à jour est publiée sur cette page avec une nouvelle date.',
        ],
      },
    ],
    updated: 'Dernière mise à jour le',
  },
}

export function Privacy() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/privacy"
        size="compact"
        title={t.title as [string, string]}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ZEd1RfEEqbe.jpeg"
        imageAlt={t.heroAlt}
      />
      <main id="main" className="max-w-4xl mx-auto px-6 py-8 md:py-16 pb-16 md:pb-24 space-y-10 md:space-y-16 text-start">
        {t.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{section.title}</h2>
            <ul className="list-disc ps-6 space-y-2 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <div className="flex flex-col gap-3">
          <Link to={href('/legal')} className="font-black text-[#8D182C] hover:text-[#F5A83A] w-fit">
            {t.termsLink}
          </Link>
          <p className="text-sm font-bold text-[#3B151A]/50">
            {t.updated} {LAST_UPDATED}
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
