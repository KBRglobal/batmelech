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
  it('renders every operator destination as a real local route in desktop and mobile navigation', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={[APP_ROUTES.today]}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>,
    )

    // The mobile bottom bar keeps only the everyday destinations; the rest
    // live in the "more" bottom sheet, so open it before counting links.
    await user.click(screen.getByRole('button', { name: 'עוד' }))

    const expectedLinks = [
      ['היום', APP_ROUTES.today],
      ['הזמנות', APP_ROUTES.orders],
      ['הזמנה חדשה', APP_ROUTES.newOrder],
      ['סיכום הכנות', APP_ROUTES.preparation],
      ['רשימת קניות', APP_ROUTES.shoppingList],
      ['משלוחים', APP_ROUTES.deliveries],
      ['כספים', APP_ROUTES.finance],
      ['חשבוניות', APP_ROUTES.invoices],
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

  it('keeps its navigation chrome and full-screen height out of every print', () => {
    // The chrome stays in the layout while hidden, so a bon used to leave a
    // blank trailing page and a label roll could start past its first label.
    const { container } = render(
      <MemoryRouter initialEntries={[APP_ROUTES.today]}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>,
    )

    const root = container.firstElementChild!
    expect(root.className).toContain('print:min-h-0')
    for (const chrome of [container.querySelector('aside'), container.querySelector('header'), container.querySelector('nav[aria-label="ניווט ראשי לנייד"]')]) {
      expect(chrome?.className).toContain('print:hidden')
    }
    const main = container.querySelector('#main-content')!
    expect(main.className).toContain('print:min-h-0')
    expect(main.className).toContain('print:pb-0')
  })

  it('keeps secondary destinations inside the mobile more sheet and closes it on navigation', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[APP_ROUTES.today]}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>,
    )

    // Closed sheet: secondary destinations exist only in the desktop sidebar.
    expect(screen.getAllByRole('link', { name: 'הגדרות' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'עוד' }))
    expect(screen.getAllByRole('link', { name: 'הגדרות' })).toHaveLength(2)

    await user.click(screen.getAllByRole('link', { name: 'הגדרות' })[1]!)

    expect(screen.getByLabelText('current route').textContent).toBe(APP_ROUTES.settings)
    expect(screen.getAllByRole('link', { name: 'הגדרות' })).toHaveLength(1)
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
