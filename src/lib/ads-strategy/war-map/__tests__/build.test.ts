/**
 * 作战地图 S1 · 判断逻辑。
 *
 * 这份测试重写自 DeepSeek 的第一版（那版所有 fixture 的数据日都等于「今天」，所以测不到
 * 「数据停了还说没过高」这类假绿——魏征 2026-10-16 复审指出）。现在每条规则都配了反例。
 */
import { describe, it, expect } from 'vitest'
import { buildWarMap } from '../build'
import type {
  AccountInput, AudienceHistoryPoint, AudienceInput, CampaignFrequencyInput, GrowthInput, PlanInput, WarMapInput,
} from '../types'

const NOW = '2026-10-16T01:00:00.000Z' // 新西兰 10/16 14:00

function acct(over: Partial<AccountInput> = {}): AccountInput {
  return {
    adAccountId: 'act_1', name: '主号', statusCode: 1,
    capturedAt: '2026-10-16T00:00:00.000Z', timezoneName: 'Pacific/Auckland', ...over,
  }
}

function aud(over: Partial<AudienceInput> = {}): AudienceInput {
  return {
    id: 'aud_1', name: '池子', adAccountId: 'act_1', countLower: 44500,
    capturedAt: '2026-10-16T00:00:00.000Z', subtype: 'ENGAGEMENT', ruleEvents: [], ...over,
  }
}

function camp(over: Partial<CampaignFrequencyInput> = {}): CampaignFrequencyInput {
  return { campaignId: 'camp_1', campaignName: '广告系列一', adAccountId: 'act_1', spend7d: 100, frequency7d: 1.5, ...over }
}

function growth(over: Partial<GrowthInput> = {}): GrowthInput {
  return { date: '2026-10-16', goalTitle: null, paceReason: null, problems: [], opportunities: [], ...over }
}

function baseInput(over: Partial<WarMapInput> = {}): WarMapInput {
  return {
    now: NOW,
    accounts: [acct()],
    audiences: [],
    audienceHistory: [],
    adsets: [],
    campaigns: [],
    clocks: { dataDay: '2026-10-15', fetchedAt: '2026-10-15T17:00:00.000Z' },
    growth: null,
    plan: null,
    runningSince: null,
    accountDataDays: {},
    creativePoolApproved: 3,
    ...over,
  }
}

/** 一个池子连续 6 天（新西兰 10/10 到 10/15，各取当天 14:00）的人数 */
function dailyHistory(id: string, values: number[]): AudienceHistoryPoint[] {
  return values.map((countLower, i) => ({
    audienceId: id,
    capturedAt: `2026-10-${String(10 + i).padStart(2, '0')}T01:00:00.000Z`,
    countLower,
  }))
}

function poolWith(values: number[], countLower: number): WarMapInput {
  return baseInput({
    audiences: [aud({ countLower })],
    audienceHistory: dailyHistory('aud_1', values),
  })
}

describe('倒计时', () => {
  const phases = [
    { name: '旺季', startDate: '2026-10-21', endDate: '2026-11-30' },
    { name: '回落', startDate: '2026-12-01', endDate: '2026-12-20' },
  ]
  it('取今天还没结束的第一个阶段，并带上计划是草稿', () => {
    const plan: PlanInput = { status: 'draft', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    const c = buildWarMap(baseInput({ plan })).countdown
    expect(c).toMatchObject({ phaseName: '旺季', daysToLaunch: 5, daysToTarget: 45, planStatus: 'draft' })
  })
  it('第一阶段结束后改看下一个阶段', () => {
    const plan: PlanInput = { status: 'approved', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    const c = buildWarMap(baseInput({ now: '2026-12-05T01:00:00.000Z', plan })).countdown
    expect(c.phaseName).toBe('回落')
  })
  it('没有计划时全是空', () => {
    expect(buildWarMap(baseInput()).countdown).toEqual({
      planStatus: null, phaseName: null, launchDate: null, targetDate: null, daysToLaunch: null, daysToTarget: null,
      actualLaunchDay: null, planStale: false,
    })
  })
  it('计划写的开投日晚于实际已在跑的日子：标出计划过时', () => {
    const plan: PlanInput = { status: 'approved', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    const c = buildWarMap(baseInput({ plan, runningSince: '2026-10-15' })).countdown
    expect(c.planStale).toBe(true)
    expect(c.actualLaunchDay).toBe('2026-10-15')
  })
  it('没有在跑的：计划不算过时', () => {
    const plan: PlanInput = { status: 'approved', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    const c = buildWarMap(baseInput({ plan, runningSince: null })).countdown
    expect(c.planStale).toBe(false)
    expect(c.actualLaunchDay).toBeNull()
  })
  it('实际开投日就是计划开投日：不算过时', () => {
    const plan: PlanInput = { status: 'approved', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    const c = buildWarMap(baseInput({ plan, runningSince: '2026-10-21' })).countdown
    expect(c.planStale).toBe(false)
    expect(c.actualLaunchDay).toBeNull()
  })
  it('实际开投日晚于计划开投日：不算过时', () => {
    const plan: PlanInput = { status: 'approved', phases, goalTitle: null, recordUpdatedDay: '2026-10-14' }
    expect(buildWarMap(baseInput({ plan, runningSince: '2026-10-25' })).countdown.planStale).toBe(false)
  })
})

describe('账户状态', () => {
  it('新鲜且状态 1 才说正常', () => {
    expect(buildWarMap(baseInput()).accounts[0]).toMatchObject({ light: 'green', sentence: '正常' })
  })
  it('状态 3 写成一般是欠款，不断言广告一定停着，并派给你', () => {
    const v = buildWarMap(baseInput({ accounts: [acct({ statusCode: 3 })] }))
    expect(v.accounts[0]).toMatchObject({ light: 'red', sentence: '状态码 3（一般是欠款未结）' })
    const a = v.adjust.actions.find(x => x.key === 'account-act_1')
    expect(a).toMatchObject({ severity: 'red', owner: 'pm' })
    expect(a?.what).not.toContain('广告停着')
  })
  it('读不到状态是判不了，不是正常', () => {
    const v = buildWarMap(baseInput({ accounts: [acct({ statusCode: null, capturedAt: null })] }))
    expect(v.accounts[0].light).toBe('unknown')
    expect(v.adjust.actions.find(x => x.key === 'account-status-act_1')?.severity).toBe('yellow')
  })
  it('状态是 3 天前读的，不能说正常', () => {
    const v = buildWarMap(baseInput({ accounts: [acct({ capturedAt: '2026-10-13T00:00:00.000Z' })] }))
    expect(v.accounts[0].light).toBe('unknown')
    expect(v.accounts[0].sentence).toContain('已经过期')
  })
  it('一个账户都读不到要报红，不能当成没有账户', () => {
    const v = buildWarMap(baseInput({ accounts: [] }))
    expect(v.adjust.actions.find(x => x.key === 'accounts-empty')?.severity).toBe('red')
  })
})

describe('① 观众池', () => {
  it('人数读不到、只有显示下限、够大，三种分开', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud({ id: 'a', countLower: null }), aud({ id: 'b', countLower: 1000 }), aud({ id: 'c', countLower: 44500 })],
    }))
    const by = (id: string) => v.pools.rows.find(r => r.id === id)
    expect(by('a')).toMatchObject({ light: 'unknown', sizeNote: '人数读不到' })
    expect(by('b')?.light).toBe('unknown')
    expect(by('c')).toMatchObject({ light: 'green', sizeNote: '至少 44,500 人' })
  })
  it('人数记录是 6 天前的，不能再说至少多少人', () => {
    const v = buildWarMap(baseInput({ audiences: [aud({ capturedAt: '2026-10-10T00:00:00.000Z' })] }))
    expect(v.pools.rows[0].light).toBe('unknown')
    expect(v.pools.rows[0].sizeNote).toContain('已经过期')
  })
  it('缩了 20%：黄灯，并出一条要留意的事', () => {
    const v = buildWarMap(poolWith([50000, 50000, 50000, 40000, 40000, 40000], 40000))
    expect(v.pools.rows[0]).toMatchObject({ trend: 'shrinking', light: 'yellow' })
    expect(v.adjust.actions.some(a => a.key === 'pool-shrink-aud_1')).toBe(true)
  })
  it('涨了 10%：在长', () => {
    const v = buildWarMap(poolWith([40000, 40000, 40000, 44000, 44000, 44000], 44000))
    expect(v.pools.rows[0].trend).toBe('growing')
  })
  it('与 D11 同一把尺：1 万人的池子涨了 400（4%）仍算没变，不报在长', () => {
    const v = buildWarMap(poolWith([10000, 10000, 10000, 10400, 10400, 10400], 10400))
    expect(v.pools.rows[0].trend).toBe('flat')
  })
  it('同一天有两轮快照时和 D11 一样取最早一轮，不看输入顺序', () => {
    const pt = (day: string, hour: string, count: number): AudienceHistoryPoint => ({
      audienceId: 'aud_1', capturedAt: `2026-10-${day}T${hour}:00:00.000Z`, countLower: count,
    })
    const asc = [
      pt('10', '01', 50000), pt('11', '01', 50000), pt('12', '01', 50000),
      pt('13', '01', 44000), pt('14', '01', 45000), pt('15', '01', 40000), pt('15', '10', 50000),
    ]
    const input = baseInput({ audiences: [aud({ countLower: 50000 })] })
    for (const history of [asc, [...asc].reverse()]) {
      const v = buildWarMap({ ...input, audienceHistory: history })
      expect(v.pools.rows[0].trend).toBe('shrinking')
    }
  })
  it('只有 3 天记录：长没长判不了，但池子大小照样说', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud()],
      audienceHistory: dailyHistory('aud_1', [44500, 44500, 44500]),
    }))
    expect(v.pools.rows[0].trend).toBe('unknown')
    expect(v.pools.headline.sentence).toContain('暂时判不了')
  })
  it('曾经是大池子、现在掉到显示下限：标红，不当成判不了', () => {
    const v = buildWarMap(poolWith([40000, 40000, 40000, 40000, 40000, 40000], 900))
    expect(v.pools.rows[0]).toMatchObject({ trend: 'shrinking', light: 'red' })
    expect(v.pools.headline.light).toBe('red')
  })
  it('人数读不到：哪怕历史上有大人数，也只是判不了，不许说塌了（子牙 N1）', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud({ countLower: null })],
      audienceHistory: dailyHistory('aud_1', [40000, 40000, 40000, 40000, 40000, 40000]),
    }))
    expect(v.pools.rows[0]).toMatchObject({ trend: 'unknown', light: 'unknown' })
    expect(v.pools.headline.light).toBe('unknown')
    expect(v.adjust.actions.some(a => a.key.startsWith('pool-shrink'))).toBe(false)
  })
  it('人数记录过期：同样只是判不了，不许说塌了', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud({ countLower: 900, capturedAt: '2026-10-10T00:00:00.000Z' })],
      audienceHistory: dailyHistory('aud_1', [40000, 40000, 40000, 40000, 40000, 40000]),
    }))
    expect(v.pools.rows[0]).toMatchObject({ trend: 'unknown', light: 'unknown' })
  })
  it('设置里在用的池子都判不了时，不许说够用，哪怕别的池子很大', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud({ id: 'big', countLower: 44500 }), aud({ id: 'used', countLower: 1000 })],
      adsets: [{ id: 's1', effectiveStatus: 'ACTIVE', includedAudienceIds: ['used'] }],
    }))
    expect(v.pools.headline.light).toBe('unknown')
    expect(v.pools.headline.sentence).toContain('在用')
  })
  it('够用时也要说另有几个池子判不了', () => {
    const v = buildWarMap(baseInput({ audiences: [aud(), aud({ id: 'x', countLower: null })] }))
    expect(v.pools.headline.light).toBe('green')
    expect(v.pools.headline.sentence).toContain('另有 1 个池子判不了')
  })
  it('只数设置里 ACTIVE 的广告组', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud()],
      adsets: [
        { id: 's1', effectiveStatus: 'ACTIVE', includedAudienceIds: ['aud_1'] },
        { id: 's2', effectiveStatus: 'PAUSED', includedAudienceIds: ['aud_1'] },
      ],
    }))
    expect(v.pools.rows[0].usedByAdsets).toBe(1)
  })
  it('超过 8 个池子只列 8 个，按人数从大到小，其余写个数；缩水池子仍进今日清单', () => {
    const many = Array.from({ length: 10 }, (_, i) => aud({ id: `a${i}`, countLower: 2000 + i * 1000 }))
    const v = buildWarMap(baseInput({ audiences: many }))
    expect(v.pools.rows).toHaveLength(8)
    expect(v.pools.hiddenCount).toBe(2)
    expect(v.pools.rows[0].sizeLower).toBe(11000)
    const shrunk = baseInput({
      audiences: [...many.slice(0, 9), aud({ id: 'small', countLower: 1500 })],
      audienceHistory: dailyHistory('small', [3000, 3000, 3000, 1500, 1500, 1500]),
    })
    const v2 = buildWarMap(shrunk)
    expect(v2.pools.rows.some(r => r.id === 'small')).toBe(false)
    expect(v2.adjust.actions.some(a => a.key === 'pool-shrink-small')).toBe(true)
  })
  it('视频池缩水建议补视频广告，别的池子只建议查收人规则', () => {
    const history = dailyHistory('v', [50000, 50000, 50000, 40000, 40000, 40000])
    const mk = (extra: Partial<AudienceInput>) => buildWarMap(baseInput({
      audiences: [aud({ id: 'v', countLower: 40000, ...extra })], audienceHistory: history,
    })).adjust.actions.find(a => a.key === 'pool-shrink-v')?.how
    expect(mk({ ruleEvents: ['video_watched'] })).toContain('攒池子')
    expect(mk({ subtype: 'CUSTOM' })).toContain('收人规则')
  })
})

describe('倒计时 · 计划过时必须是「计划写完之后才开始跑」', () => {
  const phases = [{ name: '旺季', startDate: '2026-10-21', endDate: '2026-11-30' }]
  const mk = (recordUpdatedDay: string | null): PlanInput => ({ status: 'approved', phases, goalTitle: null, recordUpdatedDay })

  it('一直在跑的常驻广告（起跑日早于计划更新日）+ 未来的新阶段计划 → 不算过时，继续倒计时', () => {
    // 反例：只比「计划开投日 > 实际起跑日」会把它误判成「已开投」，把未来阶段的倒计时藏掉
    const c = buildWarMap(baseInput({ plan: mk('2026-10-14'), runningSince: '2026-09-01' })).countdown
    expect(c.planStale).toBe(false)
    expect(c.actualLaunchDay).toBeNull()
    expect(c.daysToLaunch).toBe(5)
  })
  it('计划更新之后才开始跑，且早于计划写的开投日 → 过时', () => {
    const c = buildWarMap(baseInput({ plan: mk('2026-10-14'), runningSince: '2026-10-15' })).countdown
    expect(c.planStale).toBe(true)
    expect(c.actualLaunchDay).toBe('2026-10-15')
  })
  it('起跑日与计划更新日同一天 → 不算过时（说不清谁先谁后，不下断言）', () => {
    const c = buildWarMap(baseInput({ plan: mk('2026-10-15'), runningSince: '2026-10-15' })).countdown
    expect(c.planStale).toBe(false)
  })
  it('读不到计划更新日 → 退回只比开投日', () => {
    const c = buildWarMap(baseInput({ plan: mk(null), runningSince: '2026-09-01' })).countdown
    expect(c.planStale).toBe(true)
  })
})

describe('观众池 · 按账户分开', () => {
  function twoAccounts(over: Partial<WarMapInput> = {}): WarMapInput {
    return baseInput({
      accounts: [
        acct({ adAccountId: 'act_dead', name: '停用号', statusCode: 3 }),
        acct({ adAccountId: 'act_ok', name: '在用号', statusCode: 1 }),
      ],
      audiences: [
        aud({ id: 'big', adAccountId: 'act_dead', countLower: 44500 }),
        aud({ id: 'small', adAccountId: 'act_ok', countLower: 9000 }),
      ],
      accountDataDays: { act_dead: '2026-10-15', act_ok: '2026-10-15' },
      clocks: { dataDay: '2026-10-15', fetchedAt: '2026-10-15T17:00:00.000Z' },
      ...over,
    })
  }
  it('停用账户的大池子不算进「够用」，单列到 unusableRows', () => {
    const v = buildWarMap(twoAccounts())
    expect(v.pools.headline.sentence).toContain('9,000')
    expect(v.pools.headline.sentence).toContain('在用号')
    expect(v.pools.headline.sentence).not.toContain('44,500')
    expect(v.pools.rows.map(r => r.id)).toEqual(['small'])
    expect(v.pools.unusableRows.map(r => r.id)).toEqual(['big'])
    expect(v.pools.unusableRows[0]).toMatchObject({ accountNote: '欠款停用·不可用', accountUsable: false })
  })
  it('每个账户一行小结，按 accounts 顺序', () => {
    const v = buildWarMap(twoAccounts())
    expect(v.accountSummaries).toHaveLength(2)
    expect(v.accountSummaries.map(s => s.adAccountId)).toEqual(['act_dead', 'act_ok'])
    expect(v.accountSummaries[0]).toMatchObject({
      usable: false, light: 'red', note: '欠款停用·不可用', biggestPoolSize: 44500,
    })
    expect(v.accountSummaries[1]).toMatchObject({
      usable: true, light: 'green', biggestPoolName: '池子', biggestPoolSize: 9000,
    })
  })
  it('读不到状态的账户，池子照样显示', () => {
    const v = buildWarMap(twoAccounts({
      accounts: [acct({ adAccountId: 'act_ok', name: '在用号', statusCode: null })],
      audiences: [aud({ id: 'small', adAccountId: 'act_ok', countLower: 9000 })],
    }))
    expect(v.pools.rows.map(r => r.id)).toEqual(['small'])
    expect(v.pools.unusableRows).toHaveLength(0)
  })
  it('状态码 2 也标不可用，并写明状态码', () => {
    const v = buildWarMap(twoAccounts({
      accounts: [acct({ adAccountId: 'act_dead', name: '停用号', statusCode: 2 })],
      audiences: [aud({ id: 'big', adAccountId: 'act_dead', countLower: 44500 })],
    }))
    expect(v.pools.unusableRows[0].accountNote).toContain('状态码 2')
  })
  it('所有账户都不可用：不许说够用', () => {
    const v = buildWarMap(twoAccounts({
      accounts: [acct({ adAccountId: 'act_dead', name: '停用号', statusCode: 3 })],
      audiences: [aud({ id: 'big', adAccountId: 'act_dead', countLower: 44500 })],
    }))
    expect(v.pools.headline.light).toBe('unknown')
    expect(v.pools.headline.sentence).toContain('没有观众池可判')
  })
})

describe('数据停了不许绿', () => {
  it('广告数据停了 10 天：观众池只能说判不了', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud()],
      clocks: { dataDay: '2026-10-06', fetchedAt: '2026-10-06T17:00:00.000Z' },
    }))
    expect(v.pools.headline.light).toBe('unknown')
    expect(v.pools.headline.sentence).toContain('没更新')
    expect(v.clocks.staleDays).toBe(10)
  })
  it('数据只落后 1 天：照常判', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud()],
      clocks: { dataDay: '2026-10-15', fetchedAt: '2026-10-15T17:00:00.000Z' },
    }))
    expect(v.pools.headline.light).toBe('green')
    expect(v.clocks.staleDays).toBe(1)
  })
  it('没有数据日：staleDays 是 null', () => {
    expect(buildWarMap(baseInput({ clocks: { dataDay: null, fetchedAt: null } })).clocks.staleDays).toBeNull()
  })
  it('账户自己的数据日太旧：该账户小结判不了', () => {
    const v = buildWarMap(baseInput({
      accounts: [acct({ adAccountId: 'act_ok', name: '在用号', statusCode: 1 })],
      audiences: [aud({ id: 'small', adAccountId: 'act_ok', countLower: 9000 })],
      accountDataDays: { act_ok: '2026-09-22' },
    }))
    const s = v.accountSummaries[0]
    expect(s.staleDays).toBe(24)
    expect(s.light).toBe('unknown')
  })
})

describe('② 频率', () => {
  it('数据新：1.83 绿，写明真实日期区间', () => {
    const v = buildWarMap(baseInput({ campaigns: [camp({ frequency7d: 1.83 })] }))
    expect(v.frequency.headline).toEqual({ light: 'green', sentence: '频率没过高，最高 1.83，红线 3' })
    expect(v.frequency.windowLabel).toBe('10/9–10/15')
  })
  it('数据停了 6 天：只能说判不了，并写明停在哪天', () => {
    const v = buildWarMap(baseInput({
      clocks: { dataDay: '2026-10-10', fetchedAt: '2026-10-15T17:00:00.000Z' },
      campaigns: [camp({ frequency7d: 1.83 })],
    }))
    expect(v.frequency.headline.light).toBe('unknown')
    expect(v.frequency.headline.sentence).toContain('停在 10/10')
    expect(v.frequency.headline.sentence).toContain('6 天')
    expect(v.frequency.rows[0].light).toBe('unknown')
  })
  it('数据停了但频率本来就高于 3：仍然标红', () => {
    const v = buildWarMap(baseInput({
      clocks: { dataDay: '2026-10-10', fetchedAt: null },
      campaigns: [camp({ frequency7d: 3.5 })],
    }))
    expect(v.frequency.headline.light).toBe('red')
    expect(v.frequency.headline.sentence).toContain('停在 10/10')
  })
  it('数据停了且频率高于 3：今日清单里的红色事项也带「数据停在 X」', () => {
    const v = buildWarMap(baseInput({
      clocks: { dataDay: '2026-10-10', fetchedAt: null },
      campaigns: [camp({ frequency7d: 3.5 })],
    }))
    expect(v.adjust.actions.find(a => a.key === 'freq-camp_1')?.what).toContain('数据停在 10/10')
  })
  it('有广告没有 7 天频率：不能整体说绿', () => {
    const v = buildWarMap(baseInput({
      campaigns: [camp({ frequency7d: 1.5 }), camp({ campaignId: 'c2', frequency7d: null })],
    }))
    expect(v.frequency.headline.light).toBe('yellow')
    expect(v.frequency.headline.sentence).toContain('判不了')
  })
  it('没有数据日、没有花钱的广告，各自是判不了；花费为 0 的不列', () => {
    expect(buildWarMap(baseInput({ clocks: { dataDay: null, fetchedAt: null } })).frequency.headline.light).toBe('unknown')
    const v = buildWarMap(baseInput({ campaigns: [camp({ spend7d: 0 })] }))
    expect(v.frequency.rows).toHaveLength(0)
    expect(v.frequency.headline.light).toBe('unknown')
  })
  it('频率高于 3：标红并进今日清单', () => {
    const v = buildWarMap(baseInput({ campaigns: [camp({ frequency7d: 3.5 })] }))
    expect(v.frequency.rows[0].light).toBe('red')
    expect(v.adjust.actions.some(a => a.key === 'freq-camp_1')).toBe(true)
  })
})

describe('③ 今天要调什么', () => {
  it('素材池 0 条标红，读不到标黄', () => {
    expect(buildWarMap(baseInput({ creativePoolApproved: 0 })).adjust.actions.find(a => a.key === 'creative-pool-empty')?.severity).toBe('red')
    expect(buildWarMap(baseInput({ creativePoolApproved: null })).adjust.actions.find(a => a.key === 'creative-pool-unreadable')?.severity).toBe('yellow')
  })
  it('前两句里有判不了，第三句不许绿', () => {
    const v = buildWarMap(baseInput())
    expect(v.adjust.headline.light).toBe('yellow')
    expect(v.adjust.headline.sentence).toContain('先别当没事')
  })
  it('都看得清且没事，才说今天没有要调的', () => {
    const v = buildWarMap(baseInput({
      audiences: [aud()], campaigns: [camp()], growth: growth(),
    }))
    expect(v.adjust.headline).toEqual({ light: 'green', sentence: '今天没有要调的' })
  })
  it('有红色事项时，标题写出第一条最急的', () => {
    const v = buildWarMap(baseInput({ creativePoolApproved: 0 }))
    expect(v.adjust.headline.light).toBe('red')
    expect(v.adjust.headline.sentence).toMatch(/^今天有 1 件要处理，最急：/)
  })
  it('经营视图：账户不健康时跳过只会重复欠款的 D7，健康时保留', () => {
    const g = growth({ problems: [{ code: 'D7', title: '日数据停更', how: null }] })
    const sick = buildWarMap(baseInput({ growth: g, accounts: [acct({ statusCode: 3 })] }))
    expect(sick.adjust.actions.some(a => a.key.startsWith('growth-D7'))).toBe(false)
    const ok = buildWarMap(baseInput({ growth: g }))
    expect(ok.adjust.actions.some(a => a.key.startsWith('growth-D7'))).toBe(true)
  })
  it('经营视图是旧的：写明哪天的，并把它的事项标成旧数据', () => {
    const g = growth({ date: '2026-10-14', problems: [{ code: 'D3', title: '花钱没结果', how: null }] })
    const v = buildWarMap(baseInput({ growth: g }))
    expect(v.adjust.actions.find(a => a.key === 'growth-stale')).toMatchObject({ severity: 'yellow' })
    expect(v.adjust.actions.find(a => a.key.startsWith('growth-D3'))?.what).toContain('10/14 的旧数据')
  })
  it('经营视图是今天的：没有「旧数据」字样', () => {
    const g = growth({ problems: [{ code: 'D3', title: '花钱没结果', how: null }] })
    const v = buildWarMap(baseInput({ growth: g }))
    expect(v.adjust.actions.some(a => a.key === 'growth-stale')).toBe(false)
    expect(v.adjust.actions.find(a => a.key.startsWith('growth-D3'))?.what).not.toContain('旧数据')
  })
  it('经营视图一行都没有：只是知道即可，不当成问题', () => {
    expect(buildWarMap(baseInput()).adjust.actions.find(a => a.key === 'growth-missing')?.severity).toBe('info')
  })
})

describe('目标进度那一行只陈述事实', () => {
  const g = growth({ goalTitle: '圣诞团招募', paceReason: '落后线性节奏 65.7%' })
  it('计划挂的是另一个目标：两个标题并排写出来', () => {
    const plan: PlanInput = { status: 'draft', phases: [], goalTitle: '三月四团招募', recordUpdatedDay: null }
    const note = buildWarMap(baseInput({ growth: g, plan })).goalNote
    expect(note?.warning).toContain('《圣诞团招募》')
    expect(note?.warning).toContain('《三月四团招募》')
    expect(note?.warning).toContain('不是同一个')
  })
  it('就是同一个目标：不提', () => {
    const plan: PlanInput = { status: 'draft', phases: [], goalTitle: '圣诞团招募', recordUpdatedDay: null }
    expect(buildWarMap(baseInput({ growth: g, plan })).goalNote).toBeNull()
  })
  it('没有计划、或计划的目标没读到：照实说，不下断言', () => {
    expect(buildWarMap(baseInput({ growth: g })).goalNote?.warning).toContain('跟任何计划无关')
    const plan: PlanInput = { status: 'draft', phases: [], goalTitle: null, recordUpdatedDay: null }
    expect(buildWarMap(baseInput({ growth: g, plan })).goalNote?.warning).toContain('没读到')
  })
  it('没有目标标题：不出这一段；共享代码里也不写客户事实', () => {
    expect(buildWarMap(baseInput({ growth: growth() })).goalNote).toBeNull()
    const note = buildWarMap(baseInput({ growth: g })).goalNote
    expect(JSON.stringify(note)).not.toMatch(/停投|3 月四团/)
  })
})
