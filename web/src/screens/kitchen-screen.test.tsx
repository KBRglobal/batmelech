// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import { KitchenScreen } from './kitchen-screen.tsx'

const CATALOG: PreparationCatalog = {
  items: [
    { id: 'matbucha', category: 'salads', name: 'מטבוחה', procurement: { kind: 'recipe' } },
    { id: 'chicken', category: 'mains', name: 'עוף בתנור', procurement: { kind: 'recipe' } },
  ],
  lunchItems: [],
}

function kitchenStore(prepDone: Record<string, Record<string, unknown>> = {}): LegacyStore {
  return {
    orders: [
      {
        id: 'k1',
        date: '2099-08-14',
        name: 'קטי',
        time: '13:00',
        status: 'אושרה',
        hotelName: 'Atlantis',
        salads: { 'מטבוחה': { o: 3 } },
        mains: { 'עוף בתנור': 4 },
      },
    ],
    prepDone,
    settings: { preparationCatalog: CATALOG } as LegacyStore['settings'],
    menu: {},
  }
}

function stubKitchenApi(store: LegacyStore) {
  const posts: { path: string; body: unknown }[] = []
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/api/kitchen/state')) {
      return new Response(JSON.stringify({ revision: 1, data: store }), { status: 200 })
    }
    posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchStub)
  return posts
}

function renderKitchen() {
  return render(<MemoryRouter initialEntries={['/kitchen']}><KitchenScreen /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('KitchenScreen', () => {
  it('renders the dishes board with quantities and stage labels', async () => {
    stubKitchenApi(kitchenStore({ '2099-08-14': { 'salads|מטבוחה': 'started', 'mains|עוף בתנור': true } }))
    renderKitchen()
    await screen.findByText('מטבוחה')
    expect(screen.getByText('התחלתי להכין')).toBeTruthy()
    expect(screen.getByText('ארוז')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy() // one packed of two dishes
  })

  it('a tap advances the stage cycle through the kitchen API', async () => {
    const posts = stubKitchenApi(kitchenStore({ '2099-08-14': { 'mains|עוף בתנור': 'ready' } }))
    renderKitchen()
    await screen.findByText('עוף בתנור')

    await userEvent.setup().click(screen.getByRole('button', { name: /מטבוחה/u }))
    expect(posts[0]!.path).toContain('/api/kitchen/prep-stage')
    expect(posts[0]!.body).toMatchObject({ serviceDate: '2099-08-14', category: 'salads', itemName: 'מטבוחה', stage: 'started' })

    await waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(1))
    await userEvent.setup().click(screen.getByRole('button', { name: /עוף בתנור/u }))
    const chickenPost = posts.find((post) => (post.body as { itemName?: string }).itemName === 'עוף בתנור')
    expect(chickenPost?.body).toMatchObject({ stage: 'packed' }) // ready -> packed
  })

  it('the orders board shows the day with one-tap status chips', async () => {
    const posts = stubKitchenApi(kitchenStore())
    renderKitchen()
    await screen.findByText('מטבוחה')

    await userEvent.setup().click(screen.getByRole('button', { name: 'הזמנות היום' }))
    expect(screen.getByText('קטי')).toBeTruthy()
    expect(screen.getByText(/Atlantis/u)).toBeTruthy()

    await userEvent.setup().click(screen.getByRole('button', { name: 'מוכנה' }))
    const statusPost = posts.find((post) => post.path.includes('/api/kitchen/order-status'))
    expect(statusPost?.body).toMatchObject({ orderId: 'k1', status: 'מוכנה' })
  })

  it('shows an honest empty state when the date has no prep', async () => {
    stubKitchenApi({ ...kitchenStore(), orders: [] })
    renderKitchen()
    await screen.findByText('אין הכנות לתאריך הזה')
  })
})
