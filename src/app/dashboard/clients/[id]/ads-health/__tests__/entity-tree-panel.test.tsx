import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntityTreePanel, {
  applyRunningEntityFilter,
  showFromQuery,
} from '../entity-tree-panel'
import type { AdNode, EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'
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

let searchParamsValue = new URLSearchParams()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/clients/demo/ads-health',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParamsValue,
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); searchParamsValue = new URLSearchParams(); replaceMock.mockClear() })

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }))
}

describe('showFromQuery', () => {
  it('defaults to running when param missing or invalid', () => {
    expect(showFromQuery(null)).toBe('running')
    expect(showFromQuery('')).toBe('running')
    expect(showFromQuery('nope')).toBe('running')
  })

  it('accepts all', () => {
    expect(showFromQuery('all')).toBe('all')
  })
})

describe('applyRunningEntityFilter', () => {
  const stoppedAd = (id: string, name: string): AdNode => ({
    id, name, state: 'stopped', effectiveStatus: 'PAUSED', metrics: metrics(10, 0),
  })

  it('hides stopped ad sets and ads but keeps unknown-status ads visible', () => {
    const campaign = tree.campaigns[0]
    const withStopped: typeof campaign = {
      ...campaign,
      adsets: [
        campaign.adsets[0],
        {
          id: 's-stop', name: '已停组', state: 'stopped', effectiveStatus: 'PAUSED', dailyBudget: 20, currency: 'NZD', metrics: metrics(40, 2),
          ads: [stoppedAd('x1', '停1'), stoppedAd('x2', '停2'), stoppedAd('x3', '停3'), stoppedAd('x4', '停4')],
        },
        {
          ...campaign.adsets[0],
          id: 's-mix', name: '混合组', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: 30, currency: 'NZD', metrics: metrics(50, 3),
          ads: [
            { id: 'r1', name: '在投广告', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(30, 2) },
            { id: 'u1', name: '不明广告', state: 'unknown', effectiveStatus: 'IN_PROCESS', metrics: metrics(5, 0) },
            stoppedAd('s1', '组内已停'),
          ],
        },
      ],
    }
    const r = applyRunningEntityFilter(withStopped)
    expect(r.hiddenAdsetCount).toBe(1)
    expect(r.hiddenAdCount).toBe(5)
    expect(r.campaign.adsets.map(s => s.name)).toEqual(['组A', '混合组'])
    expect(r.campaign.adsets[1].ads.map(a => a.name)).toEqual(['在投广告', '不明广告'])
  })
})

describe('EntityTreePanel', () => {
  beforeEach(() => {
    searchParamsValue = new URLSearchParams()
  })

  it('lists running campaign with its ad sets and ads, and says when the status is from', async () => {
    mockFetch(200, { success: true, tree, hiddenAdsets: 0, noPageRegistered: false } satisfies Partial<EntityTreeResult> & { success: boolean })
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/系列 · 运行中系列/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组A/)).toBeTruthy()
    expect(screen.getByText(/广告组 · 组C/)).toBeTruthy()
    expect(screen.getByText('兵马俑视频')).toBeTruthy()
    expect(screen.getByText(/明早 01:30 以后才会反映/)).toBeTruthy()
    expect(screen.getByText(/在投 2 个广告组、2 条广告/)).toBeTruthy()
    expect(screen.getByText('状态不明')).toBeTruthy()
    expect(screen.getByText(/每天预算：设在系列上，或读不到/)).toBeTruthy()
    expect(screen.getAllByText('链接点击率').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/样本不足/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '只看在投' })).toBeTruthy()
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

  it('链接点击没存过时表格里写 —，收起区不写跟赢家比的 0%', async () => {
    const unknown = metrics(40, 5)
    unknown.ctr = null
    unknown.linkClicks = 0
    const withUnknown: EntityTree = {
      ...tree,
      winnerBaseline: { cpm: 12, linkCtr: 0.02, completion: 0.25, hook: 0.3 },
      campaigns: [{
        ...tree.campaigns[0],
        adsets: [{
          ...tree.campaigns[0].adsets[0],
          ads: [{ ...tree.campaigns[0].adsets[0].ads[0], metrics: unknown }],
        }],
      }],
    }
    mockFetch(200, { success: true, tree: withUnknown, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    await screen.findByText('兵马俑视频')
    const rows = screen.getAllByRole('row')
    const adRow = rows.find(r => r.textContent?.includes('兵马俑视频'))
    expect(adRow?.textContent).toContain('—')
    expect(screen.queryByText(/链接点击率 暂无数据/)).toBeNull()
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

  it('默认只看在投：藏已停广告组与已停广告，并显示另有提示', async () => {
    const stoppedAd = (id: string, name: string): AdNode => ({
      id, name, state: 'stopped', effectiveStatus: 'PAUSED', metrics: metrics(8, 0),
    })
    const filteredTree: EntityTree = {
      ...tree,
      campaigns: [{
        ...tree.campaigns[0],
        adsets: [
          tree.campaigns[0].adsets[0],
          {
            id: 's-hidden', name: '已停广告组', state: 'stopped', effectiveStatus: 'PAUSED', dailyBudget: 10, currency: 'NZD', metrics: metrics(32, 1),
            ads: [stoppedAd('h1', '停广一'), stoppedAd('h2', '停广二'), stoppedAd('h3', '停广三'), stoppedAd('h4', '停广四')],
          },
        ],
      }],
    }
    mockFetch(200, { success: true, tree: filteredTree, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    await screen.findByText(/系列 · 运行中系列/)
    expect(screen.getByText(/广告组 · 组A/)).toBeTruthy()
    const campaignCard = screen.getByText(/系列 · 运行中系列/).closest('.rounded-xl')
    expect(campaignCard).toBeTruthy()
    const visibleAdsetBlocks = campaignCard!.querySelectorAll(':scope > div .border-l-2.pl-3')
    expect([...visibleAdsetBlocks].some(el => el.textContent?.includes('已停广告组'))).toBe(false)
    const hiddenDetails = screen.getByText(/另有 1 个已停广告组、4 条已停广告（点开看）/).closest('details')
    expect(hiddenDetails?.textContent).toContain('停广一')
    expect(screen.getByText(/另有 1 个已停广告组、4 条已停广告（点开看）/)).toBeTruthy()
  })

  it('切到全部后展示已停广告组，与原先一致', async () => {
    searchParamsValue = new URLSearchParams('show=all')
    const stoppedAd = (id: string, name: string): AdNode => ({
      id, name, state: 'stopped', effectiveStatus: 'PAUSED', metrics: metrics(8, 0),
    })
    const filteredTree: EntityTree = {
      ...tree,
      campaigns: [{
        ...tree.campaigns[0],
        adsets: [
          tree.campaigns[0].adsets[0],
          {
            id: 's-hidden', name: '已停广告组', state: 'stopped', effectiveStatus: 'PAUSED', dailyBudget: 10, currency: 'NZD', metrics: metrics(32, 1),
            ads: [stoppedAd('h1', '停广一')],
          },
        ],
      }],
    }
    mockFetch(200, { success: true, tree: filteredTree, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    await screen.findByText(/广告组 · 已停广告组/)
    expect(screen.getByText('停广一')).toBeTruthy()
    expect(screen.queryByText(/另有 1 个已停广告组/)).toBeNull()
  })

  it('点击全部会把 show=all 写进网址', async () => {
    mockFetch(200, { success: true, tree, hiddenAdsets: 0, noPageRegistered: false })
    render(<EntityTreePanel clientId="c" />)
    await screen.findByText(/系列 · 运行中系列/)
    await userEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining('show=all'),
      { scroll: false },
    )
  })
})
