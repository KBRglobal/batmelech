import { describe, expect, it } from 'vitest'
import { buildMultiStopMapsUrl, suggestRouteOrder } from './route-order.ts'

interface TestStop {
  readonly id: string
  readonly time?: string
  readonly hotelLatitude?: number
  readonly hotelLongitude?: number
  readonly hotelAddress?: string
  readonly hotelName?: string
  readonly address?: string
  readonly place?: string
}

function ids(stops: readonly TestStop[]): readonly string[] {
  return stops.map(({ id }) => id)
}

describe('suggestRouteOrder', () => {
  it('sorts by the parsed delivery time and keeps untimed stops last in input order', () => {
    const routed = suggestRouteOrder<TestStop>([
      { id: 'afternoon', time: 'בערך 14:00' },
      { id: 'no-time-second', time: 'לתאם' },
      { id: 'morning', time: '9.30' },
      { id: 'no-time-first' },
      { id: 'noon', time: '11:00' },
    ])

    expect(ids(routed)).toEqual(['morning', 'noon', 'afternoon', 'no-time-second', 'no-time-first'])
  })

  it('ignores an unusable clock value and treats the stop as untimed', () => {
    const routed = suggestRouteOrder<TestStop>([
      { id: 'bad-hour', time: '99:99' },
      { id: 'real', time: '08:00' },
    ])

    expect(ids(routed)).toEqual(['real', 'bad-hour'])
  })

  it('reorders a 30-minute cluster nearest-neighbour from the Dubai seed', () => {
    const routed = suggestRouteOrder<TestStop>([
      { id: 'far', time: '10:00', hotelLatitude: 25.8, hotelLongitude: 55.9 },
      { id: 'nearest', time: '10:15', hotelLatitude: 25.21, hotelLongitude: 55.28 },
      { id: 'middle', time: '10:30', hotelLatitude: 25.4, hotelLongitude: 55.5 },
    ])

    expect(ids(routed)).toEqual(['nearest', 'middle', 'far'])
  })

  it('never moves a stop across a gap wider than the cluster window', () => {
    // 10:00 is 31 minutes before 10:31, so it forms its own cluster and stays first even
    // though it is the farthest stop. The next two are 29 minutes apart, so they cluster
    // and are re-sequenced nearest-neighbour from the previous stop.
    const routed = suggestRouteOrder<TestStop>([
      { id: 'early-far', time: '10:00', hotelLatitude: 25.8, hotelLongitude: 55.9 },
      { id: 'late-near', time: '10:31', hotelLatitude: 25.21, hotelLongitude: 55.28 },
      { id: 'late-middle', time: '11:00', hotelLatitude: 25.4, hotelLongitude: 55.5 },
    ])

    expect(ids(routed)).toEqual(['early-far', 'late-middle', 'late-near'])
  })

  it('keeps a stop without coordinates at its time position and fills the rest around it', () => {
    const routed = suggestRouteOrder<TestStop>([
      { id: 'unmapped', time: '10:00' },
      { id: 'far', time: '10:10', hotelLatitude: 25.8, hotelLongitude: 55.9 },
      { id: 'near', time: '10:20', hotelLatitude: 25.21, hotelLongitude: 55.28 },
    ])

    expect(ids(routed)).toEqual(['unmapped', 'near', 'far'])
  })

  it('rejects coordinates that are not finite numbers inside the real range', () => {
    const routed = suggestRouteOrder<TestStop>([
      { id: 'out-of-range', time: '10:00', hotelLatitude: 999, hotelLongitude: 55.9 },
      { id: 'far', time: '10:10', hotelLatitude: 25.8, hotelLongitude: 55.9 },
      { id: 'near', time: '10:20', hotelLatitude: 25.21, hotelLongitude: 55.28 },
    ])

    expect(ids(routed)).toEqual(['out-of-range', 'near', 'far'])
  })

  it('is deterministic and does not mutate or drop the input', () => {
    const stops: readonly TestStop[] = [
      { id: 'a', time: '10:20', hotelLatitude: 25.4, hotelLongitude: 55.5 },
      { id: 'b', time: '10:00', hotelLatitude: 25.21, hotelLongitude: 55.28 },
      { id: 'c', time: '10:10' },
      { id: 'd' },
    ]
    const snapshot = structuredClone(stops)

    const first = suggestRouteOrder(stops)
    const second = suggestRouteOrder(stops)

    expect(ids(first)).toEqual(ids(second))
    expect(first).toHaveLength(stops.length)
    expect(stops).toEqual(snapshot)
  })

  it('returns an empty route for no stops', () => {
    expect(suggestRouteOrder<TestStop>([])).toEqual([])
  })
})

describe('buildMultiStopMapsUrl', () => {
  it('prefers the hotel address and encodes every stop exactly once', () => {
    expect(buildMultiStopMapsUrl<TestStop>([
      { id: 'one', hotelAddress: 'Al Maryah Island, Abu Dhabi', hotelName: 'Rosewood', address: 'room 4', place: 'Rosewood' },
      { id: 'two', hotelName: 'Marina Hotel', address: 'Tower 7' },
      { id: 'three', address: 'Tower 9, Marina Walk' },
      { id: 'four', place: 'מלון' },
    ])).toEqual([
      'https://www.google.com/maps/dir/Al%20Maryah%20Island%2C%20Abu%20Dhabi/Marina%20Hotel/Tower%209%2C%20Marina%20Walk/%D7%9E%D7%9C%D7%95%D7%9F',
    ])
  })

  it('skips stops with no destination text and returns nothing when none remain', () => {
    expect(buildMultiStopMapsUrl<TestStop>([
      { id: 'blank', hotelAddress: '   ', hotelName: '', address: '', place: '' },
      { id: 'real', place: 'Hotel' },
    ])).toEqual(['https://www.google.com/maps/dir/Hotel'])
    expect(buildMultiStopMapsUrl<TestStop>([{ id: 'blank', place: '  ' }])).toEqual([])
    expect(buildMultiStopMapsUrl<TestStop>([])).toEqual([])
  })

  it('chunks at nine stops per link', () => {
    const stops = Array.from({ length: 20 }, (_, index) => ({ id: `stop-${index}`, place: `Hotel ${index}` }))

    const urls = buildMultiStopMapsUrl(stops)

    expect(urls).toHaveLength(3)
    expect(urls[0]!.split('/').length - 5).toBe(9)
    expect(urls[0]).toContain('Hotel%200')
    expect(urls[0]).toContain('Hotel%208')
    expect(urls[1]).toContain('Hotel%209')
    expect(urls[2]).toBe('https://www.google.com/maps/dir/Hotel%2018/Hotel%2019')
  })

  it('never treats destination text as a URL of its own', () => {
    expect(buildMultiStopMapsUrl<TestStop>([{ id: 'unsafe', place: 'javascript:alert(1)' }])).toEqual([
      'https://www.google.com/maps/dir/javascript%3Aalert(1)',
    ])
  })
})
