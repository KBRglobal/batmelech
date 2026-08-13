import { Icon } from '@iconify/react'
import { PageHero } from '../components/page-hero'
import { Reveal } from '../components/reveal'

const PHOTOS = [
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Hgw2QN4Smv3.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/bq8wCPGKU11.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/fbh1mGqHGeE.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/Tr7Zvl6EB0X.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/d31Kxj4sAHE.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/hqJqmcg5k3O.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/T9Q0QhPImYP.jpeg',
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/XE7I0jbpGOl.jpeg',
]

export function Gallery() {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir="rtl">
      <PageHero
        active="/gallery"
        size="compact"
        badge="Our Luxury Moments"
        title={['הטעם', 'בעיניים']}
        subtitle='מבט קרוב על האירועים, המנות והאנשים שהופכים את "בת מלך" לחוויה הקולינרית הכשרה המובילה בדובאי.'
        image={PHOTOS[0]}
      />
      <main className="pt-16 max-w-7xl mx-auto px-6">
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {PHOTOS.map((img, i) => (
            <Reveal key={img} delay={(i % 4) * 80} className="break-inside-avoid">
              <img src={img} className="w-full rounded-[2rem] shadow-lg border-2 border-white transition-transform hover:scale-[1.02]" />
            </Reveal>
          ))}
        </div>
        <Reveal>
          <section className="mt-32 bg-white p-12 md:p-24 rounded-[5rem] text-center border-2 border-[#EDB2C1]/20 shadow-2xl">
            <h2 className="text-4xl md:text-5xl font-black font-heading mb-8">בואו להיות חלק מהתמונה</h2>
            <p className="text-[#3B151A]/70 text-xl font-bold mb-12">החופשה הבאה שלכם בדובאי יכולה להיראות ככה. צרו איתנו קשר עוד היום.</p>
            <a
              href="https://wa.me/971586288776"
              className="inline-flex items-center gap-6 bg-[#3B151A] text-white px-16 py-8 rounded-full font-black text-2xl shadow-2xl hover:bg-[#F5A83A] hover:text-[#3B151A] transition-all transform hover:scale-105"
            >
              לשיחה אישית בוואטסאפ <Icon icon="ph:chat-circle-dots-fill" className="text-3xl" />
            </a>
          </section>
        </Reveal>
      </main>
    </div>
  )
}
