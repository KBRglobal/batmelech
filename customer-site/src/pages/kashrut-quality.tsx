import { Icon } from '@iconify/react'
import { BackHeader } from '../components/nav'

export function KashrutQuality() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir="rtl">
      <BackHeader />
      <main className="pt-32 max-w-4xl mx-auto px-6">
        <section className="mb-20 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-[#3B151A] rounded-full text-[#F5A83A] text-5xl mb-8 shadow-2xl">
            <Icon icon="ph:certificate-fill" />
          </div>
          <h2 className="text-5xl font-black font-heading mb-8">כשרות ללא פשרות בדובאי</h2>
          <p className="text-xl font-bold text-[#3B151A]/70 leading-relaxed mb-12">
            אנחנו מבינים שנושא הכשרות הוא הקריטי ביותר עבורכם. לכן, אנו מקפידים על הסטנדרטים המחמירים ביותר, תוך
            עבודה צמודה עם גופי הכשרות המוכרים והמוערכים ביותר באיחוד האמירויות.
          </p>
          <div className="rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white aspect-video mb-20">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/7zzOf0cSMJb.jpeg"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-right">
            <InfoCard icon="ph:seal-check-fill" title="גופי כשרות">
              אנו עובדים תחת פיקוח הדוק ובהשגחת רבנים מובילים. כל חומרי הגלם נרכשים מספקים מורשים בלבד.
            </InfoCard>
            <InfoCard icon="ph:chef-hat-fill" title="מטבח נפרד">
              כל הבישולים מתבצעים במטבח כשר ייעודי ומבודד, עם הפרדה מוחלטת של כלים, משטחי עבודה ותנורים.
            </InfoCard>
            <InfoCard icon="ph:leaf-fill" title="חומרי גלם">
              אנו משתמשים בירקות איכותיים, בשר "חלק" בכשרות מהודרת, ומוצרי חלב מוקפדים. כל מוצר עובר בדיקה
              דקדקנית.
            </InfoCard>
            <InfoCard icon="ph:truck-fill" title="משלוח מבוקר">
              המזון נשלח בצידניות תרמיות אטומות וחתומות, כדי להבטיח את הטמפרטורה, הטריות והכשרות עד לרגע ההגעה
              אליכם.
            </InfoCard>
          </div>
        </section>
        <section className="bg-[#3B151A] p-12 rounded-[5rem] text-center shadow-2xl">
          <h4 className="text-2xl font-black text-white mb-6 font-heading italic">"השקט הנפשי שלכם הוא המשימה שלנו"</h4>
          <p className="text-white/60 font-bold mb-10">יש לכם שאלות ספציפיות על הכשרות? אנחנו כאן לענות על הכל.</p>
          <a
            href="https://wa.me/971586288776"
            className="inline-flex items-center gap-4 bg-[#F5A83A] text-[#3B151A] px-12 py-6 rounded-2xl font-black text-xl hover:bg-white transition-all"
          >
            לבירור כשרות בוואטסאפ <Icon icon="ph:whatsapp-logo-fill" className="text-2xl" />
          </a>
        </section>
      </main>
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
