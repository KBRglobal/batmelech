import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { NavHeader } from '../components/nav'
import { Footer } from '../components/footer'
import { useReveal } from '../components/reveal'

const EXPERIENCES = [
  {
    to: '/experiences/bbq',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/nsSTu1IMHv0.jpeg',
    icon: 'ph:fire-fill',
    tag: 'Private BBQ',
    title: 'שף מנגליסט פרטי',
    desc: 'חווית בשרים על האש אצלכם בווילה. צלייה מקצועית וסלטים טריים.',
  },
  {
    to: '/experiences/yacht',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/OIC46tu7QUo.jpeg',
    icon: 'ph:waves-fill',
    tag: 'Yacht Party',
    title: 'אירועים על יאכטה',
    desc: 'מסיבות ואירועים בלב ים עם קייטרינג גורמה כשר ונוף למרינה.',
  },
  {
    to: '/experiences/villa',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Lh0FCekcbt7.jpeg',
    icon: 'ph:house-fill',
    tag: 'Villa Events',
    title: 'מסיבות בוילה',
    desc: 'קייטרינג מלא למסיבות בריכה ואירועים חברתיים בוילות המפוארות של דובאי.',
  },
  {
    to: '/experiences/suite',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/SuJ0WdhHMRh.jpeg',
    icon: 'ph:heart-fill',
    tag: 'Suite Dining',
    title: 'ארוחות בסוויטה',
    desc: 'ארוחות שף פרטיות ואינטימיות בסוויטות מלון. חוויה רומנטית ויוקרתית.',
  },
  {
    to: '/experiences/desert',
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hQfhwTbpf9J.jpeg',
    icon: 'ph:mountains-fill',
    tag: 'Desert Safari',
    title: 'סעודת מדבר VIP',
    desc: 'בישול שטח יוקרתי בלב הדיונות. חוויה מדברית עם טעמי בית אמיתיים.',
  },
]

const TESTIMONIALS = [
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZEd1RfEEqbe.jpeg',
    quote: '"פשוט מושלם. האוכל הגיע חם, טרי ובטעם של הבית שכל כך היה חסר לנו."',
    avatar: 'https://randomuser.me/api/portraits/men/32.jpg',
    name: 'יובל דיין',
    place: 'Palm Jumeirah Villa',
  },
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/psq4DoJL0is.jpeg',
    quote: '"חגגנו יום הולדת על יאכטה ולין הפיקה לנו אירוע קולינרי מדהים. הדגים היו ברמה של מישלן."',
    avatar: 'https://randomuser.me/api/portraits/women/44.jpg',
    name: 'מיכל אהרוני',
    place: 'Yacht Party VIP',
  },
  {
    img: 'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/gpJVV6ZvEfk.jpeg',
    quote: '"כאיש עסקים שנוסע הרבה לדובאי, למצוא אוכל כשר ואיכותי זה אתגר. השירות של בת מלך הציל אותי."',
    avatar: 'https://randomuser.me/api/portraits/men/12.jpg',
    name: 'דניאל כהן',
    place: 'Business Dining',
  },
]

export function Home() {
  const storyReveal = useReveal<HTMLElement>()
  const shabbatReveal = useReveal<HTMLElement>()
  const weekdayReveal = useReveal<HTMLElement>()
  const experiencesReveal = useReveal<HTMLElement>()
  const testimonialsReveal = useReveal<HTMLElement>()

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 relative overflow-x-hidden" dir="rtl">
      <section className="relative min-h-screen flex flex-col overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/GQcIcze6r9C.jpeg"
            alt="Luxury Shabbat Dinner Dubai"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />
        </div>
        <div className="relative z-10 flex flex-col min-h-screen">
          <NavHeader active="/" />
          <div className="flex-grow flex flex-col items-center justify-center text-center px-6">
            <div className="w-48 h-48 md:w-72 md:h-72 mb-8 animate-float">
              <img
                src="/site/assets/logo-cream.png"
                alt="Bat Melech Logo"
                className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]"
              />
            </div>
            <div className="max-w-4xl backdrop-blur-md bg-black/10 p-10 rounded-[4rem] border border-white/10 shadow-2xl">
              <h1 className="text-5xl md:text-8xl font-black text-white mb-6 font-heading tracking-tight leading-none">
                הטעם של הבית, <br />
                <span className="text-[#F5A83A]">בלב דובאי</span>
              </h1>
              <p className="text-white/90 text-xl md:text-3xl font-bold mb-12 leading-relaxed">
                אוכל ישראלי שורשי, טרי בכל יום, מבושל עם כל הלב.
                <br className="hidden md:block" />
                האיכות המוכרת מישראל - עכשיו בחופשה שלכם.
              </p>
              <div className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto justify-center">
                <Link
                  to="/shabbat-order"
                  className="bg-white text-[#3B151A] px-14 py-7 rounded-full font-black text-2xl shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-4 group"
                >
                  <Icon icon="ph:calendar-heart-fill" className="text-3xl group-hover:animate-bounce" />
                  הרכיבו חבילת קידוש מושלמת
                </Link>
                <Link
                  to="/weekdays"
                  className="bg-[#3B151A] text-white px-14 py-7 rounded-full font-black text-2xl hover:bg-black transition-all flex items-center justify-center shadow-2xl border-2 border-[#EDB2C1]/30"
                >
                  תפריט יום חול
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pb-32">
        <section id="story" ref={storyReveal.ref} className={`mb-32 scroll-mt-24 pt-32 text-center ${storyReveal.className}`}>
          <div className="max-w-4xl mx-auto">
            <div className="mb-16 inline-block">
              <img
                src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/ai/8BFD80FA-B647-4892-88DA-A42D9A482CDF-ednYRxQWIlt.png"
                alt="לין - בת מלך"
                className="w-40 h-40 md:w-56 md:h-56 rounded-full border-[12px] border-white shadow-2xl object-cover object-top mx-auto"
              />
            </div>
            <h2 className="text-5xl md:text-7xl font-black font-heading mb-10 tracking-tight">הסיפור שלי</h2>
            <div className="space-y-8 text-xl md:text-2xl font-bold leading-relaxed text-[#3B151A]/80">
              <p className="max-w-2xl mx-auto">
                אני לין, והמטבח תמיד היה חלק ממני. מהקובה הביתית שכבשה את ישראל ועד המעבר המרגש לדובאי – חזרתי
                למטבח יחד עם בעלי כדי להביא לכם את הטעם של הבית, כשר וטרי, גם בחופשה שלכם.
              </p>
              <div className="pt-10">
                <Link
                  to="/story"
                  className="inline-flex items-center gap-4 text-[#8D182C] font-black text-2xl group border-b-4 border-[#EDB2C1]/30 pb-2 hover:border-[#F5A83A] transition-all"
                >
                  קראו את הסיפור המלא <Icon icon="ph:arrow-left-bold" className="group-hover:-translate-x-2 transition-transform" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="shabbat-promo" ref={shabbatReveal.ref} className={`mb-32 scroll-mt-24 ${shabbatReveal.className}`}>
          <div className="relative h-[30rem] md:h-[40rem] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white group">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/NPPrDqcdlgE.jpeg"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/20 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-center items-start p-8 md:p-24 text-right">
              <div className="max-w-xl space-y-6 md:space-y-8">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#F5A83A] text-[#3B151A] rounded-full text-xs font-black tracking-widest uppercase">
                  <span>The Shabbat Experience</span>
                </div>
                <h2 className="text-4xl md:text-7xl font-black font-heading text-white leading-tight">
                  מטעמי <br />
                  <span className="text-[#F5A83A]">שבת קודש</span>
                </h2>
                <p className="text-white/80 text-lg md:text-2xl font-bold leading-relaxed">
                  חבילות קידוש וסעודות שבת מפוארות שמגיעות עד אליכם. כל מה שצריך לשבת מושלמת, בטעם של בית ובכשרות
                  מהודרת.
                </p>
                <Link
                  to="/shabbat-order"
                  className="inline-flex items-center gap-4 bg-white text-[#3B151A] px-8 md:px-12 py-4 md:py-6 rounded-full font-black text-lg md:text-2xl hover:bg-[#F5A83A] transition-all shadow-2xl group/btn"
                >
                  לתפריט שבת המלא <Icon icon="ph:calendar-heart-fill" className="text-2xl md:text-3xl group-hover/btn:animate-bounce" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="weekday-promo" ref={weekdayReveal.ref} className={`mb-32 scroll-mt-24 ${weekdayReveal.className}`}>
          <div className="relative h-[30rem] md:h-[40rem] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white group">
            <img
              src="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/32nv8K7lIKf.jpeg"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-center items-end p-8 md:p-24 text-right">
              <div className="max-w-xl space-y-6 md:space-y-8 flex flex-col items-end">
                <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#3B151A] text-[#EDB2C1] rounded-full text-xs font-black tracking-widest uppercase">
                  <span>Fresh Daily Meals</span>
                </div>
                <h2 className="text-4xl md:text-7xl font-black font-heading text-white leading-tight">
                  משהו טעים <br />
                  <span className="text-[#EDB2C1]">לאמצע שבוע</span>
                </h2>
                <p className="text-white/80 text-lg md:text-2xl font-bold leading-relaxed">
                  אוכל ישראלי טרי, סלטים צבעוניים ובשרים משובחים. המשלוח שלנו מגיע לכל מקום בדובאי, כל יום מחדש.
                </p>
                <Link
                  to="/weekdays"
                  className="inline-flex items-center gap-4 bg-[#EDB2C1] text-[#3B151A] px-8 md:px-12 py-4 md:py-6 rounded-full font-black text-lg md:text-2xl hover:bg-white transition-all shadow-2xl group/btn"
                >
                  לתפריט יום חול <Icon icon="ph:fork-knife-fill" className="text-2xl md:text-3xl group-hover/btn:rotate-12" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="experiences" ref={experiencesReveal.ref} className={`mb-32 scroll-mt-24 ${experiencesReveal.className}`}>
          <div className="mb-16 max-w-3xl">
            <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#3B151A] text-[#F5A83A] rounded-full text-xs font-black tracking-widest uppercase mb-6">
              <span>Exclusive Events &amp; Catering</span>
            </div>
            <h2 className="text-4xl md:text-8xl font-black font-heading leading-none mb-8">
              חוויות קולינריות <br />
              <span className="text-[#8D182C]">VIP בכל מקום</span>
            </h2>
            <p className="text-lg md:text-2xl font-bold text-[#3B151A]/70 leading-relaxed">
              אנחנו מגיעים לכל נקודה בדובאי כדי ליצור לכם אירוע בלתי נשכח. אוכל כשר ברמה הגבוהה ביותר, הגשה
              יוקרתית ושירות אישי.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {EXPERIENCES.map((exp) => (
              <Link
                key={exp.to}
                to={exp.to}
                className="group relative h-[28rem] md:h-[35rem] rounded-[3.5rem] overflow-hidden shadow-2xl border-2 border-white block"
              >
                <img src={exp.img} className="absolute inset-0 w-full h-full object-cover transition-transform duration-[2s] group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                <div className="absolute bottom-10 right-10 left-10">
                  <div className="mb-4 flex items-center gap-3">
                    <Icon icon={exp.icon} className="text-[#F5A83A] text-3xl" />
                    <span className="text-white/60 font-black tracking-widest uppercase text-xs">{exp.tag}</span>
                  </div>
                  <h3 className="text-3xl md:text-4xl font-black text-white mb-4 font-heading">{exp.title}</h3>
                  <p className="text-white/80 text-sm md:text-base font-bold mb-6">{exp.desc}</p>
                  <div className="inline-flex items-center gap-3 bg-white text-[#3B151A] px-8 py-4 rounded-2xl font-black text-lg group-hover:bg-[#F5A83A] transition-all shadow-xl">
                    לפרטים והזמנה <Icon icon="ph:arrow-left-bold" className="text-xl" />
                  </div>
                </div>
              </Link>
            ))}
            <div className="bg-[#3B151A] rounded-[3.5rem] p-10 flex flex-col items-center justify-center text-center border-4 border-[#F5A83A]/30 shadow-2xl">
              <Icon icon="ph:sparkle-fill" className="text-6xl text-[#F5A83A] mb-6 animate-pulse" />
              <h3 className="text-3xl font-black text-white mb-4">יש לכם רעיון אחר?</h3>
              <p className="text-white/60 font-bold mb-8">אנחנו פתוחים לכל חלום קולינרי שיש לכם בדובאי. דברו איתנו ונגשים לכם אותו.</p>
              <a
                href="https://wa.me/971586288776"
                className="w-full bg-[#F5A83A] text-[#3B151A] py-5 rounded-2xl font-black text-xl hover:bg-white transition-all"
              >
                דברו איתנו <Icon icon="ph:chat-circle-dots-fill" className="inline-block mr-2" />
              </a>
            </div>
          </div>
        </section>

        <section id="testimonials" ref={testimonialsReveal.ref} className={`mb-16 scroll-mt-24 ${testimonialsReveal.className}`}>
          <div className="flex flex-col items-center text-center mb-16">
            <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#F5A83A]/10 text-[#F5A83A] rounded-full text-xs font-black tracking-widest uppercase mb-6">
              <span>The Wall of Love</span>
            </div>
            <h2 className="text-4xl md:text-8xl font-black font-heading leading-tight">
              מה אומרים <br />
              <span className="text-[#8D182C]">האורחים שלנו?</span>
            </h2>
          </div>
          <div className="flex overflow-x-auto pb-16 hide-scrollbar -mx-6 px-6 gap-8">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="shrink-0 w-[85vw] md:w-[28rem]">
                <div className="bg-white rounded-[3.5rem] overflow-hidden shadow-2xl border-4 border-white transition-transform hover:-translate-y-2 duration-500">
                  <div className="aspect-square relative">
                    <img src={t.img} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#3B151A]/80 to-transparent" />
                    <div className="absolute bottom-8 right-8 left-8 text-white">
                      <div className="flex gap-1 text-[#F5A83A] mb-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Icon key={i} icon="ph:star-fill" />
                        ))}
                      </div>
                      <p className="text-lg font-bold leading-relaxed italic mb-6">{t.quote}</p>
                      <div className="flex items-center gap-3">
                        <img src={t.avatar} className="w-12 h-12 rounded-full border-2 border-white shadow-lg" />
                        <div className="flex flex-col">
                          <span className="font-black text-sm">{t.name}</span>
                          <span className="text-[10px] text-white/60 font-bold tracking-widest uppercase">{t.place}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
