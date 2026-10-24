import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../VisualDirectionSection', () => ({ VisualDirectionSection: () => null }))

import { CampaignPanel } from '../CampaignPanel'

const campaign = {
  id: 'c1',
  client_id: 'client-1',
  status: 'active',
  title: '春季团',
  description: 'PM 2026-10-06 指令：停放中，刻意的',
  source_urls: [],
  source_file_urls: [],
  semrush_keywords: [{ keyword: 'rival', volume: 1, kd: 1, intent: 'info', type: 'related' }],
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
}

describe('推广活动卡片', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('客户视图不显示内部备注和关键词拉取', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ viewer: 'client', campaigns: [campaign] }),
    } as Response)
    render(<CampaignPanel clientId="client-1" />)
    expect(await screen.findByText('春季团')).toBeInTheDocument()
    expect(screen.queryByText(/PM 2026-10-06/)).toBeNull()
    expect(screen.queryByText('推广关键词')).toBeNull()
  })

  it('内部账号仍看得到备注', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ viewer: 'internal', campaigns: [campaign] }),
    } as Response)
    render(<CampaignPanel clientId="client-1" />)
    expect(await screen.findByText(/PM 2026-10-06/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('春季团')).toBeInTheDocument())
  })
})
