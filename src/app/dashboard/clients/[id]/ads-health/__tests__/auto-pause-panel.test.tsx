/**
 * 「等你点头」标签：读取失败 / 空列表都必须有明确状态，不能永远停在「加载中…」（#3093 S4）。
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AutoPausePanel from '../auto-pause-panel'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function stubFetch(
  pending: unknown,
  overrides?: Partial<{ pendingStatus: number }>,
) {
  const pendingStatus = overrides?.pendingStatus ?? 200
  return vi.fn(async (url: string) => {
    if (url.includes('/ad-health/auto-pause') && !url.includes('/decision')) {
      return {
        ok: pendingStatus < 400,
        status: pendingStatus,
        json: async () => pending,
      } as unknown as Response
    }
    if (url.includes('/confirmation-cards')) {
      return { ok: true, status: 200, json: async () => ({ cards: [] }) } as unknown as Response
    }
    if (url.includes('/meta-ads/actions')) {
      return { ok: true, status: 200, json: async () => ({ success: true, actions: [] }) } as unknown as Response
    }
    if (url.includes('/ad-strategy-config')) {
      return { ok: true, status: 200, json: async () => ({ config: {} }) } as unknown as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
  }) as unknown as typeof fetch
}

describe('AutoPausePanel loading states', () => {
  it('shows an error and a retry button when fetch rejects, then recovers', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(stubFetch({ items: [], hasMore: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AutoPausePanel clientId="c1" />)

    await waitFor(() => expect(screen.getByText(/读取失败/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()

    await userEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(screen.getByText(/这一栏目前没有等你点头的暂停建议/)).toBeTruthy())
  })

  it('shows the status code on a 403 instead of loading forever', async () => {
    vi.stubGlobal('fetch', stubFetch({ error: 'Forbidden' }, { pendingStatus: 403 }))
    render(<AutoPausePanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/读取暂停建议失败（403）/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()
  })

  it('shows the empty state on 200 with no items', async () => {
    vi.stubGlobal('fetch', stubFetch({ items: [], hasMore: false }))
    render(<AutoPausePanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/这一栏目前没有等你点头的暂停建议/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()
  })
})
