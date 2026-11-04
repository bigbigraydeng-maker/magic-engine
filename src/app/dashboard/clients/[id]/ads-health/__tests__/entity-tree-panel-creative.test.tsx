import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import EntityTreePanel, { comparabilityText, resultNounOf, sharedResultType } from '../entity-tree-panel'
import type { AdNode, AdsetNode, EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'
import type { CreativeVerdict } from '@/lib/ads-strategy/entity-tree/creative-compare'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/clients/demo/ads-health',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const metrics = (spend: number, leads: number, msg = 0): EntityMetrics => ({
  spend, impressions: 1000, clicks: 80, linkClicks: 30, video3sViews: 200, leads, messagingConversations: msg,
  costPerLead: leads > 0 ? spend / leads : null, ctr: 0.03, activeDays: 5, linkClicksStored: true,
})

const verdict = (over: Partial<CreativeVerdict>): CreativeVerdict => ({
  resultType: 'lead', results: 0, costPerResult: null, linkClicks: 0, minLinkClicks: 150, comparability: 'enough', ...over,
})

const ad = (id: string, name: string, m: EntityMetrics, creative: CreativeVerdict): AdNode => ({
  id, name, state: 'running', effectiveStatus: 'ACTIVE', metrics: m, creative,
})

const adset = (id: string, name: string, over: Partial<AdsetNode>): AdsetNode => ({
  id, name, state: 'running', effectiveStatus: 'ACTIVE', dailyBudget: 50, currency: 'NZD',
  metrics: metrics(100, 5), ads: [], resultType: 'lead', audienceChangedOn: null, targetKnown: true, ...over,
})

function buildTree(): EntityTree {
  const groupC = adset('s-c', '组C', {
    resultType: 'lead',
    audienceChangedOn: '2026-10-25', targetKnown: true,
    ads: [
      ad('a-sh', 'Shanghai 版', metrics(120, 12), verdict({ linkClicks: 160, results: 12, costPerResult: 9.4, comparability: 'enough' })),
      ad('a-best', 'Best 版', metrics(40, 2), verdict({ linkClicks: 18, results: 2, costPerResult: 14.6, comparability: 'too_few_clicks' })),
    ],
  })
  const wa = adset('s-wa', 'WA组', {
    resultType: 'messaging_started',
    audienceChangedOn: null, targetKnown: true,
    metrics: metrics(60, 0, 6),
    ads: [
      ad('a-wa', 'WA 广告', metrics(60, 0, 6), verdict({ resultType: 'messaging_started', results: 6, comparability: 'only_one' })),
    ],
  })
  const video = adset('s-vid', '播放组', {
    resultType: null,
    audienceChangedOn: null, targetKnown: true,
    ads: [
      ad('a-vid', '播放广告', metrics(30, 0), verdict({ resultType: null, results: null, comparability: 'no_result_type' })),
    ],
  })
  return {
    window: { since: '2026-10-22', until: '2026-10-28', days: 7 },
    snapshotAt: '2026-10-28T12:30:00Z',
    campaigns: [{
      id: 'c1', name: '主系列', state: 'running', effectiveStatus: 'ACTIVE',
      metrics: metrics(300, 20), adsets: [groupC, wa, video],
      runningAdsets: 3, runningAds: 4, metricsShared: false,
      unplacedAds: { count: 0, spend: 0, leads: 0 },
    }],
    winnerBaseline: null,
  }
}

function stubFetch(compare: { minLinkClicks: number | null; offerNoun: string | null }) {
  const body = {
    success: true,
    tree: buildTree(),
    hiddenAdsets: 0,
    noPageRegistered: false,
    compare,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }))
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('EntityTreePanel creative scorecard', () => {
  it('shows comparability text for each ad', async () => {
    stubFetch({ minLinkClicks: 150, offerNoun: '团和出发档期' })
    render(<EntityTreePanel clientId="demo" />)
    expect(await screen.findByText('还不能比（点击 18/150）')).toBeTruthy()
    expect(await screen.findByText('够数了，可以并排看')).toBeTruthy()
  })

  it('shows reference, audience-change and offer lines', async () => {
    stubFetch({ minLinkClicks: 150, offerNoun: '团和出发档期' })
    render(<EntityTreePanel clientId="demo" />)
    expect(await screen.findByText(/只能当参考，不是因果/)).toBeTruthy()
    expect(await screen.findByText(/10-25 前后改过受众或版位/)).toBeTruthy()
    expect(await screen.findByText(/只有推同一个团和出发档期的素材才放一起比/)).toBeTruthy()
  })

  it('shows 开聊 column and only-one note for the WhatsApp group', async () => {
    stubFetch({ minLinkClicks: 150, offerNoun: '团和出发档期' })
    render(<EntityTreePanel clientId="demo" />)
    expect((await screen.findAllByRole('columnheader', { name: '开聊' })).length).toBe(1)
    expect(await screen.findByText('组里只有这一条')).toBeTruthy()
  })

  it('shows 不比单价 and the no-result-type note for the video group', async () => {
    stubFetch({ minLinkClicks: 150, offerNoun: '团和出发档期' })
    render(<EntityTreePanel clientId="demo" />)
    expect(await screen.findByText('不比单价')).toBeTruthy()
    expect(await screen.findByText(/不是按留资或开聊投的/)).toBeTruthy()
  })

  it('shows the threshold in the footer', async () => {
    stubFetch({ minLinkClicks: 150, offerNoun: '团和出发档期' })
    render(<EntityTreePanel clientId="demo" />)
    expect(await screen.findByText(/至少 150 次/)).toBeTruthy()
  })

  it('shows the no-threshold footer and hides the offer line when compare is empty', async () => {
    stubFetch({ minLinkClicks: null, offerNoun: null })
    render(<EntityTreePanel clientId="demo" />)
    expect(await screen.findByText(/这个行业还没定/)).toBeTruthy()
    expect(screen.queryByText(/只有推同一个/)).toBeNull()
  })
})

describe('comparabilityText', () => {
  it('maps every comparability state', () => {
    expect(comparabilityText(verdict({ comparability: 'no_result_type' })).text).toBe('不比单价')
    expect(comparabilityText(verdict({ comparability: 'only_one' })).text).toBe('组里只有这一条')
    expect(comparabilityText(verdict({ comparability: 'no_threshold' })).text).toBe('门槛未定')
    expect(comparabilityText(verdict({ comparability: 'clicks_not_stored' })).text).toBe('点击没记，判不了')
    expect(comparabilityText(verdict({ comparability: 'too_few_clicks', linkClicks: 18, minLinkClicks: 150 })).text).toBe('还不能比（点击 18/150）')
    expect(comparabilityText(verdict({ comparability: 'enough' })).text).toBe('够数了，可以并排看')
  })
})

describe('resultNounOf', () => {
  it('picks the shared noun or falls back to 结果', () => {
    expect(resultNounOf(['lead', 'lead'])).toBe('留资')
    expect(resultNounOf(['messaging_started'])).toBe('开聊')
    expect(resultNounOf(['lead', 'messaging_started'])).toBe('结果')
    expect(resultNounOf([null])).toBe('结果')
    expect(resultNounOf([])).toBe('结果')
  })

  it('sharedResultType: same type → that type; mixed gives mixed; empty or unreadable gives undefined', () => {
    expect(sharedResultType([{ resultType: 'messaging_started', targetKnown: true }, { resultType: 'messaging_started', targetKnown: true }])).toBe('messaging_started')
    expect(sharedResultType([{ resultType: null, targetKnown: true }])).toBeNull()
    expect(sharedResultType([{ resultType: 'lead', targetKnown: false }])).toBeUndefined()
    expect(sharedResultType([{ resultType: 'lead', targetKnown: true }, { resultType: 'messaging_started', targetKnown: true }])).toBe('mixed')
    expect(sharedResultType([])).toBeUndefined()
  })
})
