import { Icon } from '@iconify/react'
import { PageHero } from './page-hero'
import { Reveal } from './reveal'
import { Footer } from './footer'

export type ExperienceContent = {
  tag: string
  title: [string, string]
  body: string
  bullets: Array<{ icon: string; text: string }>
  heroImg: string
  cornerImg: string
  galleryTitle: string
  gallery: [string, string, string]
  ctaTitle: string
  ctaBody: string
}

export function ExperienceLayout({ content }: { content: ExperienceContent }) {
  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir="rtl">
      <PageHero active="/events" size="tall" badge={content.tag} title={content.title} subtitle={content.body} image={content.heroImg} />

      <main className="relative max-w-7xl mx-auto px-6">
        <section className="mb-32 pt-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="flex flex-col gap-4">
              {content.bullets.map((b) => (
                <div key={b.text} className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-[#EDB2C1]/10">
                  <Icon icon={b.icon} className="text-[#F5A83A] text-2xl" />
                  <span className="font-bold text-lg text-[#3B151A]">{b.text}</span>
                </div>
              ))}
            </div>
            <div className="relative hidden lg:block">
              <div className="aspect-[4/5] rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white">
                <img src={content.heroImg} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-10 -left-10 w-64 aspect-square rounded-[3rem] overflow-hidden border-8 border-white shadow-2xl">
                <img src={content.cornerImg} className="w-full h-full object-cover" />
              </div>
            </div>
          </div>
        </section>

        <Reveal>
          <section className="mb-32">
            <h2 className="text-4xl font-black font-heading mb-12">{content.galleryTitle}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {content.gallery.map((img) => (
                <div key={img} className="h-96 rounded-[3rem] overflow-hidden shadow-xl">
                  <img src={img} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section className="bg-[#3B151A] p-12 md:p-24 rounded-[5rem] text-center shadow-2xl">
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-6xl font-black text-white mb-8 font-heading leading-tight">{content.ctaTitle}</h2>
              <p className="text-white/60 text-xl font-bold mb-12 leading-relaxed">{content.ctaBody}</p>
              <a
                href="https://wa.me/971586288776"
                className="inline-flex items-center gap-6 bg-[#F5A83A] text-[#3B151A] px-16 py-8 rounded-[3rem] font-black text-3xl shadow-2xl hover:bg-white transition-all transform hover:scale-105"
              >
                לקבלת הצעת מחיר לחצו כאן <Icon icon="ph:whatsapp-logo-fill" className="text-4xl" />
              </a>
            </div>
          </section>
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
