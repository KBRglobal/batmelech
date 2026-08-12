// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { PendingScreen } from './pending-screen.tsx'

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{location.pathname}</output>
}

afterEach(cleanup)

describe('PendingScreen', () => {
  it('renders an explicit read-only development surface without an action', () => {
    const { container } = render(
      <MemoryRouter>
        <PendingScreen title="הזמנות" />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-route-status="pending"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'הזמנות' })).toBeTruthy()
    expect(screen.getByText(/לא מתבצעת כאן שמירה או פעולה/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a clear not-found error and returns to Today only after a click', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <MemoryRouter initialEntries={['/missing']}>
        <PendingScreen title="העמוד לא נמצא" notFound />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-route-status="not-found"]')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('current route').textContent).toBe('/missing')

    await user.click(screen.getByRole('link', { name: 'חזרה למסך היום' }))

    expect(screen.getByLabelText('current route').textContent).toBe(APP_ROUTES.today)
  })
})
