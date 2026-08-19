import { useEffect, useState } from 'react'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { validatedProofHref } from '../domain/delivery-dashboard.ts'

export interface DeliveryPhoto {
  readonly id: string
  readonly name: string
  readonly date: string
  readonly time: string
  readonly hotelName: string
  readonly deliveryProofUrl: string
  readonly deliveryProofAt: number | null
  readonly status: string
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly retry: () => void }
  | { readonly kind: 'ready'; readonly photos: readonly DeliveryPhoto[] }

const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function formatServiceDate(value: string): string {
  if (!SERVICE_DATE_PATTERN.test(value)) return value
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function PhotoCard({ photo }: { readonly photo: DeliveryPhoto }) {
  const details = [
    formatServiceDate(photo.date),
    photo.hotelName,
    photo.time,
    photo.status,
  ].filter(Boolean)

  return (
    <a
      href={validatedProofHref(photo.deliveryProofUrl) ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={validatedProofHref(photo.deliveryProofUrl) ?? ''}
          alt={`תמונת מסירה — ${photo.name}`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <span className="absolute start-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[0.6875rem] font-black text-primary-foreground shadow-sm">
          <LocalIcon name="ph:image-bold" className="me-1 inline text-sm" />
          פתח בתצוגה מלאה
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <h2 className="font-black text-primary">{photo.name}</h2>
        <p className="text-xs font-bold text-muted-foreground">
          {details.join(' · ')}
        </p>
      </div>
    </a>
  )
}

export function DeliveryPhotosScreen() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setState({ kind: 'loading' })
      try {
        const response = await fetch('/api/delivery-photos', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          throw new Error(`unexpected status ${response.status}`)
        }
        const payload = (await response.json()) as { photos?: unknown }
        const photos = Array.isArray(payload?.photos)
          ? (payload.photos as DeliveryPhoto[])
          : []
        if (!cancelled) setState({ kind: 'ready', photos })
      } catch {
        if (!cancelled) {
          setState({
            kind: 'error',
            retry: () => {
              void load()
            },
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  if (state.kind === 'loading') {
    return <ScreenState kind="loading" title="טוענת תמונות מסירה" />
  }

  if (state.kind === 'error') {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את תמונות המסירה"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={state.retry}
      />
    )
  }

  if (state.photos.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title="עדיין אין תמונות מסירה"
        description="תמונות שמצולמות במסירה יופיעו כאן לפי סדר הזמן."
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
          תמונות מסירה
        </h1>
        <p className="mt-2 text-sm font-bold text-muted-foreground">
          כל תמונות ההוכחה מהמשלוחים, מסודרות מהחדשה לישנה.
        </p>
      </header>

      <section
        aria-label="גלריית תמונות מסירה"
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {state.photos.map((photo) => (
          <PhotoCard key={photo.id || photo.deliveryProofUrl} photo={photo} />
        ))}
      </section>
    </div>
  )
}
