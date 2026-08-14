import { describe, expect, it } from 'vitest'
import type { LegacyStore } from './store.ts'
import {
  buildDeliveryDashboard,
  buildGoogleMapsSearchHref,
  deliveryProofSummary,
} from './delivery-dashboard.ts'

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested)
}

describe('delivery dashboard', () => {
  it('groups active deliveries by exact stored destination and keeps pickups separate', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [
        {
          id: 'second',
          date: '2026-08-14',
          name: 'לקוחה ב',
          place: 'Marina Hotel',
          address: 'Tower 7, Marina Walk',
          time: '12:00',
          total: '100.20',
          deposit: '.20',
          paid: 'מקדמה',
        },
        {
          id: 'first',
          date: '2026-08-14',
          name: 'לקוחה א',
          place: 'Marina Hotel',
          address: 'Tower 7, Marina Walk',
          time: '11:00',
          total: '.10',
          paid: 'לא',
        },
        {
          id: 'pickup',
          date: '2026-08-14',
          name: 'איסוף אמיתי',
          pickup: true,
          total: '25',
          paid: 'כן',
        },
        { id: 'cancelled', date: '2026-08-14', status: 'בוטלה', place: 'Hidden' },
        { id: 'delivered', date: '2026-08-14', status: 'נמסרה', place: 'Hidden too' },
      ],
    })

    expect(dashboard.activeOrderCount).toBe(3)
    expect(dashboard.excludedOrderCount).toBe(2)
    expect(dashboard.groups).toHaveLength(1)
    const group = dashboard.groups[0]!
    expect(group.deliveryOrderCount).toBe(2)
    expect(group.pickupOrderCount).toBe(1)
    expect(group.collectionMinorUnits).toBe(10_010)
    expect(group.collectionComplete).toBe(true)
    expect(group.destinations).toHaveLength(1)
    expect(group.destinations[0]?.orders.map(({ customerName }) => customerName)).toEqual([
      'לקוחה א',
      'לקוחה ב',
    ])
    expect(group.destinations[0]?.navigationHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Tower%207%2C%20Marina%20Walk',
    )
    expect(group.pickups[0]?.navigationHref).toBeNull()
  })

  it('never appends a city or trusts destination text as a URL', () => {
    expect(buildGoogleMapsSearchHref('javascript:alert(1)')).toBe(
      'https://www.google.com/maps/search/?api=1&query=javascript%3Aalert(1)',
    )
    expect(buildGoogleMapsSearchHref('Hotel, Abu Dhabi')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hotel%2C%20Abu%20Dhabi',
    )
    expect(buildGoogleMapsSearchHref('')).toBeNull()
    expect(buildGoogleMapsSearchHref('Hotel')?.includes('Dubai')).toBe(false)
  })

  it('chooses the same stored navigation text when equivalent destination casing is reordered', () => {
    const orders = [
      { id: 'one', date: '2026-08-14', place: 'Hotel B', address: 'tower 7' },
      { id: 'two', date: '2026-08-14', place: 'Hotel A', address: 'Tower 7' },
    ]

    const forward = buildDeliveryDashboard({ orders })
    const reverse = buildDeliveryDashboard({ orders: [...orders].reverse() })

    expect(forward.groups[0]?.destinations[0]?.navigationHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Tower%207',
    )
    expect(reverse.groups[0]?.destinations[0]?.navigationHref).toBe(
      forward.groups[0]?.destinations[0]?.navigationHref,
    )
    expect(reverse.groups[0]?.destinations[0]?.destination).toBe('Hotel A')
  })

  it('prefers a validated stored hotel navigation URL and groups matching Abu Dhabi stops', () => {
    const navigationUrl = 'https://www.google.com/maps/search/?api=1&query=Al%20Maryah%20Island%2C%20Abu%20Dhabi'
    const dashboard = buildDeliveryDashboard({
      orders: [
        {
          id: 'one',
          date: '2026-08-14',
          place: 'Rosewood Abu Dhabi',
          address: 'למסור בקבלה',
          hotelAddress: 'Al Maryah Island, Abu Dhabi',
          navigationUrl,
        },
        {
          id: 'two',
          date: '2026-08-14',
          place: 'Rosewood Abu Dhabi',
          address: 'חדר 42',
          hotelAddress: 'Al Maryah Island, Abu Dhabi',
          navigationUrl,
        },
      ],
    })

    expect(dashboard.groups[0]?.destinations).toHaveLength(1)
    expect(dashboard.groups[0]?.destinations[0]?.navigationHref).toBe(navigationUrl)
    expect(dashboard.groups[0]?.destinations[0]?.orders).toHaveLength(2)
    expect(dashboard.groups[0]?.destinations[0]?.navigationHref).not.toContain('Dubai')
  })

  it('rejects an untrusted stored URL and falls back to the saved hotel address', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [{
        id: 'unsafe-url',
        date: '2026-08-14',
        place: 'Hotel',
        address: 'room instructions',
        hotelAddress: 'Corniche Rd, Abu Dhabi',
        navigationUrl: 'javascript:alert(1)',
      }],
    })

    expect(dashboard.groups[0]?.destinations[0]?.navigationHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Corniche%20Rd%2C%20Abu%20Dhabi',
    )
  })

  it('routes a free-text hotel by hotel identity instead of reception instructions', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [{
        id: 'free-text-hotel',
        date: '2026-08-14',
        place: 'New Abu Dhabi Hotel',
        hotelName: 'New Abu Dhabi Hotel',
        hotelAddress: '',
        address: 'מסירה בקבלה',
        navigationUrl: '',
      }],
    })

    expect(dashboard.groups[0]?.destinations[0]?.navigationHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=New%20Abu%20Dhabi%20Hotel',
    )
    expect(dashboard.groups[0]?.destinations[0]?.orders[0]?.address).toBe('מסירה בקבלה')
  })

  it('keeps malformed active orders visible while blocking unsafe actions and totals', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [
        {
          id: 'bad',
          date: '2026-02-30',
          name: 'בדיקה',
          phone: 'javascript:alert(1)',
          total: '1,2,3',
        },
      ],
    })

    expect(dashboard.activeEmpty).toBe(false)
    expect(dashboard.groups[0]).toMatchObject({ dateKind: 'invalid', collectionComplete: false })
    const order = dashboard.groups[0]?.destinations[0]?.orders[0]
    expect(order).toMatchObject({
      customerName: 'בדיקה',
      navigationHref: null,
      telephoneHref: null,
      collectionState: 'invalid',
      collectionMinorUnits: null,
    })
    expect(dashboard.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'INVALID_SERVICE_DATE',
        'MISSING_DESTINATION',
        'INVALID_PHONE',
        'INVALID_MONEY',
      ]),
    )
  })

  it('blocks ambiguous edit routes for numeric and string ID collisions', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [
        { id: 7, date: '2026-08-14', place: 'A' },
        { id: '7', date: '2026-08-14', place: 'B' },
      ],
    })

    expect(
      dashboard.groups[0]?.destinations.flatMap(({ orders }) => orders).map(({ orderId }) => orderId),
    ).toEqual([null, null])
    expect(dashboard.warnings.filter(({ code }) => code === 'DUPLICATE_ORDER_ID')).toHaveLength(2)
  })

  it('keeps a unique numeric legacy ID visible without exposing a string mutation route', () => {
    const dashboard = buildDeliveryDashboard({
      orders: [{ id: 7, date: '2026-08-14', name: 'Legacy numeric', place: 'Hotel' }],
    })

    expect(dashboard.activeOrderCount).toBe(1)
    expect(dashboard.groups[0]?.destinations[0]?.orders[0]).toMatchObject({
      customerName: 'Legacy numeric',
      orderId: null,
    })
    expect(dashboard.warnings.map(({ code }) => code)).toContain('MISSING_ORDER_ID')
  })

  it('accepts only an https public-R2 delivery proof URL', () => {
    const proofHrefs = (deliveryProofUrl: string | undefined) =>
      buildDeliveryDashboard({
        orders: [{ id: 'proof', date: '2026-08-14', place: 'מלון', deliveryProofUrl }],
      }).groups[0]?.destinations[0]?.orders[0]?.proofPhotoHref

    expect(proofHrefs('https://pub-abc123.r2.dev/x.jpg')).toBe('https://pub-abc123.r2.dev/x.jpg')
    expect(proofHrefs('http://pub-abc123.r2.dev/x.jpg')).toBeNull()
    expect(proofHrefs('https://evil.example.com/x.jpg')).toBeNull()
    expect(proofHrefs('https://pub-abc123.r2.dev.evil.example.com/x.jpg')).toBeNull()
    expect(proofHrefs('https://r2.dev/x.jpg')).toBeNull()
    expect(proofHrefs('https://user:pass@pub-abc123.r2.dev/x.jpg')).toBeNull()
    expect(proofHrefs('javascript:alert(1)')).toBeNull()
    expect(proofHrefs('')).toBeNull()
    expect(proofHrefs(undefined)).toBeNull()
  })

  it('labels the courier check-in state and appends the ETA only when it is present', () => {
    const checkin = (order: Record<string, unknown>) =>
      buildDeliveryDashboard({
        orders: [{ id: 'checkin', date: '2026-08-14', place: 'מלון', ...order }],
      }).groups[0]?.destinations[0]?.orders[0]

    expect(checkin({ courierCheckinState: 'onTheWay' })).toMatchObject({
      checkinState: 'onTheWay',
      checkinLabel: 'בדרך',
      etaMinutes: null,
    })
    expect(checkin({ courierCheckinState: 'onTime', courierEtaMinutes: 15 })).toMatchObject({
      checkinState: 'onTime',
      checkinLabel: 'מגיע בזמן · 15 דק׳',
      etaMinutes: 15,
    })
    expect(checkin({ courierCheckinState: 'delayed', courierEtaMinutes: 40 })?.checkinLabel)
      .toBe('מתעכב · 40 דק׳')
    expect(checkin({ courierCheckinState: 'delayed', courierEtaMinutes: -5 })?.checkinLabel)
      .toBe('מתעכב')
    expect(checkin({ courierCheckinState: 'exploded' })).toMatchObject({
      checkinState: null,
      checkinLabel: null,
    })
    expect(checkin({})).toMatchObject({ checkinState: null, checkinLabel: null, deliveredAt: null })
    expect(checkin({ deliveredAt: 1_760_000_000_000 })?.deliveredAt).toBe(1_760_000_000_000)
    expect(checkin({ deliveredAt: 'yesterday' })?.deliveredAt).toBeNull()
  })

  it('reads a delivery proof summary without reporting anything for a bare order', () => {
    expect(deliveryProofSummary({ id: 'bare' })).toMatchObject({
      present: false,
      photoHref: null,
      proofAt: null,
      proofBy: '',
      deliveredAt: null,
      checkinState: null,
      checkinAt: null,
      courierNote: '',
    })
    expect(deliveryProofSummary({
      id: 'full',
      deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
      deliveryProofAt: 1_760_000_000_000,
      deliveryProofBy: 'שליח',
      deliveredAt: 1_760_000_100_000,
      courierCheckinState: 'delayed',
      courierCheckinAt: 1_759_999_000_000,
      courierEtaMinutes: 20,
      courierNote: 'תנועה כבדה',
    })).toMatchObject({
      present: true,
      photoHref: 'https://pub-abc123.r2.dev/proof.jpg',
      proofAt: 1_760_000_000_000,
      proofBy: 'שליח',
      deliveredAt: 1_760_000_100_000,
      checkinState: 'delayed',
      checkinLabel: 'מתעכב · 20 דק׳',
      checkinAt: 1_759_999_000_000,
      courierNote: 'תנועה כבדה',
    })
  })

  it('does not mutate the persisted state while deriving deterministic groups', () => {
    const store = {
      orders: [
        { id: 'b', date: '2026-08-15', name: 'ב', place: '__proto__', total: '0.20' },
        { id: 'a', date: '2026-08-14', name: 'א', pickup: true, total: '0.10' },
      ],
      futureTopLevel: { keep: true },
    } satisfies LegacyStore
    const snapshot = structuredClone(store)
    deepFreeze(store)

    expect(() => buildDeliveryDashboard(store)).not.toThrow()
    expect(store).toEqual(snapshot)
    expect(buildDeliveryDashboard(store).groups.map(({ serviceDate }) => serviceDate)).toEqual([
      '2026-08-14',
      '2026-08-15',
    ])
  })
})
