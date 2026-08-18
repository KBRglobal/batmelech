import { Icon } from '@iconify/react'
import { useLocale } from '../locale-context'

const LABELS = { he: 'תמונה זמנית', en: 'Photo coming soon', fr: 'Photo à venir' } as const

export function Photo({
  src,
  alt = '',
  className = '',
  real = false,
}: {
  src: string
  alt?: string
  className?: string
  real?: boolean
}) {
  const { locale } = useLocale()
  return (
    <div className="relative w-full h-full">
      <img src={src} alt={alt} className={className} />
      {!real && (
        <span className="absolute top-2 end-2 z-10 flex items-center gap-1 bg-black/70 text-white text-[9px] font-black px-2 py-1 rounded-full backdrop-blur-sm">
          <Icon icon="ph:camera-bold" />
          {LABELS[locale]}
        </span>
      )}
    </div>
  )
}
