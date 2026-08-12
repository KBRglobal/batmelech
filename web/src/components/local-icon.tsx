import type { CSSProperties, HTMLAttributes } from 'react'
import { LOCAL_ICON_PATHS, type LocalIconName } from './local-icon-assets'

export type { LocalIconName } from './local-icon-assets'

export type LocalIconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name: LocalIconName
  label?: string
}

export function LocalIcon({ name, label, className, style, ...spanProps }: LocalIconProps) {
  const iconUrl = `url("${LOCAL_ICON_PATHS[name]}")`
  const iconStyle: CSSProperties = {
    WebkitMaskImage: iconUrl,
    maskImage: iconUrl,
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    ...style,
  }
  const resolvedClassName = ['inline-block size-[1em] shrink-0 bg-current', className]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      {...spanProps}
      className={resolvedClassName}
      style={iconStyle}
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { 'aria-label': label, role: 'img' })}
    />
  )
}
