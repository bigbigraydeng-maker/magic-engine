/**
 * 真实数据回放验收（设计 §10 Phase 1 + §14；派活说明「真实数据验收」）。
 * 数据全部为 2026-09-14 只读实拉：NAL act_953025114498626、CTS 官方账户 act_2202695063810470、Oztop act_1735240120460765。
 *
 *   正例：NAL 8/17–9/13 → D4 命中（两条 ThruPlay 3 天 ~$50、再营销名单为 0 的阶段）；9 月新 3PL 系列 D5 not_comparable；
 *         D3 在未配目标单次成本时 not_comparable。CTS 2026-09-13 → D1 命中（官方账户 14:00 后零投放）。
 *   反例：Oztop 历史健康日零诊断；CTS 9/8-9/9 除 D9（GC 顶层 ThruPlay 没排除 Audience Network，
 *         真实存在的配置问题，2026-09-22 补规则后才抓出来）外零诊断。
 *   CTS 正在跑的 A/B 实验（1489853439620194）必须被排除。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import nalSettings from '../../__tests__/fixtures/nal-settings.json'
import ctsSettings from '../../__tests__/fixtures/cts-settings.json'
import oztopSettings from '../../__tests__/fixtures/oztop-settings.json'
import nalDailyRaw from '../../__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import nalActivities from './fixtures/nal-activities-budget-create.json'
import ctsDailyRaw from './fixtures/cts-official-daily-adset-2026-09-07_2026-09-14.json'
import ctsHourlyRaw from './fixtures/cts-official-hourly-adset.json'
import ctsActivities from './fixtures/cts-official-activities-budget-create.json'
import ctsStudy from './fixtures/cts-study-1489853439620194.json'
import oztopDailyRaw from './fixtures/oztop-daily-adset-2026-07-01_2026-08-18.json'
import oztopHourlyRaw from './fixtures/oztop-hourly-adset.json'
import oztopActivities from './fixtures/oztop-activities-budget-create.json'
import { accountInput, dailyRowsFromGraph, hourlyFromGraph, replaySnapshots, settingsFixture, type ActivityRow } from './replay'
import { runDiagnostics } from '../run'
import type { DailyRow, DiagnosisInput } from '../types'
import type { OutcomeConfig } from '../../outcome-ladder'
import type { GraphHourlySpendRow } from '@/lib/meta/entity-settings'

const NAL = settingsFixture(nalSettings)
const CTS = settingsFixture(ctsSettings)
const OZ = settingsFixture(oztopSettings)

let nalDaily: DailyRow[] = []
let ctsDaily: DailyRow[] = []
let ozDaily: DailyRow[] = []
beforeAll(async () => {
  nalDaily = await dailyRowsFromGraph(nalDailyRaw)
  ctsDaily = await dailyRowsFromGraph(ctsDailyRaw)
  ozDaily = await dailyRowsFromGraph(oztopDailyRaw)
})

const INTERNAL = ['team@magicengine.com.au']
const outcome = (o: Partial<OutcomeConfig>): OutcomeConfig => ({ leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: 5, ...o })

function input(opts: { clientId: string; date: string; evaluatedAt: string; outcome: OutcomeConfig; configured: boolean; account: DiagnosisInput['accounts'][number] }): DiagnosisInput {
  return {
    clientId: opts.clientId, date: opts.date, evaluatedAt: opts.evaluatedAt,
    outcome: opts.outcome, outcomeConfigured: opts.configured,
    messagingReferralAvailable: false, digestRecipients: INTERNAL, accounts: [opts.account],
  }
}

// ── NAL ────────────────────────────────────────────────────────────────────
function nalRun(date: string, asOfIso: string, o: OutcomeConfig, configured = true) {
  const snapshots = replaySnapshots({ fixture: NAL, clientId: 'nal', asOfIso, date, daily: nalDaily, activities: nalActivities as ActivityRow[] })
  return runDiagnostics(input({
    clientId: 'nal', date, evaluatedAt: asOfIso, outcome: o, configured,
    account: accountInput({ fixture: NAL, snapshots, daily: nalDaily, lastInsightDate: date }),
  }))
}

describe('NAL 回放（正例）', () => {
  it('D4 命中：2026-09-13 NZ 21:00（再营销名单 21:59 才建）两条 ThruPlay 3 天花了约 $51，没有任何受众在收看过视频的人', () => {
    const run = nalRun('2026-09-13', '2026-09-13T09:00:00Z', outcome({ leading: 'messaging_started', primary: 'qualified_enquiry' }))
    const d4 = run.diagnoses.find(d => d.code === 'D4')
    expect(d4?.status).toBe('hit')
    expect(d4?.evidence.awareness_spend).toBeCloseTo(51.19, 2)
    expect(d4?.evidence.awareness_active_days).toBe(3)
    expect(d4?.evidence.covering_audiences).toBe(0)
    expect(d4?.units.map(u => u.id).sort()).toEqual(['52596931528525', '52596939123725'])
  })

  it('D4 名单建好后（NZ 9/14 00:30）：受众建成不满 72 小时 → not_comparable，不再报命中', () => {
    const run = nalRun('2026-09-13', '2026-09-13T12:30:00Z', outcome({ leading: 'messaging_started', primary: 'qualified_enquiry' }))
    const d4 = run.diagnoses.find(d => d.code === 'D4')
    expect(d4).toMatchObject({ status: 'not_comparable', notComparableReason: 'audience_too_new' })
  })

  it('D5：9 月新 3PL 系列（9/1–9/3，29 次点击），主结果是合格询盘（归不到广告）→ not_comparable，且点名 3PL 系列', () => {
    const run = nalRun('2026-09-03', '2026-09-03T11:59:00Z', outcome({ leading: 'messaging_started', primary: 'qualified_enquiry' }))
    const d5 = run.diagnoses.filter(d => d.code === 'D5')
    expect(d5.length).toBeGreaterThan(0)
    expect(d5.every(d => d.status === 'not_comparable')).toBe(true)
    expect(d5[0].notComparableReason).toBe('primary_not_attributable')
    expect(d5.flatMap(d => d.units.map(u => u.id))).toContain('52593506024125')
    const clicks = nalDaily.filter(r => r.parent_id === '52593506024125').reduce((a, r) => a + r.clicks, 0)
    expect(clicks).toBe(29)
  })

  it('D5 主结果换成留资：3PL 系列是网站转化优化、有几天只有自定义像素事件 → 留资归不上 → 仍 not_comparable', () => {
    const run = nalRun('2026-09-03', '2026-09-03T11:59:00Z', outcome({ leading: 'lead', primary: 'lead', targetCostPerPrimary: 25 }))
    const d5 = run.diagnoses.find(d => d.code === 'D5')
    expect(d5).toMatchObject({ status: 'not_comparable', notComparableReason: 'primary_not_attributable' })
    expect(d5?.units.map(u => u.id)).toContain('52593506024125')
  })

  it('D5 样本量闸：主结果换成平台直报的私信开聊，3PL 系列花了约 18% 的钱只有 1 次开聊 → below_min_sample 点名 3PL，不出命中', () => {
    const run = nalRun('2026-09-03', '2026-09-03T11:59:00Z', outcome({ leading: 'messaging_started', primary: 'messaging_started' }))
    const thin = run.diagnoses.find(d => d.code === 'D5' && d.notComparableReason === 'below_min_sample')
    expect(thin?.units.map(u => u.id)).toContain('52593506024125')
    expect(thin?.sample.find(s => s.label.includes('新潜在客户广告系列-3PL'))?.value).toBe(1)
    expect(run.diagnoses.some(d => d.code === 'D5' && d.status === 'hit' && d.units.some(u => u.id === '52593506024125'))).toBe(false)
  })

  it('D5 只比独立预算单位：NAL 全是 CBO 系列，D5 里不出现任何 CBO 内部的广告组', () => {
    const run = nalRun('2026-09-03', '2026-09-03T11:59:00Z', outcome({ primary: 'qualified_enquiry' }))
    const units = run.diagnoses.filter(d => d.code === 'D5').flatMap(d => d.units)
    expect(units.length).toBeGreaterThan(0)
    expect(units.every(u => u.level === 'campaign')).toBe(true)
  })

  it('D3：没配目标单次成本 → not_comparable（不回落行业默认）', () => {
    const run = nalRun('2026-09-03', '2026-09-03T11:59:00Z', outcome({ leading: 'messaging_started', primary: 'lead' }))
    const d3 = run.diagnoses.filter(d => d.code === 'D3')
    expect(d3).toHaveLength(1)
    expect(d3[0]).toMatchObject({ status: 'not_comparable', notComparableReason: 'target_cost_not_configured' })
  })

  it('D3：配了目标（留资 NZ$25）→ 8 月 3PL 广告组 8/21–8/27 花 $109.71 只有 2 条留资（每条 $54.86 ≥ 2× 目标）→ 命中；主力私信留资组不命中', () => {
    const run = nalRun('2026-08-27', '2026-08-27T11:59:00Z', outcome({ leading: 'lead', primary: 'lead', targetCostPerPrimary: 25 }))
    const hits = run.diagnoses.filter(d => d.code === 'D3' && d.status === 'hit')
    expect(hits.map(h => h.units[0].id)).toEqual(['52589907084325'])
    expect(hits[0].evidence).toMatchObject({ spend: 109.71, results: 2, cost_per_result: 54.86, target_cost: 25 })
    expect(hits[0].sample[0]).toEqual({ label: '留资（表单）', value: 2 })
  })

  it('D8：领先结果（私信开聊）有，主结果（合格询盘）归不上 → 命中', () => {
    const run = nalRun('2026-09-13', '2026-09-13T09:00:00Z', outcome({ leading: 'messaging_started', primary: 'qualified_enquiry' }))
    const d8 = run.diagnoses.find(d => d.code === 'D8')
    expect(d8?.status).toBe('hit')
    expect(Number(d8?.evidence.leading)).toBeGreaterThan(0)
  })
})

// ── CTS 官方账户 ─────────────────────────────────────────────────────────────
const CTS_OUTCOME = outcome({ leading: 'lead', primary: 'lead', targetCostPerPrimary: 40 })
const STUDY = {
  createdAtIso: (ctsStudy as { start_time: string }).start_time.replace('+0000', 'Z'),
  byAdsetId: Object.fromEntries(((ctsStudy as { cells: { data: Array<{ adsets: { data: Array<{ id: string }> } }> } }).cells.data)
    .flatMap(c => c.adsets.data.map(a => [a.id, [{ id: '1489853439620194', type: 'SPLIT_TEST', start_time: '2026-09-13T12:31:23+0000', end_time: '2026-09-23T12:31:23+0000' }]]))),
}
function ctsRun(date: string, asOfIso: string, evaluatedAt: string) {
  const snapshots = replaySnapshots({ fixture: CTS, clientId: 'cts', asOfIso, date, daily: ctsDaily, activities: ctsActivities as ActivityRow[], studies: STUDY })
  return runDiagnostics(input({
    clientId: 'cts', date, evaluatedAt, outcome: CTS_OUTCOME, configured: true,
    account: accountInput({ fixture: CTS, snapshots, daily: ctsDaily, hourly: hourlyFromGraph((ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days), lastInsightDate: date }),
  }))
}

describe('CTS 官方账户回放', () => {
  it('D1 命中：2026-09-13 14:00 起连续 10 小时零投放，日预算 $60 还剩 $23.22，账户状态正常；次日 15:00 发现', () => {
    const run = ctsRun('2026-09-13', '2026-09-13T11:59:59Z', '2026-09-14T03:00:00Z')
    const d1 = run.diagnoses.find(d => d.code === 'D1')
    expect(d1?.status).toBe('hit')
    expect(d1?.evidence).toMatchObject({
      stall_start_hour: 14, stall_hours: 10, spend_day: 36.78, daily_budget: 60, budget_remaining: 23.22,
      account_status: 1, detection_lag_hours: 25,
    })
    expect(Number(d1?.evidence.yesterday_same_window_spend)).toBeGreaterThan(30)
    expect(d1?.reasons[0]).toContain('账户状态正常')
  })

  it('2026-09-13 除 D1、D9 外没有别的命中', () => {
    const run = ctsRun('2026-09-13', '2026-09-13T11:59:59Z', '2026-09-14T03:00:00Z')
    // D9 = GC 顶层 ThruPlay 广告组（52549857906273）没排除 Audience Network，
    // 这是 2026-09-22 补的规则，抓的是从 9/8 就存在的真实配置问题（docs/PITFALLS.md D9），不是新回归。
    expect(run.diagnoses.filter(d => d.status === 'hit').map(d => d.code).sort()).toEqual(['D1', 'D9'])
  })

  it('反例：2026-09-08、09-09（视频刚开投、全天在投）——除了真实存在的 D9 配置漏洞，没有别的诊断', () => {
    for (const [date, asOf] of [['2026-09-08', '2026-09-08T11:59:59Z'], ['2026-09-09', '2026-09-09T11:59:59Z']] as const) {
      const run = ctsRun(date, asOf, `${date}T23:00:00Z`)
      // GC 顶层 ThruPlay（52549857906273）建的时候就没设 publisher_platforms，D9 从第一天就该命中——
      // 这不是这条测试原本想验的"投放卡住/花钱没结果"那类问题，但确实是真实存在的问题，不能再断言零诊断。
      expect(run.diagnoses.map(d => d.code)).toEqual(['D9'])
      expect(run.diagnoses[0].units.map(u => u.id)).toEqual(['52549857906273'])
    }
  })

  it('🔴 A/B 实验（1489853439620194）两个广告组被排除出诊断：进 excluded，任何诊断都不点名它们', () => {
    const run = ctsRun('2026-09-14', '2026-09-13T14:00:00Z', '2026-09-14T20:00:00Z')
    const ids = ['52551117304473', '52551118124873']
    expect(run.excluded.filter(e => e.reason === 'meta_experiment').map(e => e.id).sort()).toEqual(ids)
    expect(run.excluded.find(e => e.id === ids[0])?.detail).toContain('1489853439620194')
    expect(run.diagnoses.flatMap(d => d.units.map(u => u.id)).some(id => ids.includes(id))).toBe(false)
  })
})

// ── Oztop ───────────────────────────────────────────────────────────────────
describe('Oztop 回放（反例）', () => {
  it('2026-08-04 ~ 08-13（单个表单留资组稳定在投，约 $60/天、约 1.7 条留资/天）零诊断', () => {
    const hourly = hourlyFromGraph((oztopHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days)
    for (let d = 4; d <= 13; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`
      const snapshots = replaySnapshots({ fixture: OZ, clientId: 'oztop', asOfIso: `${date}T13:59:59Z`, date, daily: ozDaily, activities: oztopActivities as ActivityRow[] })
      const run = runDiagnostics(input({
        clientId: 'oztop', date, evaluatedAt: `${date}T23:00:00Z`,
        outcome: outcome({ leading: 'lead', primary: 'lead', targetCostPerPrimary: 35 }), configured: true,
        account: accountInput({ fixture: OZ, snapshots, daily: ozDaily, hourly, lastInsightDate: date }),
      }))
      expect({ date, diagnoses: run.diagnoses }).toEqual({ date, diagnoses: [] })
    }
  })
})
