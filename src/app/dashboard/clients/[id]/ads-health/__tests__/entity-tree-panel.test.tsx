import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EntityTreePanel from '../entity-tree-panel'
import type { EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'
import type { EntityTreeResult } from '@/lib/ads-strategy/entity-tree/load'

const metrics = (spend: number, leads: number): EntityMetrics => ({
  spend, impressions: 1000, clicks: 80, linkClicks: 30, video3sViews: 200, leads, messagingConversations: 0,
  costPerLead: leads > 0 ? spend / leads : null, ctr: 0.03, activeDays: 7,
})

const tree: EntityTree = {
  window: { since: '2026-10-22', until: '2026-10-28', days: 7 },
  snapshotAt: '2026-10-28T12:30:00Z',
  winnerBaseline: null,
  campaigns: [
    {
      id: 'c1', name: '运行中系列', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(167, 11), runningAdsets: 2, runningAds: 2, metricsShared: false, unplacedAds: { count: 0, spend: 0, leads: 0 },
      adsets: [
        { id: 's1', name: '组A', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: 50, currency: 'NZD', metrics: metrics(91, 5), ads: [{ id: 'a1', name: '兵马俑视频', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(91, 5) }] },
        { id: 's2', name: '组C', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: null, currency: null, metrics: metrics(34, 4), ads: [{ id: 'a2', name: '短表单版', state: 'unknown', effectiveStatus: 'IN_PROCESS', metrics: metrics(3, 0) }] },
      ],
    },
    { id: 'c2', name: '早停的系列', state: 'stopped', effectiveStatus: 'PAUSED', metrics: metrics(0, 0), runningAdsets: 0, runningAds: 0, adsets: [], metricsShared: false, unplacedAds: { count: 0, spend: 0, leads: 0 } },
  ],
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }))
}

describe('EntityTreePanel', () => {
  it('lists running campaign with its ad sets and ads, and says when the status is from', async () => {
    mockFetch(200, { success: true, tree, hiddenAdsets: 0, noPageRegistered: false } satisfies Partial<EntityTreeResult> & { success: boolean })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/系列 · 运行中系列/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组A/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组C/)).toBeTruthy()
    expect(screen.getByText(/广告 · 兵马俑视频/)).toBeTruthy()
    expect(screen.getByText(/刚开关的几个小时内可能还没反映/)).toBeTruthy()
    expect(screen.getByText(/在投 2 个广告组、2 条广告/)).toBeTruthy()
    expect(screen.getByText('状态不明')).toBeTruthy()
    expect(screen.getByText(/每天预算：设在系列上，或读不到/)).toBeTruthy()
    expect(screen.getAllByText(/链接点击率/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/样本不足/).length).toBeGreaterThan(0)
  })

  it('有赢家基线时，漏斗对照赢家而不是写样本不足', async () => {
    const withWinner: EntityTree = {
      ...tree,
      winnerBaseline: { cpm: 12, linkCtr: 0.02, completion: 0.25, hook: 0.3 },
    }
    mockFetch(200, { success: true, tree: withWinner, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    expect((await screen.findAllByText(/赢家 \$12.0/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/样本不足/)).toBeNull()
  })

  it('puts stopped campaigns behind a collapsed section', async () => {
    mockFetch(200, { success: true, tree, hiddenAdsets: 0, noPageRegistered: false } satisfies Partial<EntityTreeResult> & { success: boolean })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/已停的系列 1 个/)).toBeTruthy()
  })

  it('does not call a pending-review campaign "stopped": it gets its own group', async () => {
    const pending: EntityTree = { ...tree, campaigns: [{ ...tree.campaigns[1], id: 'c3', name: '审核中系列', state: 'unknown', effectiveStatus: 'IN_PROCESS' }] }
    mockFetch(200, { success: true, tree: pending, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/状态还没确认的系列 1 个/)).toBeTruthy()
    expect(screen.queryByText(/已停的系列/)).toBeNull()
  })

  it('says how many ad sets were left out instead of claiming nothing runs', async () => {
    const empty: EntityTree = { ...tree, campaigns: [] }
    mockFetch(200, { success: true, tree: empty, hiddenAdsets: 3, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/另有 3 个广告组没有列出/)).toBeTruthy()
  })

  it('explains when the client has no registered page', async () => {
    const empty: EntityTree = { ...tree, campaigns: [] }
    mockFetch(200, { success: true, tree: empty, hiddenAdsets: 0, noPageRegistered: true })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/没有登记 Facebook 主页/)).toBeTruthy()
  })

  it('hides campaign totals that contain someone else\'s ad sets, and shows unplaced ads', async () => {
    const shared: EntityTree = { ...tree, campaigns: [{ ...tree.campaigns[0], metricsShared: true, unplacedAds: { count: 2, spend: 60, leads: 1 } }] }
    mockFetch(200, { success: true, tree: shared, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/系列合计不显示/)).toBeTruthy()
    expect(screen.getByText(/另有 2 条广告（多半已删除）花了 \$60/)).toBeTruthy()
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
