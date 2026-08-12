// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { AppShell } from './app-shell.tsx'

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{location.pathname}</output>
}

afterEach(cleanup)

describe('AppShell', () => {
  it('renders every operator destination as a real local route in desktop and mobile navigation', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[APP_ROUTES.today]}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>,
    )
    const expectedLinks = [
      ['היום', APP_ROUTES.today],
      ['הזמנות', APP_ROUTES.orders],
      ['הזמנה חדשה', APP_ROUTES.newOrder],
      ['סיכום הכנות', APP_ROUTES.preparation],
      ['רשימת קניות', APP_ROUTES.shoppingList],
      ['משלוחים', APP_ROUTES.deliveries],
      ['כספים', APP_ROUTES.finance],
      ['לקוחות', APP_ROUTES.customers],
      ['הגדרות', APP_ROUTES.settings],
    ] as const

    for (const [label, route] of expectedLinks) {
      const links = screen.getAllByRole('link', { name: label })
      expect(links).toHaveLength(2)
      expect(links.map((link) => link.getAttribute('href'))).toEqual([route, route])
    }

    const legacyLinks = screen.getAllByRole('link', { name: 'המערכת הישנה' })
    expect(legacyLinks).toHaveLength(2)
    expect(legacyLinks.map((link) => link.getAttribute('href'))).toEqual(['/legacy/', '/legacy/'])
    expect(legacyLinks.every((link) => link.getAttribute('target') === null)).toBe(true)

    expect(container.querySelector('a[href="#"]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('api.iconify.design')
  })

  it('navigates through an operator link and updates its active state', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[APP_ROUTES.today]}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>,
    )

    await user.click(screen.getAllByRole('link', { name: 'הזמנות' })[0]!)

    expect(screen.getByLabelText('current route').textContent).toBe(APP_ROUTES.orders)
    expect(
      screen
        .getAllByRole('link', { name: 'הזמנות' })
        .every((link) => link.getAttribute('aria-current') === 'page'),
    ).toBe(true)
  })
})
