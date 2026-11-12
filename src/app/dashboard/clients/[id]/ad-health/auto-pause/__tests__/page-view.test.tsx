import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { AutoPausePageView } from '../auto-pause-page-view'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockFetches() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/ad-health/auto-pause') && !url.includes('/decision')) {
      return { ok: true, status: 200, json: async () => ({ items: [], hasMore: false }) }
    }
    if (url.includes('/confirmation-cards')) {
      return { ok: true, status: 200, json: async () => ({ cards: [] }) }
    }
    if (url.includes('/meta-ads/actions')) {
      return { ok: true, status: 200, json: async () => ({ success: true, actions: [] }) }
    }
    if (url.includes('/ad-strategy-config')) {
      return { ok: true, status: 200, json: async () => ({ config: { autopilot_dry_run: false } }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch)
}

describe('AutoPausePageView', () => {
  it('shows empty suggestion copy when nothing pending', async () => {
    mockFetches()
    render(<AutoPausePageView clientId="c1" variant="embed" />)
    await waitFor(() => {
      expect(screen.getByText(/这一栏目前没有等你点头的暂停建议/)).toBeTruthy()
    })
  })
})
