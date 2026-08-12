// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenState } from './screen-state.tsx'

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{location.pathname}</output>
}

function renderInRouter(element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/from']}>
      {element}
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('ScreenState', () => {
  it('exposes loading, error, and empty state semantics', () => {
    const loading = renderInRouter(<ScreenState kind="loading" />)
    expect(loading.container.querySelector('[data-state="loading"]')?.getAttribute('aria-busy')).toBe(
      'true',
    )
    expect(screen.getByText('טוענת נתונים')).toBeTruthy()
    loading.unmount()

    const error = renderInRouter(<ScreenState kind="error" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('לא הצלחנו לטעון את המסך')).toBeTruthy()
    error.unmount()

    const empty = renderInRouter(<ScreenState kind="empty" />)
    expect(empty.container.querySelector('[data-state="empty"]')?.getAttribute('aria-busy')).toBeNull()
    expect(screen.getByText('אין עדיין מה להציג')).toBeTruthy()
  })

  it('invokes retry and button actions only after an operator click', async () => {
    const retry = vi.fn()
    const action = vi.fn()
    const user = userEvent.setup()

    renderInRouter(
      <ScreenState
        kind="error"
        retry={retry}
        action={{ label: 'פעולה', onClick: action }}
      />,
    )

    expect(retry).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    await user.click(screen.getByRole('button', { name: 'פעולה' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('uses a real router link for a state action', async () => {
    const user = userEvent.setup()

    renderInRouter(
      <ScreenState kind="empty" action={{ label: 'להזמנות', to: '/orders' }} />,
    )

    await user.click(screen.getByRole('link', { name: 'להזמנות' }))
    expect(screen.getByLabelText('current route').textContent).toBe('/orders')
  })
})
