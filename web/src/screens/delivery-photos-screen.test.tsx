// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeliveryPhotosScreen } from './delivery-photos-screen.tsx'

const HASH = 'a'.repeat(64)

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderScreen() {
  return render(<DeliveryPhotosScreen />)
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DeliveryPhotosScreen', () => {
  it('shows the dedicated empty state when there are no photos', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ photos: [] }))
    renderScreen()

    expect(await screen.findByText('עדיין אין תמונות מסירה')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/delivery-photos')
  })

  it('renders a photo card with name, formatted date, hotel, time and status', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        photos: [
          {
            id: 'o-1',
            name: 'דנה',
            date: '2099-08-14',
            time: '14:00',
            hotelName: 'Hilton',
            deliveryProofUrl: `https://example.com/${HASH}.jpg`,
            deliveryProofAt: Date.UTC(2099, 7, 14, 10, 0),
            status: 'נמסרה',
          },
        ],
      }),
    )
    renderScreen()

    await waitFor(() => {
      expect(screen.queryByText('טוענת תמונות מסירה')).toBeNull()
    })

    expect(screen.getByText('דנה')).toBeTruthy()
    expect(screen.getByText(/Hilton/)).toBeTruthy()
    expect(screen.getByText(/14:00/)).toBeTruthy()
    expect(screen.getByText(/נמסרה/)).toBeTruthy()

    const link = screen.getByRole('link', { name: /פתח בתצוגה מלאה/ })
    expect(link.getAttribute('href')).toBe(`https://example.com/${HASH}.jpg`)
    expect(link.getAttribute('target')).toBe('_blank')

    const image = screen.getByRole('img', { name: 'תמונת מסירה — דנה' })
    expect(image.getAttribute('src')).toBe(`https://example.com/${HASH}.jpg`)
  })

  it('shows an error state with retry when the server fails', async () => {
    fetchSpy.mockResolvedValue(new Response('no', { status: 500 }))
    renderScreen()

    expect(await screen.findByText('לא הצלחנו לטעון את תמונות המסירה')).toBeTruthy()

    fetchSpy.mockResolvedValue(jsonResponse({ photos: [] }))
    const button = screen.getByRole('button', { name: 'ניסיון נוסף' })
    button.click()

    expect(await screen.findByText('עדיין אין תמונות מסירה')).toBeTruthy()
  })
})
