import { Icon } from '@iconify/react'

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
  return (
    <div className="relative w-full h-full">
      <img src={src} alt={alt} className={className} />
      {!real && (
        <span className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/70 text-white text-[9px] font-black px-2 py-1 rounded-full backdrop-blur-sm">
          <Icon icon="ph:camera-bold" />
          תמונה זמנית
        </span>
      )}
    </div>
  )
}
