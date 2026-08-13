import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'
import { Footer } from '../components/footer'

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
    desc: 'קייטרינג מלא למסיבות בריכה ואירועים חברתיים בוילות המפוארות.',
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

export function Events() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir="rtl">
      <PageHero
        active="/events"
        size="tall"
        badge="Exclusive VIP Experiences"
        title={['חוויות קולינריות', 'VIP בדובאי']}
        subtitle="אנחנו מביאים את השף ואת האוכל הכי טוב בדובאי – בדיוק לאן שאתם נמצאים. גלו את מגוון האפשרויות שלנו לאירועים פרטיים ויוקרתיים."
        image={EXPERIENCES[0].img}
      />
      <main className="pt-16 max-w-7xl mx-auto px-6">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-32">
          {EXPERIENCES.map((exp, i) => (
            <Reveal key={exp.to} delay={(i % 3) * 100}>
              <Link
                to={exp.to}
                className="group relative h-[28rem] md:h-[35rem] rounded-[4rem] overflow-hidden shadow-2xl border-2 border-white block"
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
            </Reveal>
          ))}
          <Reveal delay={(EXPERIENCES.length % 3) * 100}>
            <div className="bg-[#3B151A] rounded-[4rem] p-10 flex flex-col items-center justify-center text-center border-4 border-[#F5A83A]/30 shadow-2xl h-full">
              <Icon icon="ph:sparkle-fill" className="text-6xl text-[#F5A83A] mb-6 animate-pulse" />
              <h3 className="text-3xl font-black text-white mb-4">אירוע בהתאמה אישית</h3>
              <p className="text-white/60 font-bold mb-8 text-lg">יש לכם חלום קולינרי אחר? אנחנו כאן כדי להגשים אותו. דברו איתנו בוואטסאפ.</p>
              <a
                href="https://wa.me/971586288776"
                className="w-full bg-[#F5A83A] text-[#3B151A] py-6 rounded-3xl font-black text-2xl hover:bg-white transition-all shadow-2xl"
              >
                שלחו הודעה <Icon icon="ph:whatsapp-logo-fill" className="inline-block mr-2" />
              </a>
            </div>
          </Reveal>
        </section>
        <Reveal>
          <section className="bg-[#8D182C] p-12 md:p-24 rounded-[5rem] text-center shadow-2xl">
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-6xl font-black text-white mb-8 font-heading leading-tight">מתכננים אירוע בדובאי?</h2>
              <p className="text-white/80 text-xl font-bold mb-12 leading-relaxed">
                אנחנו דואגים לכל מה שצריך – מהשף ועד הציוד והשירות – כדי שאתם תוכלו פשוט ליהנות.
              </p>
              <a
                href="https://wa.me/971586288776"
                className="inline-flex items-center gap-6 bg-white text-[#3B151A] px-16 py-8 rounded-[3rem] font-black text-3xl shadow-2xl hover:bg-[#F5A83A] transition-all transform hover:scale-105"
              >
                לקבלת הצעת מחיר <Icon icon="ph:whatsapp-logo-fill" className="text-4xl text-[#25D366]" />
              </a>
            </div>
          </section>
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
