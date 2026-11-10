/**
 * GoogleAdsPanel — Google Ads customer ID (PR5 rewrite)
 *
 * The panel used to show a fake "connect via OAuth" status that could never
 * become true (nothing ever writes provider='google_ads' to
 * platform_oauth_connections — see docs/specs/2026-08-11-onboarding-
 * integrations-unify-v1.md §2.3). It's now a plain, always-truthful editable
 * field for clients.google_ads_customer_id, backed by
 * /api/clients/[id]/google-ads-customer-id.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GoogleAdsPanel } from '../GoogleAdsPanel'

const CLIENT_ID = 'client-uuid-panel-test'

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
  it('fetches from the customer-id endpoint (not the old fake platform/google-ads status route)', async () => {
    mockFetchOnce({ customer_id: null, source: 'none' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/google-ads-customer-id`)
    })
  })

  it('pre-fills the input with the resolved customer_id and shows its source', async () => {
    mockFetchOnce({ customer_id: '1234567890', source: 'clients_table' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)

    const input = await screen.findByPlaceholderText(/1234567890/)
    expect(input).toHaveValue('1234567890')
    expect(screen.getByText('手动设置')).toBeInTheDocument()
  })

  it('shows an empty input and "未设置" when no source has a value', async () => {
    mockFetchOnce({ customer_id: null, source: 'none' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByText('未设置')).toBeInTheDocument())
    expect(screen.getByPlaceholderText(/1234567890/)).toHaveValue('')
  })

  it('flags an inherited (non-manual) source distinctly, so FDE knows nobody confirmed it', async () => {
    mockFetchOnce({ customer_id: '9998887770', source: 'platform_oauth_connections' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/来自 OAuth 连接/)).toBeInTheDocument()
    })
  })

  it('PATCHes the new value on save and reloads', async () => {
    mockFetchOnce({ customer_id: null, source: 'none' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)

    const input = await screen.findByPlaceholderText(/1234567890/)
    fireEvent.change(input, { target: { value: '1234567890' } })

    const patchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ success: true, customer_id: '1234567890' }),
    })
    const reloadSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ customer_id: '1234567890', source: 'clients_table' }),
    })
    global.fetch = vi.fn()
      .mockImplementationOnce(patchSpy)
      .mockImplementationOnce(reloadSpy) as unknown as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => expect(screen.getByText('✓ 已保存')).toBeInTheDocument())
    expect(patchSpy).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/google-ads-customer-id`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ customer_id: '1234567890' }),
      }),
    )
  })

  it('shows the server error message when the save fails', async () => {
    mockFetchOnce({ customer_id: null, source: 'none' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)

    const input = await screen.findByPlaceholderText(/1234567890/)
    fireEvent.change(input, { target: { value: '123' } })

    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'customer_id must be 10 digits' }),
    }) as unknown as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      expect(screen.getByText('customer_id must be 10 digits')).toBeInTheDocument()
    })
  })

  it('no longer renders any link to the retired /connectors/google-ads page', async () => {
    mockFetchOnce({ customer_id: '1234567890', source: 'clients_table' })
    render(<GoogleAdsPanel clientId={CLIENT_ID} />)
    await waitFor(() => screen.getByPlaceholderText(/1234567890/))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
