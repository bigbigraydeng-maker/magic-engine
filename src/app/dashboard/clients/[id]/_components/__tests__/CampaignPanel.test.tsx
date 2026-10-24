/**
 * CampaignPanel — expired active campaigns fold into the collapsed "已结束" group.
 * No data is deleted; they are only hidden until the group is expanded.
 * Client viewers do not see internal notes that share the description field.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CampaignPanel } from '../CampaignPanel'

vi.mock('../VisualDirectionSection', () => ({ VisualDirectionSection: () => null }))

const base = { client_id: 'c1', status: 'active' as const }

describe('CampaignPanel expired grouping', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('hides expired campaigns until the ended group is expanded', async () => {
    const campaigns = [
      { ...base, id: 'a', title: 'Live Campaign', valid_until: '2999-01-01' },
      { ...base, id: 'b', title: 'Old Campaign', valid_until: '2020-01-01' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ campaigns: String(url).includes('status=active') ? campaigns : [] }),
    })))

    render(<CampaignPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('Live Campaign')).toBeTruthy())
    expect(screen.queryByText('Old Campaign')).toBeNull()

    fireEvent.click(screen.getByText(/已结束的活动/))
    await waitFor(() => expect(screen.getByText('Old Campaign')).toBeTruthy())
  })
})

const internalNote = {
  id: 'c1',
  client_id: 'client-1',
  status: 'active' as const,
  title: '春季团',
  description: 'PM 2026-10-06 指令：停放中，刻意的',
  source_urls: [],
  source_file_urls: [],
  semrush_keywords: [{ keyword: 'rival', volume: 1, kd: 1, intent: 'info', type: 'related' as const }],
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
  valid_until: '2999-01-01',
}

describe('推广活动卡片对客户隐藏内部备注', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('客户视图不显示内部备注', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewer: 'client', campaigns: [internalNote] }),
    })))
    render(<CampaignPanel clientId="client-1" />)
    expect(await screen.findByText('春季团')).toBeTruthy()
    expect(screen.queryByText(/PM 2026-10-06/)).toBeNull()
  })

  it('内部账号仍看得到备注', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewer: 'internal', campaigns: [internalNote] }),
    })))
    render(<CampaignPanel clientId="client-1" />)
    expect(await screen.findByText(/PM 2026-10-06/)).toBeTruthy()
  })
})
