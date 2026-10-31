import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

import WarMapPanel from '../war-map-panel'
import type { WarMapView } from '@/lib/ads-strategy/war-map/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function baseView(): WarMapView {
  return {
    generatedAt: '2026-10-20T03:26:00.000Z',
    countdown: {
      planStatus: 'draft',
      phaseName: '旺季 A',
      launchDate: '2026-10-22',
      targetDate: '2026-11-04',
      daysToLaunch: 2,
      daysToTarget: 15,
      actualLaunchDay: null,
      planStale: false,
    },
    clocks: { dataDay: '2026-10-20', fetchedAt: '2026-10-20T03:26:00.000Z', staleDays: 0, note: null },
    accounts: [],
    accountSummaries: [],
    pools: {
      headline: { light: 'green', sentence: '池子够用' },
      rows: [],
      hiddenCount: 0,
      unusableRows: [],
    },
    frequency: {
      headline: { light: 'green', sentence: '频率正常' },
      rows: [],
      stoppedRows: [],
      windowLabel: '10/14–10/20',
    },
    adjust: { headline: { light: 'green', sentence: '今天没有要调的' }, actions: [] },
    goalNote: null,
    prescriptionLine: null,
    budgetHold: false,
  }
}

function stubView(view: WarMapView) {
  const fn = vi.fn(async () => Response.json({ success: true, view }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('WarMapPanel · 没人跟进', () => {
  it('只显示条数和广告组，并链到现有客人名单', async () => {
    const view = baseView()
    view.adjust = {
      headline: { light: 'yellow', sentence: '今天有 1 件要留意' },
      actions: [{
        key: 'ad-lead-followup',
        severity: 'yellow',
        what: '广告线索超过 24 小时没人跟进：3 条，另有更早的 1 条',
        how: '春季组 3 条。打开客人名单逐条联系。',
        owner: 'pm',
      }],
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/超过 24 小时没人跟进：3 条/)).toBeTruthy())
    expect(screen.getAllByText(/超过 24 小时没人跟进：3 条/)).toHaveLength(1)
    expect(screen.getByRole('link', { name: '打开客人名单' }).getAttribute('href')).toBe('/dashboard/clients/c1/crm/all')
    expect(screen.queryByText('王女士')).toBeNull()
  })

  it('没有积压时只显示一句中性说明，不画黄色警告', async () => {
    const view = baseView()
    view.adjust.actions = [{
      key: 'ad-lead-followup',
      severity: 'info',
      what: '超过 24 小时的广告线索都有人跟进了',
      how: '',
      owner: 'pm',
    }]
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    const line = await screen.findByText('超过 24 小时的广告线索都有人跟进了')
    expect(line.parentElement?.className ?? '').not.toContain('bg-amber-50')
    expect(screen.queryByText(/没人跟进/)).toBeNull()
    expect(screen.queryByText('先补跟进，暂不建议加预算')).toBeNull()
  })
})

describe('WarMapPanel · 处方一行', () => {
  it('有处方摘要就显示那一行', async () => {
    const view = baseView()
    view.prescriptionLine = '处方 v1 · 草稿 · 2 条人工动作'
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('处方 v1 · 草稿 · 2 条人工动作')).toBeTruthy())
  })
})

describe('WarMapPanel · 倒计时条', () => {
  it('计划过时：显示实际开投日，不显示「距计划开投日还有」', async () => {
    const view = baseView()
    view.countdown = {
      planStatus: 'draft',
      phaseName: '旺季 A',
      launchDate: '2026-10-22',
      targetDate: '2026-11-04',
      daysToLaunch: 2,
      daysToTarget: 15,
      actualLaunchDay: '2026-10-20',
      planStale: true,
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('已开投（实际 10/20）')).toBeTruthy())
    expect(screen.getByText('计划记录待更新（计划写的开投日是 10/22）')).toBeTruthy()
    expect(screen.queryByText(/距计划开投日还有/)).toBeNull()
  })

  it('计划没过时：显示「距计划开投日还有 2 天」', async () => {
    stubView(baseView())
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('距计划开投日还有 2 天')).toBeTruthy())
  })
})

describe('WarMapPanel · 数据停了', () => {
  it('数据停了 10 天：显示琥珀色标签', async () => {
    const view = baseView()
    view.clocks = { dataDay: '2026-10-10', fetchedAt: '2026-10-17T17:00:00.000Z', staleDays: 10, note: null }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('数据已 10 天没更新')).toBeTruthy())
  })

  it('只停了 1 天：不显示这句', async () => {
    const view = baseView()
    view.clocks = { dataDay: '2026-10-19', fetchedAt: '2026-10-20T03:26:00.000Z', staleDays: 1, note: null }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/数据日/)).toBeTruthy())
    expect(screen.queryByText(/天没更新/)).toBeNull()
  })
})

describe('WarMapPanel · 按账户分开', () => {
  it('不可用账户的最大池加删除线，并说明不计入判断', async () => {
    const view = baseView()
    view.accountSummaries = [
      {
        adAccountId: 'act_111',
        name: '账户甲',
        statusCode: 3,
        usable: false,
        note: '欠款停用·不可用',
        dataDay: '2026-10-20',
        staleDays: 0,
        biggestPoolName: '某池',
        biggestPoolSize: 44500,
        dormant: false,
        poolCount: 1,
        light: 'red',
      },
      {
        adAccountId: 'act_222',
        name: '账户乙',
        statusCode: 1,
        usable: true,
        note: null,
        dataDay: '2026-10-20',
        staleDays: 0,
        biggestPoolName: '另一个池',
        biggestPoolSize: 9000,
        dormant: false,
        poolCount: 1,
        light: 'green',
      },
    ]
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('每个广告账户')).toBeTruthy())
    expect(screen.getByText('欠款停用·不可用')).toBeTruthy()
    expect(screen.getByText('不计入上面的判断')).toBeTruthy()
  })
})

describe('WarMapPanel · 不可用账户的池子单列', () => {
  it('展开「看每个池子」后能看到不可用账户的池子', async () => {
    const view = baseView()
    view.pools.unusableRows = [
      {
        id: 'p1',
        name: '某池',
        adAccountId: 'act_111',
        accountName: '账户甲',
        sizeLower: 44500,
        sizeNote: '至少 44,500 人',
        trend: 'flat',
        trendNote: '近 7 天基本没变',
        usedByAdsets: 1,
        accountUsable: false,
        accountNote: '欠款停用·不可用',
        light: 'red',
      },
    ]
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('看每个池子')).toBeTruthy())
    expect(screen.getByText('不可用账户的池子（不计入上面的判断）')).toBeTruthy()
  })
})
