/**
 * GoogleAdsPanel — settings-page connection tile (Phase 18.B.3)
 *
 * Pins the four mutually-exclusive states the panel must surface so the
 * FDE always sees an unambiguous "what should I do next" signal:
 *
 *   loading            → spinner
 *   error              → red bubble + retry button
 *   disconnected       → grey card + 'Connect' CTA  (data-status=disconnected)
 *   needs_reconnect    → amber card + 'Reconnect'   (data-status=revoked|expired|error)
 *   connected          → green card + account_id + last-synced relative + manage link  (data-status=active)
 *
 * Visual badges + tailwind classes are not asserted (would break on minor
 * design tweaks); state pinning via data-testid + data-status keeps the
 * contract stable.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GoogleAdsPanel } from '../GoogleAdsPanel'

const CLIENT_ID = 'client-uuid-panel-test'

const ACTIVE_CONNECTION = {
  id: 'conn-1',
  provider: 'google_ads',
  display_name: 'CTS NZ Ads',
  account_id: '1234567890',
  location_name: null,
  status: 'active',
  scopes: [],
  last_synced_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  error_message: null,
}

const REVOKED_CONNECTION = {
  ...ACTIVE_CONNECTION,
  status: 'revoked',
  error_message: 'refresh_token revoked by user',
}

function mockFetchOnce(payload: unknown, opts: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => payload,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GoogleAdsPanel', () => {
  it('shows a loading spinner before the fetch resolves', async () => {
    // Never resolve, so the panel stays in loading state for the assertion.
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    expect(screen.getByTestId('google-ads-panel-loading')).toBeInTheDocument()
  })

  it('renders the disconnected card when the API returns connection: null', async () => {
    mockFetchOnce({ connection: null })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      const card = screen.getByTestId('google-ads-panel-disconnected')
      expect(card).toBeInTheDocument()
      expect(card).toHaveAttribute('data-status', 'disconnected')
    })
    // Disconnected card must offer a connect CTA that points at the legacy
    // connectors route — pin the href so a future refactor doesn't dead-link it.
    const connectLink = screen.getByRole('link', { name: /连接 Google Ads/i })
    expect(connectLink).toHaveAttribute(
      'href',
      `/dashboard/clients/${CLIENT_ID}/connectors/google-ads`,
    )
  })

  it('renders the connected card with account_id when status=active', async () => {
    mockFetchOnce({ connection: ACTIVE_CONNECTION })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      const card = screen.getByTestId('google-ads-panel-connected')
      expect(card).toBeInTheDocument()
      expect(card).toHaveAttribute('data-status', 'active')
    })
    expect(screen.getByText(ACTIVE_CONNECTION.account_id)).toBeInTheDocument()
    expect(screen.getByText(/CTS NZ Ads/)).toBeInTheDocument()
  })

  it('renders the needs_reconnect card for non-active statuses and surfaces the error_message', async () => {
    mockFetchOnce({ connection: REVOKED_CONNECTION })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      const card = screen.getByTestId('google-ads-panel-needs-reconnect')
      expect(card).toBeInTheDocument()
      expect(card).toHaveAttribute('data-status', 'revoked')
    })
    expect(screen.getByText(/refresh_token revoked by user/)).toBeInTheDocument()
  })

  it('renders the error card with the HTTP status when the fetch fails', async () => {
    mockFetchOnce({ error: 'forbidden' }, { ok: false, status: 403 })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      expect(screen.getByTestId('google-ads-panel-error')).toBeInTheDocument()
    })
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument()
  })

  it('fetches from the per-client endpoint exactly once on mount', async () => {
    mockFetchOnce({ connection: null })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/platform/google-ads`)
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
