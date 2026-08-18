import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocalIcon } from './local-icon.tsx'

export interface DeliveryMapStop {
  readonly key: string
  readonly sequence: number
  readonly customerName: string
  readonly destination: string
  readonly time: string
  readonly latitude: number | null
  readonly longitude: number | null
}

interface LocatedStop extends DeliveryMapStop {
  readonly latitude: number
  readonly longitude: number
}

const FALLBACK_PRIMARY = '#632128'

function isLocated(stop: DeliveryMapStop): stop is LocatedStop {
  return stop.latitude !== null && stop.longitude !== null
}

function primaryColor(): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    return value === '' ? FALLBACK_PRIMARY : value
  } catch {
    return FALLBACK_PRIMARY
  }
}

// Popup content is built with DOM APIs and textContent, never an HTML string, so
// customer-entered names can never inject markup into the map.
function popupContent(stop: LocatedStop): HTMLElement {
  const root = document.createElement('div')
  root.dir = 'rtl'
  root.style.fontFamily = 'inherit'
  root.style.minWidth = '10rem'
  const name = document.createElement('strong')
  name.textContent = `${stop.sequence}. ${stop.customerName}`
  name.style.display = 'block'
  root.append(name)
  if (stop.destination !== '') {
    const destination = document.createElement('span')
    destination.textContent = stop.destination
    destination.style.display = 'block'
    root.append(destination)
  }
  if (stop.time !== '') {
    const time = document.createElement('span')
    time.textContent = stop.time
    time.style.display = 'block'
    root.append(time)
  }
  return root
}

function markerIcon(sequence: number): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    html: `<span style="display:flex;width:30px;height:30px;align-items:center;justify-content:center;border-radius:9999px;background:var(--primary, ${FALLBACK_PRIMARY});color:var(--primary-foreground, #ffffff);font-size:0.8125rem;font-weight:900;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${String(sequence)}</span>`,
  })
}

function MapCanvas({ stops }: { readonly stops: readonly LocatedStop[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const signature = JSON.stringify(stops)

  useEffect(() => {
    const container = containerRef.current
    if (container === null || stops.length === 0) return
    let map: L.Map | null = null
    // Leaflet touches layout and SVG APIs that jsdom does not implement, so the whole
    // initialization is guarded: in tests the canvas simply stays empty.
    try {
      map = L.map(container, { scrollWheelZoom: false })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map)
      const points = stops.map(
        (stop) => [stop.latitude, stop.longitude] as [number, number],
      )
      L.polyline(points, { color: primaryColor(), weight: 3, opacity: 0.75 }).addTo(map)
      for (const stop of stops) {
        L.marker([stop.latitude, stop.longitude], {
          icon: markerIcon(stop.sequence),
          alt: stop.customerName,
        })
          .addTo(map)
          .bindPopup(popupContent(stop))
      }
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15 })
    } catch {
      try {
        map?.remove()
      } catch {
        /* jsdom teardown noise */
      }
      map = null
    }
    return () => {
      try {
        map?.remove()
      } catch {
        /* jsdom teardown noise */
      }
    }
    // The stops prop is rebuilt every render; the serialized signature keeps the map
    // from being torn down and recreated unless the route actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return (
    <div
      ref={containerRef}
      data-testid="deliveries-map-canvas"
      className="h-80 w-full overflow-hidden rounded-2xl border border-border sm:h-96"
    />
  )
}

export function DeliveriesMap({ stops }: { readonly stops: readonly DeliveryMapStop[] }) {
  const located = stops.filter(isLocated)
  if (located.length === 0) return null
  const unlocated = stops.filter((stop) => !isLocated(stop))
  return (
    <section
      aria-label="מפת המשלוחים"
      className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <LocalIcon name="ph:map-pin-bold" className="text-xl text-primary" />
        <h2 className="text-xl font-black text-primary">מפת המשלוחים</h2>
      </div>
      <div className="mt-5">
        <MapCanvas stops={located} />
      </div>
      {unlocated.length > 0 && (
        <p className="mt-4 text-xs font-black text-muted-foreground">
          בלי מיקום במפה: {unlocated.map((stop) => stop.customerName).join(', ')}
        </p>
      )}
    </section>
  )
}

export default DeliveriesMap
