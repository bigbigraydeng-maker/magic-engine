import { describe, it, expect } from 'vitest'
import { buildWarMap } from '../build'
import type { WarMapInput } from '../types'

function baseInput(overrides: Partial<WarMapInput> = {}): WarMapInput {
  const base: WarMapInput = {
    now: '2026-10-16T01:00:00.000Z',
    accounts: [
      {
        adAccountId: 'act_1',
        name: '主号',
        statusCode: 1,
        capturedAt: '2026-10-16T00:00:00.000Z',
      },
    ],
    audiences: [],
    audienceHistory: [],
    adsets: [],
    campaigns: [],
    clocks: {
      dataDay: '2026-10-15',
      fetchedAt: '2026-10-15T17:00:00.000Z',
    },
    growth: null,
    plan: null,
    creativePoolApproved: 3,
  }
  return { ...base, ...overrides }
}

describe('buildWarMap', () => {
  it('倒计时：有计划时算出距开投和距目标的天数', () => {
    const view = buildWarMap(
      baseInput({
        plan: {
          launchDate: '2026-10-21',
          targetDate: '2026-11-30',
          phaseName: '旺季',
        },
      }),
    )
    expect(view.countdown.daysToLaunch).toBe(5)
    expect(view.countdown.daysToTarget).toBe(45)
    expect(view.countdown.phaseName).toBe('旺季')
  })

  it('倒计时：没有计划时全部为 null', () => {
    const view = buildWarMap(baseInput({ plan: null }))
    expect(view.countdown.launchDate).toBeNull()
    expect(view.countdown.targetDate).toBeNull()
    expect(view.countdown.daysToLaunch).toBeNull()
    expect(view.countdown.daysToTarget).toBeNull()
    expect(view.countdown.phaseName).toBeNull()
  })

  it('账户：正常绿灯，欠款红灯并生成要你本人处理的动作', () => {
    const green = buildWarMap(baseInput())
    expect(green.accounts[0].light).toBe('green')
    expect(green.accounts[0].sentence).toBe('正常')

    const red = buildWarMap(
      baseInput({
        accounts: [
          {
            adAccountId: 'act_1',
            name: '主号',
            statusCode: 3,
            capturedAt: '2026-10-16T00:00:00.000Z',
          },
        ],
      }),
    )
    expect(red.accounts[0].light).toBe('red')
    expect(red.accounts[0].sentence).toBe('欠款未结，广告停着')
    const action = red.adjust.actions.find((a) => a.key === 'account-act_1')
    expect(action).toBeDefined()
    expect(action?.severity).toBe('red')
    expect(action?.owner).toBe('pm')
  })

  it('账户：读不到状态时是 unknown 并生成开发动作', () => {
    const view = buildWarMap(
      baseInput({
        accounts: [
          {
            adAccountId: 'act_1',
            name: '主号',
            statusCode: null,
            capturedAt: null,
          },
        ],
      }),
    )
    expect(view.accounts[0].light).toBe('unknown')
    const action = view.adjust.actions.find(
      (a) => a.key === 'account-status-act_1',
    )
    expect(action).toBeDefined()
    expect(action?.severity).toBe('yellow')
  })

  it('池子：人数读不到、显示下限、真实人数三种情况分开', () => {
    const nullView = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: null },
        ],
      }),
    )
    expect(nullView.pools.rows[0].light).toBe('unknown')
    expect(nullView.pools.rows[0].sizeNote).toBe('人数读不到')

    const floorView = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 1000 },
        ],
      }),
    )
    expect(floorView.pools.rows[0].light).toBe('unknown')
    expect(floorView.pools.rows[0].sizeLower).toBe(1000)

    const bigView = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 44500 },
        ],
      }),
    )
    expect(bigView.pools.rows[0].light).toBe('green')
    expect(bigView.pools.rows[0].sizeNote).toBe('至少 44,500 人')
  })

  it('池子趋势：缩了变黄并生成动作，长了是 growing，记录不够是 unknown', () => {
    const shrinking = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 50000 },
        ],
        audienceHistory: [
          { audienceId: 'aud_1', capturedAt: '2026-10-09T01:00:00.000Z', countLower: 50000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-10T01:00:00.000Z', countLower: 50000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-11T01:00:00.000Z', countLower: 50000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-12T01:00:00.000Z', countLower: 40000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-13T01:00:00.000Z', countLower: 40000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-14T01:00:00.000Z', countLower: 40000 },
        ],
      }),
    )
    expect(shrinking.pools.rows[0].trend).toBe('shrinking')
    expect(shrinking.pools.rows[0].light).toBe('yellow')
    expect(
      shrinking.adjust.actions.some((a) => a.key.startsWith('pool-shrink-')),
    ).toBe(true)

    const growing = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 44000 },
        ],
        audienceHistory: [
          { audienceId: 'aud_1', capturedAt: '2026-10-09T01:00:00.000Z', countLower: 40000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-10T01:00:00.000Z', countLower: 40000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-11T01:00:00.000Z', countLower: 40000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-12T01:00:00.000Z', countLower: 44000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-13T01:00:00.000Z', countLower: 44000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-14T01:00:00.000Z', countLower: 44000 },
        ],
      }),
    )
    expect(growing.pools.rows[0].trend).toBe('growing')

    const few = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 50000 },
        ],
        audienceHistory: [
          { audienceId: 'aud_1', capturedAt: '2026-10-12T01:00:00.000Z', countLower: 50000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-13T01:00:00.000Z', countLower: 50000 },
          { audienceId: 'aud_1', capturedAt: '2026-10-14T01:00:00.000Z', countLower: 50000 },
        ],
      }),
    )
    expect(few.pools.rows[0].trend).toBe('unknown')
    expect(few.pools.rows[0].trendNote).toContain('判不了')
  })

  it('池子头条：没有池子判不了，有池子但没历史时提示暂时判不了', () => {
    const none = buildWarMap(baseInput({ audiences: [] }))
    expect(none.pools.headline.light).toBe('unknown')

    const one = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 44500 },
        ],
      }),
    )
    expect(one.pools.headline.light).toBe('green')
    expect(one.pools.headline.sentence).toContain('至少 44,500 人')
    expect(one.pools.headline.sentence).toContain('暂时判不了')
  })

  it('池子：只统计在投广告组的使用次数', () => {
    const view = buildWarMap(
      baseInput({
        audiences: [
          { id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 44500 },
        ],
        adsets: [
          { id: 'as_1', effectiveStatus: 'ACTIVE', includedAudienceIds: ['aud_1'] },
          { id: 'as_2', effectiveStatus: 'PAUSED', includedAudienceIds: ['aud_1'] },
          { id: 'as_3', effectiveStatus: 'ACTIVE', includedAudienceIds: ['aud_1'] },
        ],
      }),
    )
    expect(view.pools.rows[0].usedByActiveAdsets).toBe(2)
  })

  it('池子：超过 8 个只显示前 8 个，其余计入 hiddenCount，按人数降序', () => {
    const audiences = Array.from({ length: 10 }, (_, i) => ({
      id: `aud_${i}`,
      name: `池子${i}`,
      adAccountId: 'act_1',
      countLower: 10000 + i * 1000,
    }))
    const view = buildWarMap(baseInput({ audiences }))
    expect(view.pools.rows.length).toBe(8)
    expect(view.pools.hiddenCount).toBe(2)
    expect(view.pools.rows[0].sizeLower).toBe(19000)
    expect(view.pools.rows[7].sizeLower).toBe(12000)
  })

  it('频率：高于 3 红灯，没过绿灯，没有频率 unknown，没花钱的不列', () => {
    const view = buildWarMap(
      baseInput({
        campaigns: [
          {
            campaignId: 'c_1',
            campaignName: '广告一',
            adAccountId: 'act_1',
            spend7d: 100,
            frequency7d: 3.5,
          },
          {
            campaignId: 'c_2',
            campaignName: '广告二',
            adAccountId: 'act_1',
            spend7d: 50,
            frequency7d: 1.83,
          },
          {
            campaignId: 'c_3',
            campaignName: '广告三',
            adAccountId: 'act_1',
            spend7d: 30,
            frequency7d: null,
          },
          {
            campaignId: 'c_4',
            campaignName: '广告四',
            adAccountId: 'act_1',
            spend7d: 0,
            frequency7d: 5,
          },
        ],
      }),
    )
    expect(view.frequency.rows.length).toBe(3)
    expect(view.frequency.rows[0].light).toBe('red')
    expect(view.frequency.rows[1].light).toBe('green')
    expect(view.frequency.rows[2].light).toBe('unknown')
    expect(view.frequency.headline.light).toBe('red')
    expect(view.frequency.headline.sentence).toContain('1 条')
  })

  it('动作：素材池 0 条是红灯，读不到是黄灯', () => {
    const empty = buildWarMap(baseInput({ creativePoolApproved: 0 }))
    const emptyAction = empty.adjust.actions.find(
      (a) => a.key === 'creative-pool-empty',
    )
    expect(emptyAction?.severity).toBe('red')

    const unreadable = buildWarMap(baseInput({ creativePoolApproved: null }))
    const unreadableAction = unreadable.adjust.actions.find(
      (a) => a.key === 'creative-pool-unreadable',
    )
    expect(unreadableAction?.severity).toBe('yellow')
  })

  it('动作：账户不健康时跳过 D7，健康时保留', () => {
    const growth = {
      date: '2026-10-16',
      goalTitle: null,
      paceReason: null,
      problems: [{ code: 'D7', title: '欠款问题', how: null }],
      opportunities: [],
    }
    const unhealthy = buildWarMap(
      baseInput({
        accounts: [
          {
            adAccountId: 'act_1',
            name: '主号',
            statusCode: 3,
            capturedAt: '2026-10-16T00:00:00.000Z',
          },
        ],
        growth,
      }),
    )
    expect(
      unhealthy.adjust.actions.some((a) => a.key.startsWith('growth-D7-')),
    ).toBe(false)

    const healthy = buildWarMap(baseInput({ growth }))
    expect(
      healthy.adjust.actions.some((a) => a.key.startsWith('growth-D7-')),
    ).toBe(true)
  })

  it('动作：经营视图没跑是 info，有红灯时头条说有几件要处理', () => {
    const view = buildWarMap(baseInput({ creativePoolApproved: 0 }))
    const missing = view.adjust.actions.find((a) => a.key === 'growth-missing')
    expect(missing?.severity).toBe('info')
    expect(view.adjust.headline.light).toBe('red')
    expect(view.adjust.headline.sentence.startsWith('今天有 1 件要处理')).toBe(
      true,
    )
  })

  it('目标备注：有目标时提醒不是当前推广计划这一轮，没有经营视图时为 null', () => {
    const withGoal = buildWarMap(
      baseInput({
        growth: {
          date: '2026-10-16',
          goalTitle: '圣诞团',
          paceReason: '落后线性节奏 65.7%',
          problems: [],
          opportunities: [],
        },
      }),
    )
    expect(withGoal.goalNote?.title).toBe('圣诞团')
    expect(withGoal.goalNote?.warning).toContain('不是当前推广计划这一轮')

    const noGrowth = buildWarMap(baseInput({ growth: null }))
    expect(noGrowth.goalNote).toBeNull()
  })
  it('池子趋势：同一天有两轮快照时取最新那轮，不看输入顺序', () => {
    const pt = (day: string, hour: string, countLower: number) => ({
      audienceId: 'aud_1',
      capturedAt: `2026-10-${day}T${hour}:00:00.000Z`,
      countLower,
    })
    // 10-14 这天有两轮：早上 50000，晚上 40000。最新的是 40000。
    const asc = [
      pt('09', '01', 50000), pt('10', '01', 50000), pt('11', '01', 50000),
      pt('12', '01', 44000), pt('13', '01', 45000), pt('14', '01', 50000), pt('14', '10', 40000),
    ]
    const input = baseInput({
      audiences: [{ id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 40000 }],
    })
    const forward = buildWarMap({ ...input, audienceHistory: asc })
    const reversed = buildWarMap({ ...input, audienceHistory: [...asc].reverse() })
    expect(forward.pools.rows[0].trend).toBe('shrinking')
    expect(reversed.pools.rows[0].trend).toBe('shrinking')
  })
})
