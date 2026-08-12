import type { ImgHTMLAttributes } from 'react'

export const BAT_MELECH_LOGO_SRC = `${import.meta.env.BASE_URL}assets/bat-melech-logo.jpeg`

export type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> & {
  alt: string
}

export function BrandLogo({ alt, className, ...imageProps }: BrandLogoProps) {
  const resolvedClassName = ['object-contain', className].filter(Boolean).join(' ')

  return (
    <img
      {...imageProps}
      src={BAT_MELECH_LOGO_SRC}
      alt={alt}
      width={1280}
      height={1280}
      decoding="async"
      draggable={false}
      className={resolvedClassName}
    />
  )
}
