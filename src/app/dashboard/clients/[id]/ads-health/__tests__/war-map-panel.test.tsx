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
    clocks: {
      dataDay: '2026-10-20',
      fetchedAt: '2026-10-20T03:26:00.000Z',
      staleDays: 0,
      sourceState: 'fresh',
      staleAccounts: [],
      recentFailureCount: 0,
    },
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
      windowLabel: '10/14–10/20',
    },
    adjust: { headline: { light: 'green', sentence: '今天没有要调的' }, actions: [] },
    goalNote: null,
    prescriptionLine: null,
  }
}

function stubView(view: WarMapView) {
  const fn = vi.fn(async () => Response.json({ success: true, view }))
  vi.stubGlobal('fetch', fn)
  return fn
}

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

describe('WarMapPanel · 数据过期（分「源头没花钱」vs「取数链路挂了」）', () => {
  it('源头没花钱（no_spend_upstream）：列出账户，不说「任务挂了」', async () => {
    const view = baseView()
    view.clocks = {
      dataDay: '2026-10-10',
      fetchedAt: '2026-10-17T17:00:00.000Z',
      staleDays: 10,
      sourceState: 'no_spend_upstream',
      staleAccounts: [{ adAccountId: 'act_1', name: '主账户', staleDays: 10 }],
      recentFailureCount: 0,
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/这几个账户/)).toBeTruthy())
    expect(screen.getByText(/主账户（10 天）/)).toBeTruthy()
    expect(screen.queryByText(/任务挂了/)).toBeNull()
    expect(screen.queryByText(/查运行记录/)).toBeNull()
  })

  it('取数链路挂了（fetch_chain_down）：说「任务挂了」+ 失败次数 + 「查运行记录」链接', async () => {
    const view = baseView()
    view.clocks = {
      dataDay: '2026-10-15',
      fetchedAt: '2026-10-15T17:00:00.000Z',
      staleDays: 5,
      sourceState: 'fetch_chain_down',
      staleAccounts: [],
      recentFailureCount: 3,
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/取数任务挂了/)).toBeTruthy())
    expect(screen.getByText(/3 次失败/)).toBeTruthy()
    const link = screen.getByText('查运行记录') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/dashboard/admin/cron-health')
    expect(screen.queryByText(/这几个账户/)).toBeNull()
  })

  it('cronHealth 读不到（unknown）：只说「取数状态读不到」，不下定论', async () => {
    const view = baseView()
    view.clocks = {
      dataDay: '2026-10-10',
      fetchedAt: '2026-10-17T17:00:00.000Z',
      staleDays: 10,
      sourceState: 'unknown',
      staleAccounts: [],
      recentFailureCount: 0,
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('取数状态读不到')).toBeTruthy())
    expect(screen.queryByText(/任务挂了/)).toBeNull()
    expect(screen.queryByText(/这几个账户/)).toBeNull()
  })

  it('fresh：只停了 1 天，不显示任何提示', async () => {
    const view = baseView()
    view.clocks = {
      dataDay: '2026-10-19',
      fetchedAt: '2026-10-20T03:26:00.000Z',
      staleDays: 1,
      sourceState: 'fresh',
      staleAccounts: [],
      recentFailureCount: 0,
    }
    stubView(view)
    render(<WarMapPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/数据日/)).toBeTruthy())
    expect(screen.queryByText(/这几个账户/)).toBeNull()
    expect(screen.queryByText(/任务挂了/)).toBeNull()
    expect(screen.queryByText(/读不到/)).toBeNull()
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
