import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'

export function Legal() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-20" dir="rtl">
      <PageHero
        active="/legal"
        size="compact"
        title={['תנאי שימוש', 'ופרטיות']}
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZEd1RfEEqbe.jpeg"
      />
      <main className="max-w-4xl mx-auto px-6 py-16 space-y-16 text-right">
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">תנאי שימוש</h2>
          <div className="space-y-4 text-lg font-bold text-[#3B151A]/80 leading-relaxed">
            <p>ברוכים הבאים למטבח "בת מלך" דובאי. השימוש באתר ובשירותי ההזמנות כפוף לתנאים הבאים:</p>
            <ul className="list-disc pr-6 space-y-2">
              <li>הזמנות לשבת יש לבצע עד יום חמישי בשעה 18:00.</li>
              <li>הביטול אפשרי עד 24 שעות לפני מועד האספקה.</li>
              <li>התשלום מתבצע במעמד ההזמנה או באיסוף, בהתאם לסיכום מראש.</li>
              <li>אנו עושים את מירב המאמצים לספק אוכל טרי ואיכותי, אך האחריות על צריכת המזון היא על הלקוח.</li>
            </ul>
          </div>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">מדיניות פרטיות</h2>
          <div className="space-y-4 text-lg font-bold text-[#3B151A]/80 leading-relaxed">
            <p>אנו מכבדים את הפרטיות שלך:</p>
            <ul className="list-disc pr-6 space-y-2">
              <li>הפרטים האישיים (שם, טלפון, כתובת) משמשים למטרת ביצוע ההזמנה והמשלוח בלבד.</li>
              <li>איננו מעבירים מידע לצד ג׳ ללא הסכמה מפורשת.</li>
              <li>המידע נשמר במערכות מאובטחות לצורך שיפור השירות.</li>
              <li>האתר אינו משתמש בעוגיות מעקב או פרסום — רק במה שנדרש כדי לשלוח את ההזמנה בוואטסאפ.</li>
              <li>ניתן לבקש בכל עת לעיין, לתקן או למחוק את הפרטים שנשמרו — פנייה בטלפון או בוואטסאפ.</li>
            </ul>
          </div>
        </section>
        <section>
          <h2 className="text-3xl font-black font-heading mb-6 border-b-4 border-[#F5A83A] inline-block">כללי</h2>
          <div className="space-y-4 text-lg font-bold text-[#3B151A]/80 leading-relaxed">
            <ul className="list-disc pr-6 space-y-2">
              <li>תנאים אלה כפופים לחוקי איחוד האמירויות הערביות.</li>
              <li>אנו רשאים לעדכן את התנאים מעת לעת; הגרסה המעודכנת תמיד מתפרסמת בעמוד זה.</li>
              <li>אנו שומרים לעצמנו את הזכות לסרב לקבל הזמנה, לרבות בשל אזור משלוח שאינו בטווח השירות.</li>
            </ul>
          </div>
        </section>
        <section className="bg-[#3B151A] p-10 rounded-[3rem] text-white">
          <h2 className="text-2xl font-black font-heading mb-4 text-[#F5A83A]">הצהרת אלרגיות</h2>
          <p className="text-lg font-bold leading-relaxed">
            המטבח שלנו מטפל במגוון רכיבים. למרות הזהירות הרבה, ייתכנו עקבות של אלרגנים כגון גלוטן, אגוזים, ביצים
            ושומשום בכל המנות. לקוחות עם אלרגיות מסכנות חיים מתבקשים לציין זאת בהערות ההזמנה וליצור קשר טלפוני
            לווידוא.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
