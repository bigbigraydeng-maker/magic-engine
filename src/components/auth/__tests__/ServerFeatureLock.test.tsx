/**
 * Tests for ServerFeatureLock — the server-component gate that closes the
 * SSR data leak Wei Zheng flagged in H-1.
 *
 * Key invariants:
 *   - admin / paid_client → children render unchanged.
 *   - self_serve / portal_only → ONLY the modal renders. The children string
 *     must NOT appear in the rendered output.
 *   - Missing header → defaults to admin (open) so the gate fails-open
 *     rather than locking everyone out on a header misconfiguration.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock `next/headers` per-test so we can flip the x-user-tier value.
const headersMock = vi.fn<[], { get: (k: string) => string | null }>()
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

import { ServerFeatureLock, readUserTier } from '../ServerFeatureLock'

function setTier(value: string | null) {
  headersMock.mockReturnValue({
    get: (k: string) => (k === 'x-user-tier' ? value : null),
  })
}

beforeEach(() => {
  headersMock.mockReset()
})

describe('readUserTier', () => {
  it('returns the tier value when set', () => {
    setTier('paid_client')
    expect(readUserTier()).toBe('paid_client')
  })

  it('defaults to admin when the header is missing (fails open)', () => {
    setTier(null)
    expect(readUserTier()).toBe('admin')
  })

  it('defaults to admin when the header is an unknown value', () => {
    setTier('weird_value')
    expect(readUserTier()).toBe('admin')
  })

  it('accepts portal_only too', () => {
    setTier('portal_only')
    expect(readUserTier()).toBe('portal_only')
  })
})

describe('ServerFeatureLock — render gating', () => {
  it('renders children for admin', () => {
    setTier('admin')
    render(
      <ServerFeatureLock feature="Goals">
        <p>secret data</p>
      </ServerFeatureLock>,
    )
    expect(screen.getByText('secret data')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders children for paid_client', () => {
    setTier('paid_client')
    render(
      <ServerFeatureLock feature="Goals">
        <p>paid data</p>
      </ServerFeatureLock>,
    )
    expect(screen.getByText('paid data')).toBeTruthy()
  })

  it('hides children entirely for self_serve and shows the modal', () => {
    setTier('self_serve')
    render(
      <ServerFeatureLock feature="Goals" subtitle="Talk to your FDE.">
        <p>secret data</p>
      </ServerFeatureLock>,
    )
    // The child content must NOT be in the rendered HTML — closing the SSR leak.
    expect(screen.queryByText('secret data')).toBeNull()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-label')).toBe('Unlock Goals')
    expect(screen.getByText('Talk to your FDE.')).toBeTruthy()
  })

  it('hides children for portal_only too', () => {
    setTier('portal_only')
    render(
      <ServerFeatureLock feature="Strategy">
        <p>secret data</p>
      </ServerFeatureLock>,
    )
    expect(screen.queryByText('secret data')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders the modal with dismissible=false (no Maybe Later button)', () => {
    setTier('self_serve')
    render(
      <ServerFeatureLock feature="Goals">
        <p>x</p>
      </ServerFeatureLock>,
    )
    expect(screen.queryByText('Maybe later')).toBeNull()
    // Falls back to the Back-to-dashboard link.
    expect(screen.getByText('Back to dashboard')).toBeTruthy()
  })
})
