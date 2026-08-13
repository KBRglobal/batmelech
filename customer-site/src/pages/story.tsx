import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'

export function Story() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir="rtl">
      <PageHero
        active="/story"
        size="tall"
        badge="Our Story"
        title={['הסיפור', 'שלנו']}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/GQcIcze6r9C.jpeg"
      />

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-24 pb-32 -mt-24">
        <div className="bg-white rounded-[5rem] p-8 md:p-24 shadow-2xl border border-[#EDB2C1]/30">
          <div className="flex flex-col md:flex-row gap-16 md:gap-20 items-start">
            <div className="md:w-1/3 md:sticky md:top-10 w-full">
              <img
                src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/8BFD80FA-B647-4892-88DA-A42D9A482CDF-ednYRxQWIlt.png"
                alt="לין - בת מלך"
                className="w-full aspect-[4/5] rounded-[4rem] border-8 border-white shadow-2xl object-cover object-top"
              />
              <div className="mt-12 text-center md:text-right">
                <h3 className="text-3xl font-black">לין</h3>
                <p className="text-[#EDB2C1] font-bold italic">מייסדת ושפית ראשית</p>
              </div>
            </div>
            <div className="md:w-2/3 text-right">
              <div className="space-y-10 text-xl md:text-3xl font-bold leading-relaxed text-[#3B151A]/90">
                <p>אני לין, והמטבח תמיד היה חלק ממני.</p>
                <p>
                  הכול התחיל מעסק של כנאפה, וכשהקורונה שינתה את התוכניות, התחלתי להכין קובה מהבית. העליתי לרשת,
                  ומשם זה פשוט תפס — הזמנות התחילו להגיע מכל הארץ, והקובה שלי הפכה למשהו שאנשים הכירו וחזרו
                  בשבילו.
                </p>
                <p>אחר כך הפכתי לאמא ולקחתי הפסקה. לא ידעתי אם ומתי אחזור לבשל באופן מקצועי.</p>
                <p className="text-3xl md:text-5xl font-black text-[#8D182C] italic py-10 border-y border-[#EDB2C1]/20 my-12 text-center">
                  ואז עברנו לדובאי.
                </p>
                <p>
                  משנה מקום, משנה מזל — חזרתי למטבח, הפעם יחד עם בעלי. היום אנחנו מכינים אוכל ביתי כשר, טרי
                  ומוקפד, בדיוק כמו שאנחנו אוהבים לאכול אצלנו בבית.
                </p>
                <p>
                  אז אם אתם בדובאי ומתגעגעים לאוכל של בית, אני מזמינה אתכם להרגיש שאתם יושבים איתנו סביב השולחן
                  גם בזמן החופשה שלכם — וליהנות מארוחה ביתית, כשרה וטרייה, שהוכנה במיוחד עבורכם.
                </p>
              </div>
              <div className="mt-16 pt-12 border-t border-[#EDB2C1]/20 flex flex-col sm:flex-row gap-6 justify-center">
                <Link
                  to="/shabbat-order"
                  className="bg-[#3B151A] text-white px-12 py-6 rounded-full font-black text-xl shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-4"
                >
                  <Icon icon="ph:calendar-heart-fill" />
                  הזמינו לשבת
                </Link>
                <Link
                  to="/weekdays"
                  className="bg-[#EDB2C1]/10 px-12 py-6 rounded-full font-black text-xl shadow-xl hover:scale-105 transition-all border-2 border-[#EDB2C1]/40"
                >
                  תפריט יום חול
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
