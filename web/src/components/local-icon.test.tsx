// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_ICON_PATHS } from './local-icon-assets.ts'
import { LocalIcon } from './local-icon.tsx'

afterEach(cleanup)

describe('LocalIcon', () => {
  it('maps every registered icon to a local inspected SVG asset path', () => {
    for (const [name, path] of Object.entries(LOCAL_ICON_PATHS)) {
      expect(name).toMatch(/^[a-z0-9]+:[a-z0-9-]+$/u)
      expect(path).toMatch(/^\/icons\/[a-z0-9-]+\.svg$/u)
      expect(path).not.toMatch(/^https?:/u)
    }
  })

  it('renders a decorative icon without exposing a redundant image role', () => {
    const { container } = render(<LocalIcon name="ph:calendar-bold" />)
    const icon = container.firstElementChild

    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('role')).toBeNull()
    expect(icon?.getAttribute('style')).toContain(
      'mask-image: url("/icons/ph-calendar-bold.svg")',
    )
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('http')
  })

  it('renders a standalone icon with an accessible label when requested', () => {
    render(<LocalIcon name="ph:warning-circle-bold" label="אזהרה" />)

    expect(screen.getByRole('img', { name: 'אזהרה' })).toBeTruthy()
  })
})
