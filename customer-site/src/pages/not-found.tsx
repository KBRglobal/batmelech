import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'

export function NotFound() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-20" dir="rtl">
      <PageHero
        active=""
        size="compact"
        title={['הדף', 'לא נמצא']}
        subtitle="הקישור שהגעתם דרכו כבר לא קיים, אבל התפריט שלנו כן."
        image="https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/ZEd1RfEEqbe.jpeg"
        imageAlt="מטעמי בת מלך - מטבח ביתי כשר בדובאי"
      />
      <main className="max-w-3xl mx-auto px-6 py-20 text-center">
        <Link
          to="/"
          className="bg-[#3B151A] text-white px-10 py-5 rounded-full font-black text-lg hover:bg-[#F5A83A] transition-all shadow-xl inline-flex items-center gap-3"
        >
          חזרה לדף הבית <Icon icon="ph:house-fill" />
        </Link>
      </main>
      <Footer />
    </div>
  )
}
