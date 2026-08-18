import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  badge: 'Our Story',
  title: ['הסיפור', 'שלנו'],
  heroAlt: 'הסיפור של מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  portraitAlt: 'לין - בת מלך',
  founderName: 'לין',
  founderRole: 'מייסדת ושפית ראשית',
  p1: 'אני לין, והמטבח תמיד היה חלק ממני.',
  p2: 'הכול התחיל מעסק של כנאפה, וכשהקורונה שינתה את התוכניות, התחלתי להכין קובה מהבית. העליתי לרשת, ומשם זה פשוט תפס — הזמנות התחילו להגיע מכל הארץ, והקובה שלי הפכה למשהו שאנשים הכירו וחזרו בשבילו.',
  p3: 'אחר כך הפכתי לאמא ולקחתי הפסקה. לא ידעתי אם ומתי אחזור לבשל באופן מקצועי.',
  pull: 'ואז עברנו לדובאי.',
  p4: 'משנה מקום, משנה מזל — חזרתי למטבח, הפעם יחד עם בעלי. היום אנחנו מכינים אוכל ביתי כשר, טרי ומוקפד, בדיוק כמו שאנחנו אוהבים לאכול אצלנו בבית.',
  p5: 'אז אם אתם בדובאי ומתגעגעים לאוכל של בית, אני מזמינה אתכם להרגיש שאתם יושבים איתנו סביב השולחן גם בזמן החופשה שלכם — וליהנות מארוחה ביתית, כשרה וטרייה, שהוכנה במיוחד עבורכם.',
  ctaShabbat: 'הזמינו לשבת',
  ctaWeekday: 'תפריט יום חול',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    badge: 'Our Story',
    title: ['Our', 'Story'],
    heroAlt: 'The story of Bat Melech — a kosher home kitchen in Dubai',
    portraitAlt: 'Lynn — Bat Melech',
    founderName: 'Lynn',
    founderRole: 'Founder & Head Chef',
    p1: "I'm Lynn, and the kitchen has always been part of me.",
    p2: "It all started with a knafeh business, and when Covid changed the plans, I began making kubbeh from home. I posted it online, and from there it simply took off — orders started coming in from all over Israel, and my kubbeh became something people knew and kept coming back for.",
    p3: "Then I became a mom and took a break. I didn't know if or when I'd go back to cooking professionally.",
    pull: 'And then we moved to Dubai.',
    p4: "Meshaneh makom, meshaneh mazal — a change of place brings a change of fortune. I came back to the kitchen, this time together with my husband. Today we make kosher home cooking, fresh and made with care, exactly the way we love to eat at our own table.",
    p5: "So if you're in Dubai and missing the taste of home, I invite you to feel like you're sitting around the table with us, even on your vacation — and to enjoy a home-cooked meal, kosher and fresh, prepared especially for you.",
    ctaShabbat: 'Order for Shabbat',
    ctaWeekday: 'Weekday Menu',
  },
  fr: {
    badge: 'Our Story',
    title: ['Notre', 'histoire'],
    heroAlt: "L'histoire de Bat Melech — une cuisine familiale casher à Dubaï",
    portraitAlt: 'Lynn — Bat Melech',
    founderName: 'Lynn',
    founderRole: 'Fondatrice et chef',
    p1: 'Je suis Lynn, et la cuisine a toujours fait partie de moi.',
    p2: "Tout a commencé par une petite affaire de knafeh, et lorsque le Covid a bouleversé les plans, je me suis mise à préparer des kubés à la maison. Je les ai publiés en ligne, et tout est parti de là — les commandes ont afflué de tout Israël, et mes kubés sont devenus quelque chose que les gens connaissaient et pour lequel ils revenaient.",
    p3: "Puis je suis devenue maman et j'ai fait une pause. Je ne savais pas si, ni quand, je reviendrais à la cuisine professionnelle.",
    pull: 'Et puis nous avons déménagé à Dubaï.',
    p4: "Changer de lieu, c'est changer de mazal — je suis revenue aux fourneaux, cette fois avec mon mari. Aujourd'hui, nous préparons une cuisine familiale casher, fraîche et soignée, exactement comme nous aimons manger chez nous.",
    p5: "Alors si vous êtes à Dubaï et que la cuisine de la maison vous manque, je vous invite à vous sentir comme si vous étiez à table avec nous, même pendant vos vacances — et à savourer un repas fait maison, casher et frais, préparé spécialement pour vous.",
    ctaShabbat: 'Commander pour Chabbat',
    ctaWeekday: 'Menu de semaine',
  },
}

export function Story() {
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
      <PageHero
        active="/story"
        size="tall"
        badge={t.badge}
        title={t.title as [string, string]}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hqJqmcg5k3O.jpeg"
        imageAlt={t.heroAlt}
      />

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-24 pb-32 -mt-24">
        <div className="bg-white rounded-[5rem] p-8 md:p-24 shadow-2xl border border-[#EDB2C1]/30">
          <div className="flex flex-col md:flex-row gap-16 md:gap-20 items-start">
            <div className="md:w-1/3 md:sticky md:top-10 w-full">
              <img
                src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/8BFD80FA-B647-4892-88DA-A42D9A482CDF-ednYRxQWIlt.png"
                alt={t.portraitAlt}
                className="w-full aspect-[4/5] rounded-[4rem] border-8 border-white shadow-2xl object-cover object-top"
              />
              <div className="mt-12 text-center md:text-start">
                <h3 className="text-3xl font-black">{t.founderName}</h3>
                <p className="text-[#EDB2C1] font-bold italic">{t.founderRole}</p>
              </div>
            </div>
            <div className="md:w-2/3 text-start">
              <div className="space-y-10 text-xl md:text-3xl font-bold leading-relaxed text-[#3B151A]/90">
                <p>{t.p1}</p>
                <p>{t.p2}</p>
                <p>{t.p3}</p>
                <p className="text-3xl md:text-5xl font-black text-[#8D182C] italic py-10 border-y border-[#EDB2C1]/20 my-12 text-center">
                  {t.pull}
                </p>
                <p>{t.p4}</p>
                <p>{t.p5}</p>
              </div>
              <div className="mt-16 pt-12 border-t border-[#EDB2C1]/20 flex flex-col sm:flex-row gap-6 justify-center">
                <Link
                  to={href('/shabbat-order')}
                  className="bg-[#3B151A] text-white px-12 py-6 rounded-full font-black text-xl shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-4"
                >
                  <Icon icon="ph:calendar-heart-fill" />
                  {t.ctaShabbat}
                </Link>
                <Link
                  to={href('/weekdays')}
                  className="bg-[#EDB2C1]/10 px-12 py-6 rounded-full font-black text-xl shadow-xl hover:scale-105 transition-all border-2 border-[#EDB2C1]/40"
                >
                  {t.ctaWeekday}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
