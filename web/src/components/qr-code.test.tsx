// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QrCode, buildQrPath } from './qr-code.tsx'

describe('buildQrPath', () => {
  it('builds a non-empty module path for a URL', () => {
    const built = buildQrPath('https://batmelech.ae/')
    expect(built).not.toBeNull()
    expect(built!.modules).toBeGreaterThan(0)
    expect(built!.path).toContain('h1v1h-1z')
  })

  it('is deterministic for the same value', () => {
    expect(buildQrPath('https://batmelech.ae/')).toEqual(buildQrPath('https://batmelech.ae/'))
  })

  it('returns null instead of throwing for an impossible payload', () => {
    expect(buildQrPath('x'.repeat(20_000))).toBeNull()
  })
})

describe('QrCode', () => {
  it('renders an svg with the target recorded and a caption', () => {
    const { container } = render(
      <QrCode caption="להזמנה הבאה — סורקים" value="https://batmelech.ae/" />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('[data-qr-target="https://batmelech.ae/"]')).not.toBeNull()
    expect(screen.getByText('להזמנה הבאה — סורקים')).not.toBeNull()
  })

  it('renders nothing for an impossible payload', () => {
    const { container } = render(<QrCode value={'x'.repeat(20_000)} />)
    expect(container.firstChild).toBeNull()
  })
})
