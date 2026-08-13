import { Icon } from '@iconify/react'
import { Link } from 'react-router'

export function Footer({ className = '' }: { className?: string }) {
  return (
    <footer className={`bg-white border-t-2 border-[#EDB2C1]/30 py-16 ${className}`}>
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-10 text-[#3B151A]/60 font-black text-sm uppercase tracking-widest">
        <div className="flex gap-10">
          <Link to="/legal" className="hover:text-[#F5A83A]">
            תנאי שימוש
          </Link>
          <Link to="/legal" className="hover:text-[#F5A83A]">
            מדיניות פרטיות
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Icon icon="ph:info-bold" />
          <span>© 2026 בת מלך דובאי.</span>
        </div>
      </div>
    </footer>
  )
}
