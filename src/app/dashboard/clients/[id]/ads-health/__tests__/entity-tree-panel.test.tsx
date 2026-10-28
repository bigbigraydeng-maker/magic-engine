import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EntityTreePanel from '../entity-tree-panel'
import type { EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'

const metrics = (spend: number, leads: number): EntityMetrics => ({
  spend, impressions: 1000, clicks: 30, leads, messagingConversations: 0,
  costPerLead: leads > 0 ? spend / leads : null, ctr: 0.03, activeDays: 7,
})

const tree: EntityTree = {
  window: { since: '2026-10-22', until: '2026-10-28', days: 7 },
  snapshotAt: '2026-10-28T12:30:00Z',
  campaigns: [
    {
      id: 'c1', name: '运行中系列', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(167, 11), runningAdsets: 2, runningAds: 2,
      adsets: [
        { id: 's1', name: '组A', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: 50, currency: 'NZD', metrics: metrics(91, 5), ads: [{ id: 'a1', name: '兵马俑视频', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(91, 5) }] },
        { id: 's2', name: '组C', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: null, currency: null, metrics: metrics(34, 4), ads: [{ id: 'a2', name: '短表单版', state: 'unknown', effectiveStatus: 'IN_PROCESS', metrics: metrics(3, 0) }] },
      ],
    },
    { id: 'c2', name: '早停的系列', state: 'stopped', effectiveStatus: 'PAUSED', metrics: metrics(0, 0), runningAdsets: 0, runningAds: 0, adsets: [] },
  ],
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }))
}

describe('EntityTreePanel', () => {
  it('lists running campaign with its ad sets and ads, and says when the status is from', async () => {
    mockFetch(200, { success: true, tree })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/系列 · 运行中系列/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组A/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组C/)).toBeTruthy()
    expect(screen.getByText(/广告 · 兵马俑视频/)).toBeTruthy()
    expect(screen.getByText(/今天新开的最晚明天下午才会出现/)).toBeTruthy()
    expect(screen.getByText(/在投 2 个广告组、2 条广告/)).toBeTruthy()
    expect(screen.getByText('状态不明')).toBeTruthy()
    expect(screen.getByText(/每天预算：读不到/)).toBeTruthy()
  })

  it('puts stopped campaigns behind a collapsed section', async () => {
    mockFetch(200, { success: true, tree })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/已停的系列 1 个/)).toBeTruthy()
  })

  it('renders nothing for non-staff (403)', async () => {
    mockFetch(403, { error: 'x' })
    const { container } = render(<EntityTreePanel clientId="c" />)
    await new Promise(r => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })

  it('says it could not read, instead of drawing zeros, on a server error', async () => {
    mockFetch(500, { error: 'boom' })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/读不到广告组和广告明细/)).toBeTruthy()
  })
})
