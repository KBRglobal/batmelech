import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

// The accessibility statement. It describes what this site actually does —
// keyboard reach, landmarks, alt text, contrast — and says plainly what has
// not been audited, because a statement that overclaims is worse than none.
// Whoever fixes something here updates the "last reviewed" date below.

const LAST_REVIEWED = '16.09.2026'

const HE = {
  title: ['הצהרת', 'נגישות'],
  heroAlt: 'מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  intro: {
    title: 'המחויבות שלנו',
    body:
      'מטעמי בת מלך מבקשים שכל אחד יוכל לקרוא את התפריט ולהזמין ארוחה, גם עם מוגבלות. האתר נבנה לפי הנחיות הנגישות לתוכן באינטרנט, ‏WCAG 2.1 ברמה AA — אותן הנחיות שעליהן מבוסס התקן הישראלי ת״י 5568 — ואנחנו ממשיכים לשפר אותו.',
  },
  coordinator: {
    title: 'האחראית על הנגישות',
    body: 'לין אסולין, בעלת המטבח. אפשר לפנות אליה ישירות בוואטסאפ או בטלפון שבהמשך העמוד.',
  },
  done: {
    title: 'מה נעשה באתר',
    items: [
      'אפשר להגיע לכל קישור, כפתור ושדה במקלדת בלבד, והפריט שבמיקוד מסומן בבירור.',
      'בראש כל עמוד יש קישור דילוג ישר לתוכן, בלי לעבור על התפריט בכל פעם.',
      'לכל תמונה יש תיאור טקסטואלי, והכותרות בנויות בסדר היררכי.',
      'הטקסט נשען על ניגודיות גבוהה מול הרקע, ואפשר להגדיל אותו בדפדפן בלי לשבור את העמוד.',
      'האתר עובד בטלפון, בטאבלט ובמחשב מאותה בנייה, לאורך ולרוחב.',
      'מי שמעדיף פחות תנועה על המסך מקבל עמוד כמעט ללא אנימציה, לפי ההגדרה במערכת ההפעלה.',
      'אפשר להזמין גם בלי האתר בכלל — בוואטסאפ או בשיחת טלפון.',
    ],
  },
  gaps: {
    title: 'מה עוד לא הושלם',
    items: [
      'האתר לא עבר בדיקת נגישות של גורם חיצוני מוסמך.',
      'ייתכנו תמונות ישנות בגלריה שהתיאור שלהן חלקי.',
      'חלק מהתוכן מגיע מהתפריט החי, ויכולים להיות בו ניסוחים שלא נבדקו אחד־אחד.',
    ],
  },
  contact: {
    title: 'נתקלתם במשהו שלא נגיש?',
    body:
      'ספרו לנו באיזה עמוד זה קרה ומה לא עבד, ונטפל בזה. אפשר בוואטסאפ או בטלפון, ואנחנו חוזרים בתוך יום עסקים.',
    cta: 'לכתוב לנו בוואטסאפ',
  },
  updated: 'ההצהרה עודכנה לאחרונה בתאריך',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    title: ['Accessibility', 'Statement'],
    heroAlt: 'Bat Melech — a kosher home kitchen in Dubai',
    intro: {
      title: 'Our commitment',
      body:
        'Bat Melech wants everyone to be able to read the menu and order a meal, disability included. This site is built to the Web Content Accessibility Guidelines, WCAG 2.1 level AA — the same guidelines the Israeli standard IS 5568 rests on — and we keep improving it.',
    },
    coordinator: {
      title: 'Who is responsible for accessibility',
      body: 'Lin Asolin, who owns the kitchen. Reach her directly on the WhatsApp number or phone further down this page.',
    },
    done: {
      title: 'What the site does',
      items: [
        'Every link, button and field can be reached with the keyboard alone, and whatever holds focus is clearly marked.',
        'A skip link at the top of each page jumps straight to the content instead of walking the menu again.',
        'Every image carries a text description, and headings follow a real hierarchy.',
        'Text sits on high contrast against its background and can be enlarged in the browser without breaking the page.',
        'Phone, tablet and desktop run the same build, in portrait and landscape.',
        'Anyone who prefers less movement on screen gets a nearly motionless page, following the setting in their operating system.',
        'You can order without the site at all — on WhatsApp or by phone.',
      ],
    },
    gaps: {
      title: 'What is not finished',
      items: [
        'The site has not been audited by an external accessibility examiner.',
        'Some older gallery images may carry only a partial description.',
        'Part of the content comes from the live menu, where wording is not checked one item at a time.',
      ],
    },
    contact: {
      title: 'Found something you could not use?',
      body:
        'Tell us which page it happened on and what did not work, and we will fix it. WhatsApp or phone, and we answer within one business day.',
      cta: 'Message us on WhatsApp',
    },
    updated: 'This statement was last reviewed on',
  },
  fr: {
    title: ['Déclaration', 'd’accessibilité'],
    heroAlt: 'Bat Melech — une cuisine familiale cachère à Dubaï',
    intro: {
      title: 'Notre engagement',
      body:
        'Bat Melech souhaite que chacun puisse lire le menu et commander un repas, handicap compris. Ce site est conçu selon les règles pour l’accessibilité des contenus web, WCAG 2.1 niveau AA — celles sur lesquelles repose la norme israélienne IS 5568 — et nous continuons de l’améliorer.',
    },
    coordinator: {
      title: 'Responsable de l’accessibilité',
      body: 'Lin Asolin, qui dirige la cuisine. Vous pouvez la joindre directement sur le WhatsApp ou le téléphone indiqués plus bas.',
    },
    done: {
      title: 'Ce que fait le site',
      items: [
        'Chaque lien, bouton et champ est accessible au clavier seul, et l’élément qui a le focus est clairement signalé.',
        'Un lien d’évitement en haut de chaque page mène directement au contenu, sans reparcourir le menu.',
        'Chaque image porte une description textuelle et les titres suivent une vraie hiérarchie.',
        'Le texte repose sur un contraste élevé et peut être agrandi dans le navigateur sans casser la page.',
        'Téléphone, tablette et ordinateur utilisent la même version, en portrait comme en paysage.',
        'Qui préfère moins de mouvement à l’écran obtient une page presque sans animation, selon le réglage de son système.',
        'Vous pouvez commander sans passer par le site : sur WhatsApp ou par téléphone.',
      ],
    },
    gaps: {
      title: 'Ce qui n’est pas terminé',
      items: [
        'Le site n’a pas été audité par un organisme d’accessibilité externe.',
        'Certaines images anciennes de la galerie n’ont qu’une description partielle.',
        'Une partie du contenu provient du menu en direct, dont les formulations ne sont pas vérifiées une par une.',
      ],
    },
    contact: {
      title: 'Quelque chose vous a bloqué ?',
      body:
        'Dites-nous sur quelle page et ce qui n’a pas fonctionné, et nous le corrigerons. WhatsApp ou téléphone, réponse sous un jour ouvré.',
      cta: 'Nous écrire sur WhatsApp',
    },
    updated: 'Déclaration revue pour la dernière fois le',
  },
}

export function Accessibility() {
  const { locale, dir } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/accessibility"
        size="compact"
        title={t.title as [string, string]}
        image="https://pub-2521c260422949cc8bddbf72e06e0716.r2.dev/site/ZEd1RfEEqbe.jpeg"
        imageAlt={t.heroAlt}
      />
      <main id="main" className="max-w-4xl mx-auto px-6 py-8 md:py-16 pb-16 md:pb-24 space-y-10 md:space-y-16 text-start">
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.intro.title}</h2>
          <p className="text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">{t.intro.body}</p>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.coordinator.title}</h2>
          <p className="text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">{t.coordinator.body}</p>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.done.title}</h2>
          <ul className="list-disc ps-6 space-y-2 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
            {t.done.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">{t.gaps.title}</h2>
          <ul className="list-disc ps-6 space-y-2 text-base md:text-lg font-medium text-[#3B151A]/80 leading-relaxed">
            {t.gaps.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="bg-[#3B151A] p-7 md:p-10 rounded-[2rem] md:rounded-[3rem] text-white text-start">
          <h2 className="text-2xl font-black font-heading mb-4 text-[#F5A83A]">{t.contact.title}</h2>
          <p className="text-base md:text-lg font-medium leading-relaxed mb-6">{t.contact.body}</p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="https://wa.me/971586288776"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center bg-[#F5A83A] text-[#3B151A] px-7 py-4 rounded-2xl font-black hover:bg-white transition-all"
            >
              {t.contact.cta}
            </a>
            <a
              href="tel:+971586288776"
              className="inline-flex items-center justify-center border-2 border-white/30 px-7 py-4 rounded-2xl font-black hover:border-white transition-all"
              dir="ltr"
            >
              +971 58 628 8776
            </a>
          </div>
        </section>
        <p className="text-sm font-bold text-[#3B151A]/50">
          {t.updated} {LAST_REVIEWED}
        </p>
      </main>
      <Footer />
    </div>
  )
}
