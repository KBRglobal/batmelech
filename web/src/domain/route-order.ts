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

/**
 * Reads the manual route override for one service date out of the raw
 * `settings.routeOverrides` value, which is untyped passthrough data.
 *
 * Returns the stored order-id list, or null when there is no usable override for the
 * date (missing, not an object, not an array, or an array with no string ids).
 */
export function readRouteOverride(
  routeOverrides: unknown,
  serviceDate: string,
): readonly string[] | null {
  if (typeof routeOverrides !== 'object' || routeOverrides === null || Array.isArray(routeOverrides)) {
    return null
  }
  const value = (routeOverrides as Record<string, unknown>)[serviceDate]
  if (!Array.isArray(value)) return null
  const ids = value.filter((entry): entry is string => typeof entry === 'string')
  return ids.length === 0 ? null : ids
}

/**
 * Applies the operator's manual route override on top of the suggested order.
 *
 * Stops whose id appears in `overrideIds` come first, in the override's sequence.
 * Stops that are not listed keep their suggested relative order and follow after them.
 * Override ids that no longer match any stop are ignored, so a stale override can
 * never drop or duplicate a stop. With no usable override the suggested order is
 * returned untouched.
 */
export function applyRouteOverride<T extends { readonly id?: unknown }>(
  suggested: readonly T[],
  overrideIds: readonly string[] | null | undefined,
): readonly T[] {
  if (overrideIds == null || overrideIds.length === 0) return suggested
  const remaining = suggested.map((stop) => ({ stop, taken: false }))
  const overridden: T[] = []
  for (const overrideId of overrideIds) {
    const entry = remaining.find(
      (candidate) => !candidate.taken && candidate.stop.id === overrideId,
    )
    if (entry === undefined) continue
    entry.taken = true
    overridden.push(entry.stop)
  }
  const rest = remaining.filter((entry) => !entry.taken).map((entry) => entry.stop)
  return [...overridden, ...rest]
}

/**
 * Exposes the validated coordinates of one stop, or null when the stop has no
 * finite in-range hotel latitude/longitude. Same validation as the route ordering.
 */
export function stopCoordinates(stop: RouteStop): { latitude: number; longitude: number } | null {
  return parseCoordinates(stop)
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
export function buildMultiStopMapsUrl<T extends RouteStop>(orders: readonly T[]): string[] {
  const queries = orders.map(stopQuery).filter((query) => query !== '')
  const urls: string[] = []
  for (let start = 0; start < queries.length; start += MAX_STOPS_PER_MAPS_URL) {
    const chunk = queries.slice(start, start + MAX_STOPS_PER_MAPS_URL)
    urls.push(`https://www.google.com/maps/dir/${chunk.map(encodeURIComponent).join('/')}`)
  }
  return urls
}
