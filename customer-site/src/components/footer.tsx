import { Icon } from '@iconify/react'
import { Link } from 'react-router'

const QUICK_LINKS = [
  { to: '/weekdays', label: 'תפריט יום חול' },
  { to: '/shabbat-order', label: 'שבת קודש' },
  { to: '/events', label: 'אירועים' },
  { to: '/gallery', label: 'גלריה' },
  { to: '/kashrut', label: 'כשרות' },
  { to: '/story', label: 'עלינו' },
]

export function Footer({ className = '' }: { className?: string }) {
  return (
    <footer className={`bg-white border-t-2 border-[#EDB2C1]/30 pt-20 pb-10 ${className}`}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 pb-16 border-b border-[#EDB2C1]/20">
          <div className="flex flex-col gap-4">
            <Link to="/" className="w-16 h-16 rounded-full overflow-hidden border-2 border-[#EDB2C1]/30 shadow-md">
              <img src="/site/assets/logo.jpg" alt="בת מלך" className="w-full h-full object-cover" />
            </Link>
            <p className="text-[#3B151A]/60 font-bold text-sm leading-relaxed">מטבח ביתי כשר בדובאי — מבושל טרי ומגיע חם אליכם.</p>
            <a
              href="https://www.instagram.com/bat_melech_kitchen/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-black text-sm w-fit"
            >
              <Icon icon="ph:instagram-logo-bold" className="text-xl" />
              Instagram
            </a>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">ניווט מהיר</h4>
            {QUICK_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">יצירת קשר</h4>
            <a href="tel:+971586288776" className="flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm" dir="ltr">
              <Icon icon="ph:phone-fill" />
              +971 58 628 8776
            </a>
            <a
              href="https://wa.me/971586288776"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm"
            >
              <Icon icon="ph:whatsapp-logo-fill" />
              הזמנות בוואטסאפ
            </a>
            <span className="flex items-center gap-2 text-[#3B151A]/60 font-bold text-sm">
              <Icon icon="ph:map-pin-fill" />
              משלוחים ברחבי דובאי
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="font-black text-[#3B151A] mb-1">מידע</h4>
            <Link to="/legal" className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              תנאי שימוש
            </Link>
            <Link to="/legal" className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              מדיניות פרטיות
            </Link>
            <Link to="/legal" className="flex items-center gap-2 text-[#8D182C] hover:text-[#F5A83A] font-bold text-sm w-fit">
              <Icon icon="ph:warning-circle-bold" />
              מידע על אלרגיות
            </Link>
            <Link to="/kashrut" className="text-[#3B151A]/60 hover:text-[#F5A83A] font-bold text-sm w-fit">
              כשרות ואיכות
            </Link>
          </div>
        </div>

        <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[#3B151A]/50 font-bold text-xs">
          <span>© {new Date().getFullYear()} מטעמי בת מלך דובאי. כל הזכויות שמורות.</span>
          <span>המזון עשוי להכיל אלרגנים. הפרטים המלאים בעמוד תנאי השימוש.</span>
        </div>
      </div>
    </footer>
  )
}
