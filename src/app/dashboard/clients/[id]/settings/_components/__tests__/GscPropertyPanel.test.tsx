/**
 * GscPropertyPanel — 魏征 2026-08-11 复审揪出的 BLOCKER 修复：GSC 授权完
 * 没地方选网站，同步管道会永久卡在 'partial'。这个组件补上那一步，同时
 * 是这次 PR5 里唯一一个"没有真实浏览器验证、但影响是否能合并"的新组件，
 * 至少要有渲染态烟雾测试兜底。
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GscPropertyPanel } from '../GscPropertyPanel'

const CLIENT_ID = 'client-uuid-gsc-property-test'

function mockFetchSequence(responses: Array<{ ok?: boolean; json: unknown }>) {
  let i = 0
  global.fetch = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve({ ok: r.ok ?? true, json: async () => r.json })
  }) as unknown as typeof fetch
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('GscPropertyPanel', () => {
  it('shows the not-connected message when GSC OAuth has not been done', async () => {
    mockFetchSequence([{ json: { connections: [] } }])
    render(<GscPropertyPanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/还没连上 Google Search Console/)).toBeInTheDocument()
    })
  })

  it('lists available sites and lets the FDE pick one when OAuth is done', async () => {
    mockFetchSequence([
      { json: { connections: [{ status: 'active' }] } },                                    // platform/gsc
      { json: { connectors: [{ anchor: 'gsc', config: null }] } },                           // connectors/status
      { json: { success: true, sites: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] } }, // gsc/sites
    ])
    render(<GscPropertyPanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('https://example.com/')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /就用这一个/ })).toBeDisabled()
  })

  it('shows a plain-language empty state when the account has zero GSC sites (not an error)', async () => {
    mockFetchSequence([
      { json: { connections: [{ status: 'active' }] } },
      { json: { connectors: [] } },
      { json: { success: true, sites: [] } },
    ])
    render(<GscPropertyPanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/没看到任何 Search Console 网站/)).toBeInTheDocument()
    })
  })

  it('surfaces google_unavailable distinctly from "zero sites"', async () => {
    mockFetchSequence([
      { json: { connections: [{ status: 'active' }] } },
      { json: { connectors: [] } },
      { json: { success: false, error: 'quota exceeded' } },
    ])
    render(<GscPropertyPanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/暂时问不到 Google/)).toBeInTheDocument()
    })
  })

  it('saves the chosen site via the same connect endpoint the old connectors page used', async () => {
    mockFetchSequence([
      { json: { connections: [{ status: 'active' }] } },
      { json: { connectors: [] } },
      { json: { success: true, sites: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] } },
    ])
    render(<GscPropertyPanel clientId={CLIENT_ID} />)

    const radio = await screen.findByRole('radio')
    fireEvent.click(radio)

    const saveSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    const reloadSpy1 = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connections: [{ status: 'active' }] }) })
    const reloadSpy2 = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connectors: [{ anchor: 'gsc', config: { site_url: 'https://example.com/' } }] }) })
    const reloadSpy3 = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, sites: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }] }) })
    global.fetch = vi.fn()
      .mockImplementationOnce(saveSpy)
      .mockImplementationOnce(reloadSpy1)
      .mockImplementationOnce(reloadSpy2)
      .mockImplementationOnce(reloadSpy3) as unknown as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /就用这一个/ }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/connectors/gsc/connect`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ config: { site_url: 'https://example.com/' } }),
      }),
    )
  })
})
