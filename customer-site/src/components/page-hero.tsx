import type { ReactNode } from 'react'
import { NavHeader } from './nav'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  logoAlt: 'מטעמי בת מלך',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: { logoAlt: 'Bat Melech' },
  fr: { logoAlt: 'Bat Melech' },
}

const SIZE_CLASS: Record<'screen' | 'tall' | 'compact', string> = {
  screen: 'min-h-screen',
  tall: 'min-h-[70vh]',
  compact: 'min-h-[45vh]',
}

export function PageHero({
  active,
  image,
  imageAlt,
  size = 'tall',
  badge,
  title,
  subtitle,
  children,
}: {
  active: string
  image: string
  imageAlt?: string
  size?: 'screen' | 'tall' | 'compact'
  badge?: string
  title: [string, string]
  subtitle?: string
  children?: ReactNode
}) {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <section className={`relative ${SIZE_CLASS[size]} flex flex-col overflow-hidden`}>
      <div className="absolute inset-0">
        <img src={image} alt={imageAlt ?? `${title[0]} ${title[1]}`} className="w-full h-full object-cover" />
        {/* Cream wordmark logo needs a guaranteed-dark upper half on ANY photo
            (kashrut's certificate hero is nearly white) — hold ~35% brand-brown
            through the logo zone before clearing to let the photo's color through. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(59,21,26,0.72) 0%, rgba(59,21,26,0.45) 40%, rgba(59,21,26,0.12) 65%, #F7ECE6 100%)',
          }}
        />
      </div>
      <div className="relative z-10 flex flex-col flex-grow">
        <NavHeader active={active} />
        <div className="flex-grow flex flex-col items-center justify-center text-center px-6 py-16">
          <div className="w-40 h-40 md:w-56 md:h-56 mb-6 animate-float">
            <img
              src="/site/assets/logo-cream.png"
              alt={t.logoAlt}
              className="w-full h-full object-contain drop-shadow-[0_2px_18px_rgba(59,21,26,0.65)]"
            />
          </div>
          <div className="max-w-4xl backdrop-blur-md bg-black/10 p-10 rounded-[4rem] border border-white/10 shadow-2xl">
            {badge && (
              <div className="inline-flex items-center gap-3 px-6 py-2 bg-[#F5A83A] text-white rounded-full text-xs font-black mb-8 shadow-xl tracking-widest uppercase">
                <span>{badge}</span>
              </div>
            )}
            <h1 className="text-4xl md:text-7xl font-black text-white font-heading tracking-tight leading-none mb-6">
              {title[0]} <span className="text-[#F5A83A]">{title[1]}</span>
            </h1>
            {subtitle && <p className="text-white/90 text-lg md:text-2xl font-bold max-w-3xl leading-relaxed mb-4">{subtitle}</p>}
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
