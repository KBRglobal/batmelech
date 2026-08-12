// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerOrderScreen, VERIFIED_CUSTOMER_ORDER_PATH } from './customer-order-screen.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CustomerOrderScreen', () => {
  it('hands off explicitly to the complete authoritative same-origin customer form', () => {
    render(<CustomerOrderScreen />)
    const link = screen.getByRole('link', { name: 'מעבר לטופס ההזמנה המלא' })
    expect(VERIFIED_CUSTOMER_ORDER_PATH).toBe('/order-form.html')
    expect(link.getAttribute('href')).toBe('/order-form.html')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.getAttribute('rel')).toBeNull()
    expect(link.getAttribute('href')).not.toContain('/app/')
    expect(link.getAttribute('href')).not.toContain('?')
    expect(link.getAttribute('href')).not.toContain('#')
  })

  it('does not load, render, or expose administrative state or a second pricing implementation', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { container } = render(<CustomerOrderScreen />)
    expect(container.querySelector('[data-admin-state-access="none"]')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('/api/state')
    expect(container.textContent).not.toContain('הזמנות פעילות')
    expect(container.textContent).not.toContain('לקוחות')
    expect(container.textContent).not.toMatch(/\$\d/u)
    expect(screen.getByText(/כל השדות וחישובי המחיר של טופס ההזמנה הציבורי הקיים/)).toBeTruthy()
  })

  it('keeps the public handoff Hebrew, RTL, keyboard reachable, and free of emoji', () => {
    const { container } = render(<CustomerOrderScreen />)
    const main = container.querySelector('main')
    expect(main?.getAttribute('dir')).toBe('rtl')
    expect(main?.getAttribute('lang')).toBe('he')
    expect(screen.getByRole('link', { name: 'מעבר לטופס ההזמנה המלא' }).className).toContain('min-h-12')
    expect(container.textContent).not.toMatch(/[\p{Extended_Pictographic}]/u)
  })
})
