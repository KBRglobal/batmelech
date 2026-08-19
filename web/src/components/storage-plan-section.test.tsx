// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoragePlanSection } from './storage-plan-section.tsx'

const GB = 1024 * 1024 * 1024

function mockPlanResponse(overrides: Record<string, unknown> = {}) {
  const payload = {
    usedBytes: 0.5 * GB,
    objectCount: 42,
    limitBytes: 2 * GB,
    upgradeUrlYearly: '',
    upgradeUrlMonthly: '',
    domainName: 'batmelech.ae',
    domainExpiry: '',
    supportContact: 'KBR',
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
  )
}

describe('StoragePlanSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows usage out of the 2 GB plan and the domain line', async () => {
    mockPlanResponse()
    render(<StoragePlanSection />)
    await waitFor(() => {
      expect(screen.getByText('0.50 / 2.00 GB')).toBeTruthy()
    })
    expect(screen.getByText(/42 קבצים/)).toBeTruthy()
    expect(screen.getByText(/הדומיין batmelech\.ae פעיל/)).toBeTruthy()
    expect(screen.getByText(/לפנות ל-KBR/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows purchase links and the full-plan warning when over the limit', async () => {
    mockPlanResponse({
      usedBytes: 2.1 * GB,
      upgradeUrlYearly: 'https://buy.stripe.com/yearly-test',
      upgradeUrlMonthly: 'https://buy.stripe.com/monthly-test',
    })
    render(<StoragePlanSection />)
    await waitFor(() => {
      expect(screen.getByText(/חבילת האחסון מלאה/)).toBeTruthy()
    })
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://buy.stripe.com/yearly-test',
      'https://buy.stripe.com/monthly-test',
    ])
  })

  it('shows the domain expiry date when known', async () => {
    mockPlanResponse({ domainExpiry: '2027-03-15' })
    render(<StoragePlanSection />)
    await waitFor(() => {
      expect(screen.getByText(/בתוקף עד/)).toBeTruthy()
    })
  })

  it('renders nothing when the endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))
    const { container } = render(<StoragePlanSection />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })
})
