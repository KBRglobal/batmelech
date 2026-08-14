// Suggested driving order for a delivery day.
//
// A server-side mirror of this logic lives in server/telegram/delivery-day.js and is
// written from the same spec (time-first ordering, nearest-neighbour inside a 30-minute
// cluster, Dubai-centre initial seed, 9-stop Google Maps chunks). Any behavioural change
// here must be mirrored there, otherwise the courier's Telegram route and the admin
// panel's route disagree.

const CLUSTER_WINDOW_MINUTES = 30
const MAX_STOPS_PER_MAPS_URL = 9
const DUBAI_CENTRE: Coordinates = { latitude: 25.2048, longitude: 55.2708 }
const EARTH_RADIUS_KM = 6371
const TIME_PATTERN = /(\d{1,2})[:.](\d{2})/
const MAX_STOP_TEXT_LENGTH = 512

export interface RouteStop {
  readonly time?: unknown
  readonly hotelLatitude?: unknown
  readonly hotelLongitude?: unknown
  readonly hotelAddress?: unknown
  readonly hotelName?: unknown
  readonly address?: unknown
  readonly place?: unknown
}

interface Coordinates {
  readonly latitude: number
  readonly longitude: number
}

interface RouteEntry<T> {
  readonly stop: T
  readonly index: number
  readonly minutes: number | null
  readonly coordinates: Coordinates | null
}

function parseStopMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = TIME_PATTERN.exec(value)
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function parseCoordinates(stop: RouteStop): Coordinates | null {
  const latitude = stop.hotelLatitude
  const longitude = stop.hotelLongitude
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return null
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null
  }
  return { latitude, longitude }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function haversineKm(from: Coordinates, to: Coordinates): number {
  const deltaLatitude = toRadians(to.latitude - from.latitude)
  const deltaLongitude = toRadians(to.longitude - from.longitude)
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

function clusterByTimeWindow<T>(entries: readonly RouteEntry<T>[]): RouteEntry<T>[][] {
  const clusters: RouteEntry<T>[][] = []
  let current: RouteEntry<T>[] = []
  for (const entry of entries) {
    const previous = current.at(-1)
    if (previous !== undefined && entry.minutes! - previous.minutes! > CLUSTER_WINDOW_MINUTES) {
      clusters.push(current)
      current = []
    }
    current.push(entry)
  }
  if (current.length > 0) clusters.push(current)
  return clusters
}

/**
 * Orders the stops of one delivery day into a suggested driving sequence.
 *
 * Primary key is the delivery time parsed out of `time`; stops without a usable time keep
 * their original order and are appended last. Stops whose times sit within 30 minutes of
 * each other form a cluster, and inside a cluster the stops that carry coordinates are
 * re-sequenced nearest-neighbour from the previous stop (the first seed is Dubai centre).
 * A stop without coordinates cannot be measured, so it keeps its time position and the
 * nearest-neighbour permutation only fills the remaining slots around it.
 *
 * Pure and deterministic: equal distances and equal times fall back to input order.
 */
export function suggestRouteOrder<T extends RouteStop>(orders: readonly T[]): readonly T[] {
  const entries: RouteEntry<T>[] = orders.map((stop, index) => ({
    stop,
    index,
    minutes: parseStopMinutes(stop.time),
    coordinates: parseCoordinates(stop),
  }))
  const timed = entries
    .filter((entry) => entry.minutes !== null)
    .sort((left, right) => left.minutes! - right.minutes! || left.index - right.index)
  const untimed = entries.filter((entry) => entry.minutes === null)

  const sequenced: T[] = []
  let seed = DUBAI_CENTRE
  for (const cluster of clusterByTimeWindow(timed)) {
    const remaining = cluster.filter((entry) => entry.coordinates !== null)
    for (const entry of cluster) {
      if (entry.coordinates === null) {
        sequenced.push(entry.stop)
        continue
      }
      let bestPosition = 0
      let bestDistance = Number.POSITIVE_INFINITY
      remaining.forEach((candidate, position) => {
        const distance = haversineKm(seed, candidate.coordinates!)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPosition = position
        }
      })
      const [nearest] = remaining.splice(bestPosition, 1)
      seed = nearest!.coordinates!
      sequenced.push(nearest!.stop)
    }
  }
  for (const entry of untimed) sequenced.push(entry.stop)
  return sequenced
}

function stopQuery(stop: RouteStop): string {
  for (const value of [stop.hotelAddress, stop.hotelName, stop.address, stop.place]) {
    if (typeof value !== 'string' || value.length > MAX_STOP_TEXT_LENGTH) continue
    const trimmed = value.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/**
 * Builds Google Maps multi-stop directions links for the given stops, in the given order.
 *
 * Google Maps refuses very long waypoint lists, so the stops are chunked at 9 per link and
 * one link per chunk is returned. Stops with no usable destination text are skipped.
 */
export function buildMultiStopMapsUrl(orders: readonly RouteStop[]): string[] {
  const queries = orders.map(stopQuery).filter((query) => query !== '')
  const urls: string[] = []
  for (let start = 0; start < queries.length; start += MAX_STOPS_PER_MAPS_URL) {
    const chunk = queries.slice(start, start + MAX_STOPS_PER_MAPS_URL)
    urls.push(`https://www.google.com/maps/dir/${chunk.map(encodeURIComponent).join('/')}`)
  }
  return urls
}
