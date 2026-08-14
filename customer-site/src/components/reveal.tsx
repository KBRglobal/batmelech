import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

function useRevealVisibility<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let revealed = false
    const inViewport = () => {
      const rect = node.getBoundingClientRect()
      return rect.top < window.innerHeight - 80 && rect.bottom > 0
    }

    const cleanup = () => {
      observer.disconnect()
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }

    const reveal = () => {
      if (revealed) return
      revealed = true
      setVisible(true)
      cleanup()
    }

    const check = () => {
      if (inViewport()) reveal()
    }

    // IntersectionObserver can silently skip elements during a jump-scroll (hash
    // link, back/forward scroll restore), leaving them stuck at opacity-0 forever.
    // The rect checks below are the safety net that guarantees they still reveal.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) reveal()
    }, { threshold: 0, rootMargin: '0px 0px -80px 0px' })
    observer.observe(node)

    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check, { passive: true })
    check()

    return cleanup
  }, [ref])

  return visible
}

export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const visible = useRevealVisibility(ref)

  return {
    ref,
    className: `transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`,
  }
}

export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useRevealVisibility(ref)

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}
