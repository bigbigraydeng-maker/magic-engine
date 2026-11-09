import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EntityTreePanel, { comparabilityText } from '../entity-tree-panel'
import type { AdNode, AdsetNode, EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'
import type { CreativeVerdict } from '@/lib/ads-strategy/entity-tree/creative-compare'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/clients/demo/ads-health',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const metrics = (spend: number, leads: number): EntityMetrics => ({
  spend, impressions: 1000, clicks: 80, linkClicks: 30, video3sViews: 0, leads, messagingConversations: 0,
  costPerLead: leads > 0 ? spend / leads : null, ctr: 0.03, activeDays: 5, linkClicksStored: true,
})
const verdict = (over: Partial<CreativeVerdict>): CreativeVerdict => ({
  resultType: 'lead', results: 3, costPerResult: 10, linkClicks: 200, minLinkClicks: 150, comparability: 'enough', ...over,
})
const ad = (id: string, state: AdNode['state'], creative: CreativeVerdict): AdNode => ({
  id, name: id, state, effectiveStatus: state === 'running' ? 'ACTIVE' : 'PAUSED', metrics: metrics(30, 3), creative,
})
const adset = (over: Partial<AdsetNode>): AdsetNode => ({
  id: 's', name: '组', state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: 20, currency: 'NZD', metrics: metrics(60, 6),
  ads: [], resultType: 'lead', audienceChangedOn: null, targetKnown: true, ...over,
})
function treeWith(sets: AdsetNode[]): EntityTree {
  return {
    window: { since: '2026-10-28', until: '2026-11-03', days: 7 },
    snapshotAt: '2026-11-03T12:30:00Z',
    winnerBaseline: null,
    campaigns: [{
      id: 'c', name: '系列', state: 'running', effectiveStatus: 'ACTIVE', metrics: metrics(60, 6),
      runningAdsets: sets.length, runningAds: 1, metricsShared: false, unplacedAds: { count: 0, spend: 0, leads: 0 }, adsets: sets,
    }],
  }
}
function mockTree(tree: EntityTree) {
  const body = { success: true, tree, hiddenAdsets: 0, noPageRegistered: false, compare: { minLinkClicks: 150, offerNoun: null } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }))
}

describe('creative scorecard review fixes', () => {
  it('keeps the "reference, not causation" line in the default running-only view when siblings are stopped', async () => {
    mockTree(treeWith([adset({ name: '组A', ads: [ad('在投那条', 'running', verdict({})), ad('停掉那条', 'stopped', verdict({ comparability: 'too_few_clicks', linkClicks: 40 }))] })]))
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText('在投那条')).toBeTruthy()
    expect(screen.getByText(/只能当参考，不是因果/)).toBeTruthy()
  })

  it('says the target could not be read instead of calling the set a video / reach set', async () => {
    mockTree(treeWith([adset({ name: '读不到组', targetKnown: false, resultType: null, ads: [ad('某条', 'running', verdict({ resultType: null, results: null, comparability: 'target_unknown' }))] })]))
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText(/投放目标（表单、私信还是播放量）读不到/)).toBeTruthy()
    expect(screen.getByText('投放目标读不到')).toBeTruthy()
    expect(screen.queryByText(/不是按留资或开聊投的/)).toBeNull()
  })

  it('a campaign mixing lead and chat sets says so instead of showing 留资 0', async () => {
    mockTree(treeWith([
      adset({ id: 's1', name: '表单组', ads: [ad('表单那条', 'running', verdict({ comparability: 'only_one' }))] }),
      adset({ id: 's2', name: '私信组', resultType: 'messaging_started', ads: [ad('私信那条', 'running', verdict({ resultType: 'messaging_started', comparability: 'only_one' }))] }),
    ]))
    render(<EntityTreePanel clientId="c" />)
    expect(await screen.findByText('结果种类不一致，看下面各广告组')).toBeTruthy()
  })

  it('target_unknown text', () => {
    expect(comparabilityText(verdict({ comparability: 'target_unknown' })).text).toBe('投放目标读不到')
  })
})
