import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, plannedSpendCents, reconcileWeek, reconcileWindow } from '../reconcile'
import { DEFAULT_PROMO_PLAYBOOK } from '../playbooks'
import { baseSpec, goodReconFacts } from './fixtures'

const pb = DEFAULT_PROMO_PLAYBOOK
const TODAY = '2026-11-12' // 阶段 1 里；窗口 = 11-04 ~ 11-10（让出 1 天不稳定期）

describe('日期工具', () => {
  it('addDays / daysBetween 不受夏令时影响', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7)
  })
  it('窗口 = 最近 7 个完整日，再让出不稳定天数', () => {
    expect(reconcileWindow('2026-11-12', 1)).toEqual({ start: '2026-11-04', end: '2026-11-10' })
    expect(reconcileWindow('2026-11-12', 0)).toEqual({ start: '2026-11-05', end: '2026-11-11' })
  })
})

describe('plannedSpendCents', () => {
  const win = { start: '2026-11-04', end: '2026-11-10' }
  it('日预算 × 窗口内有效天数', () => {
    expect(plannedSpendCents(baseSpec(), win)).toEqual({ act_1: 5000 * 7 })
  })
  it('暂停区间不计', () => {
    const s = baseSpec()
    const ads = s.phases[0].steps[0]
    if (ads.kind === 'ads_campaign') ads.settings.paused_ranges = [{ from: '2026-11-05', to: '2026-11-06' }]
    expect(plannedSpendCents(s, win).act_1).toBe(5000 * 5)
  })
  it('阶段之外的天不计（窗口跨出阶段）', () => {
    expect(plannedSpendCents(baseSpec(), { start: '2026-10-28', end: '2026-11-03' }).act_1).toBe(5000 * 3)
  })
})

function spendFacts(perDayCents: number) {
  const days: Record<string, number> = {}
  for (let d = '2026-11-04'; d <= '2026-11-10'; d = addDays(d, 1)) days[d] = perDayCents
  return { act_1: days }
}

describe('reconcileWeek — 实际花费只算计划生效的天', () => {
  it('阶段只占窗口后 2 天时，之前几天同账户的花费不算进来（不会虚报超出）', () => {
    const spec = baseSpec()
    spec.phases[0].start_date = '2026-11-09'
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    const spend = reconcileWeek(spec, TODAY, f, pb).rows.find(x => x.key === 'spend')!
    expect(spend.status).toBe('on_track')
  })
})

describe('reconcileWeek — 头条', () => {
  it('花费正常 + 目标按节奏 → 基本按计划', () => {
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    const r = reconcileWeek(baseSpec(), TODAY, f, pb)
    expect(r.week_index).toBe(2)
    expect(r.blind).toBe(false)
    expect(r.headline).toBe('第 2 周 · 基本按计划')
    expect(r.rows.find(x => x.key === 'spend')?.status).toBe('on_track')
  })

  it('花费读不出来 → 看不清，绝不写"基本按计划"', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: null }), pb)
    expect(r.blind).toBe(true)
    expect(r.headline).toContain('看不清')
    expect(r.headline).not.toContain('基本按计划')
  })

  it('逐日花费读不到时引用广告数据页的合计，但不把它当成这一周的实际', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({
      spend_cents_by_account_day: null,
      account_total: { spend: 2012, currency: 'NZD', period_start: '2026-09-25', period_end: '2026-10-25' },
    }), pb)
    const row = r.rows.find(x => x.key === 'spend')
    expect(row?.status).toBe('unknown')
    expect(row?.actual).toBeNull()
    expect(row?.reason).toContain('NZ$2,012.00')
    expect(row?.reason).toContain('2026-09-25 至 2026-10-25')
    expect(row?.reason).toContain('不是这一周')
    expect(r.headline).toContain('NZ$2,012.00')
    expect(r.blind).toBe(true)
  })

  it('时区未确定 → 花费行 unknown，不静默按 UTC', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), timezone_known: false }), pb)
    expect(r.rows.find(x => x.key === 'spend')?.status).toBe('unknown')
    expect(r.blind).toBe(true)
  })

  it('目标读不到 → 看不清', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), goal: null }), pb)
    expect(r.blind).toBe(true)
  })

  it('花费明显落后 → 落后 + 要你决定', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(2000) }), pb)
    expect(r.rows.find(x => x.key === 'spend')?.status).toBe('behind')
    expect(r.headline).toContain('要你决定')
  })

  it('花费明显超出 → 超出', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(9000) }), pb)
    expect(r.rows.find(x => x.key === 'spend')?.status).toBe('over')
    expect(r.headline).toContain('超出')
  })

  it('计划还没开始 → 说明开始日，不报警', () => {
    const r = reconcileWeek(baseSpec(), '2026-10-20', goodReconFacts({ spend_cents_by_account_day: null }), pb)
    expect(r.week_index).toBeNull()
    expect(r.headline).toContain('还没开始')
  })
})

describe('目标进度（复用 goal-pace，不拿整期目标当分母）', () => {
  it('第 12 天、目标 100：线性应达 ≈ 40，而不是整期目标 100', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) }), pb)
    const row = r.rows.find(x => x.key === 'results_goal')!
    expect(row.planned).not.toBeNull()
    expect(row.planned!).toBeLessThan(100) // 不是整期目标值
    expect(row.planned!).toBeCloseTo(40, 0)
  })

  it('目标期刚开始（不足成熟天数）+ 落后 → 未成熟，不报警', () => {
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    f.goal!.current_value = 0
    const r = reconcileWeek(baseSpec(), '2026-11-05', f, pb)
    expect(r.rows.find(x => x.key === 'results_goal')?.status).toBe('immature')
  })

  it('目标数字太久没同步 / 没有同步时间 → 看不清（不是落后）', () => {
    const stale = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    stale.goal!.current_value_fetched_at = '2026-11-01T00:00:00Z'
    expect(reconcileWeek(baseSpec(), TODAY, stale, pb).rows.find(x => x.key === 'results_goal')?.status).toBe('unknown')
    const missing = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    missing.goal!.current_value_fetched_at = null
    expect(reconcileWeek(baseSpec(), TODAY, missing, pb).rows.find(x => x.key === 'results_goal')?.status).toBe('unknown')
  })

  it('目标已过期 / 归档 → 目标不适用（unknown），不用旧分母', () => {
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    f.goal!.status = 'expired'
    expect(reconcileWeek(baseSpec(), TODAY, f, pb).rows.find(x => x.key === 'results_goal')?.status).toBe('unknown')
  })

  it('目标周期与计划周期不重叠 → unknown', () => {
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    f.goal!.period_start = '2026-01-01'; f.goal!.period_end = '2026-01-31'
    const row = reconcileWeek(baseSpec(), TODAY, f, pb).rows.find(x => x.key === 'results_goal')!
    expect(row.status).toBe('unknown')
    expect(row.reason).toContain('不重叠')
  })

  it('目标快照过期或没有取数时间 → unknown，不判落后', () => {
    for (const at of ['2026-10-01T00:00:00Z', null]) {
      const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
      f.goal!.current_value_fetched_at = at
      expect(reconcileWeek(baseSpec(), TODAY, f, pb).rows.find(x => x.key === 'results_goal')?.status).toBe('unknown')
    }
  })

  it('目标当前值读不到 → unknown，不当 0', () => {
    const f = goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) })
    f.goal!.current_value = null
    expect(reconcileWeek(baseSpec(), TODAY, f, pb).rows.find(x => x.key === 'results_goal')?.status).toBe('unknown')
  })
})

describe('Meta 自报结果与目标进度分开，不合并', () => {
  it('是单独一行，状态 info，没有计划值', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) }), pb)
    const meta = r.rows.find(x => x.key === 'results_meta')!
    expect(meta.status).toBe('info')
    expect(meta.planned).toBeNull()
    expect(meta.reason).toContain('不相加')
    expect(r.rows.filter(x => x.key.startsWith('results')).length).toBe(2)
  })
  it('Meta 结果读不到不影响头条判定（它不是核心行）', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), meta_results: null }), pb)
    expect(r.blind).toBe(false)
  })
})

describe('内容行', () => {
  it('计划每周 5 条（3 帖 + 2 Story），发了 5 条 → 达标', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), content_published: 5 }), pb)
    const row = r.rows.find(x => x.key === 'content')!
    expect(row.planned).toBe(5)
    expect(row.status).toBe('on_track')
  })
  it('只发了 2 条 → 落后', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), content_published: 2 }), pb)
    expect(r.rows.find(x => x.key === 'content')?.status).toBe('behind')
  })
  it('读不到 → unknown（不当 0 条）', () => {
    const r = reconcileWeek(baseSpec(), TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000), content_published: null }), pb)
    expect(r.rows.find(x => x.key === 'content')?.status).toBe('unknown')
  })
  it('计划里没有社媒步骤 → 没有这一行', () => {
    const s = baseSpec(); s.phases[0].steps = s.phases[0].steps.filter(x => x.kind !== 'social_cadence')
    expect(reconcileWeek(s, TODAY, goodReconFacts({ spend_cents_by_account_day: spendFacts(5000) }), pb).rows.some(x => x.key === 'content')).toBe(false)
  })
})

describe('没有广告步骤的计划', () => {
  it('没有花费行，也不会因为没有花费而"看不清"', () => {
    const s = baseSpec(); s.phases[0].steps = []
    const r = reconcileWeek(s, TODAY, goodReconFacts(), pb)
    expect(r.rows.some(x => x.key === 'spend')).toBe(false)
  })
})
