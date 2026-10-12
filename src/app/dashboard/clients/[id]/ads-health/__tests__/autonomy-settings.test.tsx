import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import AutonomySettings from '../autonomy-settings'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const config = {
  daily_budget_cap_cents: 15000,
  autonomy_mode: 'observe',
  creative_pool: [
    { kind: 'meta_video', ref: '111', status: 'candidate' },
    { kind: 'meta_video', ref: '222', status: 'candidate' },
  ],
}

function stubFetch() {
  const fn = vi.fn(async (url: string) => {
    if (url.endsWith('/labels')) {
      return Response.json({
        labels: { '111': { title: 'Best of China', subtitle: '15-second reel', publishedAt: '2026-10-11T08:05:56Z', url: 'https://www.facebook.com/reel/111' } },
      })
    }
    return Response.json({ success: true, config })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('AutonomySettings', () => {
  it('shows plain-language labels, dollars instead of cents, and video names', async () => {
    stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    expect(screen.getByDisplayValue('150')).toBeTruthy()
    expect(screen.getByText(/\$150 \/ 天/)).toBeTruthy()
    expect(screen.getByText('在每天上限内自动调整预算 / 暂停广告（需要先设好上面的每天上限）')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Best of China')).toBeTruthy())
    expect(screen.getByText('未能识别，请核对')).toBeTruthy()
    expect(document.body.textContent).not.toContain('素材池')
    expect(document.body.textContent).not.toContain('信封')
  })

  it('asks for confirmation before approving and does not call approve when declined', async () => {
    const fn = stubFetch()
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('批准').length).toBe(2))
    fireEvent.click(screen.getAllByText('批准')[0])
    expect(window.confirm).toHaveBeenCalledWith('批准后这条视频才允许用于广告。不会自动开广告、不花钱。')
    expect(fn.mock.calls.some(c => String(c[0]).includes('/approve'))).toBe(false)
  })
})
