/**
 * 「等你点头」标签：读取失败 / 空列表都必须有明确状态，不能永远停在「加载中…」（#3093 S4）。
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AutoPausePanel from '../auto-pause-panel'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function stubResponse(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response)
}

describe('AutoPausePanel loading states', () => {
  it('shows an error and a retry button when fetch rejects, then recovers', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [], hasMore: false }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<AutoPausePanel clientId="c1" />)

    await waitFor(() => expect(screen.getByText(/读取失败/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()

    await userEvent.click(screen.getByText('重试'))
    await waitFor(() => expect(screen.getByText(/目前没有等你点头/)).toBeTruthy())
  })

  it('shows the status code on a 403 instead of loading forever', async () => {
    vi.stubGlobal('fetch', stubResponse(403, { error: 'Forbidden' }))
    render(<AutoPausePanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/读取失败（403）/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()
  })

  it('shows the empty state on 200 with no items', async () => {
    vi.stubGlobal('fetch', stubResponse(200, { items: [], hasMore: false }))
    render(<AutoPausePanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/目前没有等你点头/)).toBeTruthy())
    expect(screen.queryByText('加载中…')).toBeNull()
  })
})
