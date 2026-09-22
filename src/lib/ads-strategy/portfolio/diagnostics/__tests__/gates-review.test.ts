/**
 * 2026-09-14 子牙/魏征复审补测：每条对应一个复审里「改了代码测试照样全过」的变异，或一个实测误报/漏报。
 * 输入从真实回放数据派生，派生方式写在用例里。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import ctsSettings from '../../__tests__/fixtures/cts-settings.json'
import nalSettings from '../../__tests__/fixtures/nal-settings.json'
import nalDailyRaw from '../../__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import nalActivities from './fixtures/nal-activities-budget-create.json'
import ctsDailyRaw from './fixtures/cts-official-daily-adset-2026-09-07_2026-09-14.json'
import ctsHourlyRaw from './fixtures/cts-official-hourly-adset.json'
import ctsActivities from './fixtures/cts-official-activities-budget-create.json'
import ctsStudy from './fixtures/cts-study-1489853439620194.json'
import { accountInput, dailyRowsFromGraph, hourlyFromGraph, replaySnapshots, settingsFixture, type ActivityRow } from './replay'
import { runDiagnostics } from '../run'
import { benjaminiHochberg, binomialTwoSidedP } from '../d5-budget-result-mismatch'
import { hourlyRowsFromGraph, latestSnapshotsAsOf } from '../loader'
import { localDayEndUtc, shiftDate } from '../context'
import { isInternalEmail, splitAddresses } from '../internal-email'
import type { AccountInput, DailyRow, DiagnosisInput, HourlyRow } from '../types'
import type { OutcomeConfig } from '../../outcome-ladder'
import type { EntitySnapshotRow } from '../../snapshot'
import type { GraphHourlySpendRow } from '@/lib/meta/entity-settings'

const CTS = settingsFixture(ctsSettings)
const NAL = settingsFixture(nalSettings)
const LEAD: OutcomeConfig = { leading: 'lead', primary: 'lead', targetCostPerPrimary: 25, minPrimaryPerUnit: 5 }
const MSG: OutcomeConfig = { leading: 'messaging_started', primary: 'messaging_started', targetCostPerPrimary: null, minPrimaryPerUnit: 5 }

let nalDaily: DailyRow[] = []
let ctsDaily: DailyRow[] = []
let ctsHourly: Record<string, HourlyRow[]> = {}
beforeAll(async () => {
  nalDaily = await dailyRowsFromGraph(nalDailyRaw)
  ctsDaily = await dailyRowsFromGraph(ctsDailyRaw)
  ctsHourly = hourlyFromGraph((ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days)
})

function run(account: AccountInput, date: string, evaluatedAt: string, outcome: OutcomeConfig, extra: Partial<DiagnosisInput> = {}) {
  return runDiagnostics({ clientId: 'c', date, evaluatedAt, outcome, outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: ['team@magicengine.com.au'], accounts: [account], ...extra })
}
const nalSnaps = (date: string, asOf: string) => replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: asOf, date, daily: nalDaily, activities: nalActivities as ActivityRow[] })
const nalAcc = (snaps: EntitySnapshotRow[], date: string, daily = nalDaily) => accountInput({ fixture: NAL, snapshots: snaps, daily, lastInsightDate: date })

// 真实实验对象的形状（CTS 1489853439620194），时间窗平移到被测窗口——派生，只为验证「实验排除」这道闸
const study = (start: string, end: string) => [{ id: (ctsStudy as { id: string }).id, type: 'SPLIT_TEST', start_time: start, end_time: end }]

describe('M7 实验排除：闸真的在起作用（不只是断言空转）', () => {
  it('NAL 3PL 组 8/27 本来 D3 命中；给它挂上窗口内的实验 → 不再命中，并进 excluded', () => {
    const base = run(nalAcc(nalSnaps('2026-08-27', '2026-08-27T11:59:00Z'), '2026-08-27'), '2026-08-27', '2026-08-27T11:59:00Z', LEAD)
    expect(base.diagnoses.some(d => d.code === 'D3' && d.status === 'hit' && d.units[0].id === '52589907084325')).toBe(true)
    const snaps = nalSnaps('2026-08-27', '2026-08-27T11:59:00Z').map(s => (s.entity_id === '52589907084325' ? { ...s, ad_studies: study('2026-08-20T00:00:00+0000', '2026-08-30T00:00:00+0000') } : s))
    const r = run(nalAcc(snaps, '2026-08-27'), '2026-08-27', '2026-08-27T11:59:00Z', LEAD)
    expect(r.diagnoses.some(d => d.units.some(u => u.id === '52589907084325'))).toBe(false)
    expect(r.excluded.find(e => e.id === '52589907084325')?.reason).toBe('meta_experiment')
  })

  it('实验只挂在系列上 → 系列下的广告组一并排除', () => {
    const snaps = nalSnaps('2026-08-27', '2026-08-27T11:59:00Z').map(s => (s.level === 'campaign' && s.entity_id === '52589907084125' ? { ...s, ad_studies: study('2026-08-20T00:00:00+0000', '2026-08-30T00:00:00+0000') } : s))
    const r = run(nalAcc(snaps, '2026-08-27'), '2026-08-27', '2026-08-27T11:59:00Z', LEAD)
    expect(r.excluded.map(e => e.id)).toEqual(expect.arrayContaining(['52589907084125', '52589907084325']))
    expect(r.diagnoses.some(d => d.code === 'D3' && d.status === 'hit')).toBe(false)
  })

  it('实验时间窗不和评估窗口重叠 → 不排除（D3 照常命中）', () => {
    const snaps = nalSnaps('2026-08-27', '2026-08-27T11:59:00Z').map(s => (s.entity_id === '52589907084325' ? { ...s, ad_studies: study('2026-09-13T12:31:23+0000', '2026-09-23T12:31:23+0000') } : s))
    const r = run(nalAcc(snaps, '2026-08-27'), '2026-08-27', '2026-08-27T11:59:00Z', LEAD)
    expect(r.diagnoses.some(d => d.code === 'D3' && d.status === 'hit')).toBe(true)
  })

  it('D4：两个 ThruPlay 组都在实验中 → 破冰花费不计，D4 不报', () => {
    const snaps = nalSnaps('2026-09-13', '2026-09-13T09:00:00Z').map(s => (['52596939123725', '52596931528525'].includes(s.entity_id) ? { ...s, ad_studies: study('2026-09-10T00:00:00+0000', '2026-09-20T00:00:00+0000') } : s))
    const r = run(nalAcc(snaps, '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    expect(r.diagnoses.find(d => d.code === 'D4')).toBeUndefined()
  })
})

describe('D5 比较本身（真实命中 + 统计函数）', () => {
  it('NAL 9/07–9/13 私信开聊：WhatsApp 系列花 31.9% 的钱拿到 47.9% 的开聊，物流系列 68.1% → 52.1%；二项检验 p=0.02，BH 后 0.02', () => {
    const r = run(nalAcc(nalSnaps('2026-09-13', '2026-09-13T09:00:00Z'), '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    const hits = r.diagnoses.filter(d => d.code === 'D5' && d.status === 'hit')
    expect(hits.map(h => h.units[0].id).sort()).toEqual(['52589907084125', '52594661605725'])
    expect(hits.find(h => h.units[0].id === '52594661605725')?.evidence).toMatchObject({ spend: 66.34, results: 23, spend_share: 0.319, result_share: 0.479, group_results: 48 })
  })

  it('每个 D5 命中都必须过显著性（BH 后 p ≤ 0.1）和占比差（≥0.15）两道闸——NAL 8/24–9/13 每天逐日核', () => {
    let hitDays = 0
    for (let d = shiftDate('2026-08-24', 0); d <= '2026-09-13'; d = shiftDate(d, 1)) {
      const r = run(nalAcc(nalSnaps(d, `${d}T09:00:00Z`), d), d, `${d}T09:00:00Z`, MSG)
      for (const h of r.diagnoses.filter(x => x.code === 'D5' && x.status === 'hit')) {
        hitDays++
        expect(Number(h.evidence.bh_adjusted_p)).toBeLessThanOrEqual(0.1)
        expect(Math.abs(Number(h.evidence.result_share) - Number(h.evidence.spend_share))).toBeGreaterThanOrEqual(0.15)
      }
    }
    expect(hitDays).toBeGreaterThan(0)
  })

  it('统计函数：二项双侧 p、Benjamini–Hochberg', () => {
    expect(binomialTwoSidedP(0, 10, 0.5)).toBeCloseTo(0.00195, 4) // 只有 0 次这一侧概率 ≤ 观测值：0.5^10 × 2
    expect(binomialTwoSidedP(5, 10, 0.5)).toBeCloseTo(1, 6)
    expect(benjaminiHochberg([0.01, 0.04, 0.03])).toEqual([0.03, 0.04, 0.04])
  })
})

describe('D1 复审补测', () => {
  const cts913 = (hourly: Record<string, HourlyRow[]>, patch: (s: EntitySnapshotRow[]) => EntitySnapshotRow[] = s => s) =>
    accountInput({ fixture: CTS, snapshots: patch(replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] })), daily: ctsDaily, hourly, lastInsightDate: '2026-09-13' })

  it('🔴 日终时这个组已被暂停（主动停投）→ 不报投放卡住', () => {
    const acc = cts913(ctsHourly, s => s.map(x => (x.level === 'adset' || x.level === 'campaign' ? { ...x, effective_status: 'PAUSED' } : x)))
    expect(run(acc, '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')).toBeUndefined()
  })

  it('读不到任何日预算（快照里预算都是空）→ 不报（「预算有剩」无从谈起）', () => {
    const acc = cts913(ctsHourly, s => s.map(x => ({ ...x, daily_budget_minor: null })))
    expect(run(acc, '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')).toBeUndefined()
  })

  it('🔴 夜里 0–6 点零投放 + 下午 14 点后真卡住 → 报下午那段，不被夜间段挡掉（9/13 真实行去掉 0–5 点）', () => {
    const both = { ...ctsHourly, '2026-09-13': ctsHourly['2026-09-13'].filter(h => h.hour >= 6) }
    const d1 = run(cts913(both), '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')
    expect(d1).toMatchObject({ status: 'hit', evidence: expect.objectContaining({ stall_start_hour: 14, stall_hours: 10 }) })
  })

  it('M5 容差：前一天停在 11 点（差 3 小时）不算同一时刻', () => {
    const r11 = { ...ctsHourly, '2026-09-11': ctsHourly['2026-09-11'].filter(h => h.hour < 11) }
    expect(run(cts913(r11), '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')?.evidence.repeated_same_hour_days).toBe(0)
  })
})

describe('第二轮核验补测', () => {
  const ctsSnaps = () => replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] })

  it('🔴 N1：账户里有 Meta 实验在跑时，投放卡住不能漏报（花费和预算都要算上实验单位）', () => {
    // 派生：复制 CTS 顶层 ThruPlay 组（同预算、同日花费、同小时花费）为第二个组，并挂上真实实验形状
    const src = ctsSnaps().find(s => s.entity_id === '52549857906273')!
    const twin = { ...src, entity_id: 'derived-twin', ad_studies: study('2026-09-10T00:00:00+0000', '2026-09-20T00:00:00+0000') }
    const daily = [...ctsDaily, ...ctsDaily.filter(r => r.entity_id === '52549857906273').map(r => ({ ...r, entity_id: 'derived-twin' }))]
    const hourly = Object.fromEntries(Object.entries(ctsHourly).map(([d, rows]) => [d, [...rows, ...rows.map(h => ({ ...h, adset_id: 'derived-twin' }))]]))
    const acc = accountInput({ fixture: CTS, snapshots: [...ctsSnaps(), twin], daily, hourly, lastInsightDate: '2026-09-13' })
    const d1 = run(acc, '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')
    expect(d1).toMatchObject({ status: 'hit', evidence: expect.objectContaining({ daily_budget: 120, budget_remaining: 46.44 }) })
  })

  it('夜里停得比下午长（0–6 点 6 小时 vs 14–17 点 3 小时）→ 仍报下午那段', () => {
    // 派生：9/13 真实行去掉 0–5 点；17 点后补回 9/12 同小时真实行，下午缺口只剩 14–17 点
    const hours = [...ctsHourly['2026-09-13'].filter(h => h.hour >= 6), ...ctsHourly['2026-09-12'].filter(h => h.hour >= 17)]
    const acc = accountInput({ fixture: CTS, snapshots: ctsSnaps(), daily: ctsDaily, hourly: { ...ctsHourly, '2026-09-13': hours }, lastInsightDate: '2026-09-13' })
    const d1 = run(acc, '2026-09-13', '2026-09-14T03:00:00Z', LEAD).diagnoses.find(d => d.code === 'D1')
    expect(d1).toMatchObject({ status: 'hit', evidence: expect.objectContaining({ stall_start_hour: 14, stall_hours: 3 }) })
  })

  it('D5 显著性闸：占比差够（WhatsApp 系列 30% 的钱 → 45.5% 开聊，差 0.155）但样本只有 11 次开聊（p≈0.32）→ 不报', () => {
    // 派生：评估窗口里只保留 9/11 当天的真实行
    const oneDay = nalDaily.filter(r => r.insight_date < '2026-09-07' || r.insight_date === '2026-09-11')
    const r = run(nalAcc(nalSnaps('2026-09-13', '2026-09-13T09:00:00Z'), '2026-09-13', oneDay), '2026-09-13', '2026-09-13T09:00:00Z', { ...MSG, minPrimaryPerUnit: 1 })
    expect(r.diagnoses.filter(d => d.code === 'D5' && d.status === 'hit')).toEqual([])
  })

  it('空账户（没有系列、窗口里没有花费）→ 不报「诊断缺数据」', () => {
    const r = run(nalAcc([], '2026-09-13', []), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    expect(r.diagnoses.find(d => d.code === 'D7' && d.title.includes('缺数据'))).toBeUndefined()
  })
})

describe('D4 复审补测', () => {
  it('🔴 广告级快照缺失（找不到破冰视频）→ not_comparable，不报「没受众」', () => {
    const snaps = nalSnaps('2026-09-13', '2026-09-13T09:00:00Z').filter(s => s.level !== 'ad')
    const d4 = run(nalAcc(snaps, '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', MSG).diagnoses.find(d => d.code === 'D4')
    expect(d4).toMatchObject({ status: 'not_comparable', notComparableReason: 'no_video_creatives' })
  })

  it('🔴 覆盖视频的受众一个太新、一个人数在下限 → not_comparable，不命中（第二个受众由真实受众复制、改 id 与人数派生）', () => {
    const snaps = nalSnaps('2026-09-13', '2026-09-13T12:30:00Z')
    const aud = snaps.find(s => s.level === 'audience')!
    const small = { ...aud, entity_id: 'derived-small', audience_created_at: '2026-09-01T00:00:00.000Z', audience_count_lower: 1000 }
    const d4 = run(nalAcc([...snaps, small], '2026-09-13'), '2026-09-13', '2026-09-13T12:30:00Z', MSG).diagnoses.find(d => d.code === 'D4')
    expect(d4?.status).toBe('not_comparable')
  })

  it('破冰花费刚好 30（两个组各 3 天 × 5）→ 不判（下限是「大于」）', () => {
    const daily = nalDaily.map(r => (['52596939123725', '52596931528525'].includes(r.entity_id) ? { ...r, spend: 5 } : r))
    const snaps = nalSnaps('2026-09-13', '2026-09-13T09:00:00Z')
    expect(run(nalAcc(snaps, '2026-09-13', daily), '2026-09-13', '2026-09-13T09:00:00Z', MSG).diagnoses.find(d => d.code === 'D4')).toBeUndefined()
  })

  it('受众建成时间晚于评估日结束 → 不算覆盖（D4 命中，covering_audiences=0）', () => {
    const snaps = nalSnaps('2026-09-13', '2026-09-13T12:30:00Z').map(s => (s.level === 'audience' ? { ...s, audience_created_at: '2026-09-20T00:00:00.000Z' } : s))
      .filter(s => s.entity_id !== '52597304727125')
    const d4 = run(nalAcc(snaps, '2026-09-13'), '2026-09-13', '2026-09-13T12:30:00Z', MSG).diagnoses.find(d => d.code === 'D4')
    expect(d4).toMatchObject({ status: 'hit', evidence: expect.objectContaining({ covering_audiences: 0 }) })
  })
})

describe('D3 / D7 / D8 复审补测', () => {
  it('主结果归不上、但花费没到 2× 目标线 → 连 not_comparable 都不出（健康日不出噪音）', () => {
    const r = run(nalAcc(nalSnaps('2026-08-27', '2026-08-27T11:59:00Z'), '2026-08-27'), '2026-08-27', '2026-08-27T11:59:00Z', { ...LEAD, primary: 'qualified_enquiry', targetCostPerPrimary: 1000 })
    expect(r.diagnoses.filter(d => d.code === 'D3')).toEqual([])
  })

  it('🔴 没数据不能显示成健康：快照为空 → D7「诊断缺数据」', () => {
    const r = run(nalAcc([], '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    expect(r.diagnoses.find(d => d.code === 'D7' && d.title.includes('缺数据'))).toBeDefined()
  })

  it('🔴 只有系列级日数据、没有广告组级 → D7「诊断缺数据」（系列级行由广告组行按所属系列改标派生）', () => {
    const campaignOnly = nalDaily.map(r => ({ ...r, level: 'campaign' as const, entity_id: r.parent_id ?? r.entity_id }))
    const r = run(nalAcc(nalSnaps('2026-09-13', '2026-09-13T09:00:00Z'), '2026-09-13', campaignOnly), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    expect(r.diagnoses.find(d => d.code === 'D7' && d.title.includes('广告组级日数据'))).toBeDefined()
  })

  it('D8：领先=主结果 → 不报；主结果能归上（留资/留资）→ 不报', () => {
    const same = run(nalAcc(nalSnaps('2026-09-13', '2026-09-13T09:00:00Z'), '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', MSG)
    expect(same.diagnoses.find(d => d.code === 'D8')).toBeUndefined()
    const attributable = run(nalAcc(nalSnaps('2026-09-13', '2026-09-13T09:00:00Z'), '2026-09-13'), '2026-09-13', '2026-09-13T09:00:00Z', { ...MSG, primary: 'messaging_depth_3' })
    expect(attributable.diagnoses.find(d => d.code === 'D8')).toBeUndefined()
  })

  it('D8：领先与主结果都是留资，3PL 系列有几天留资归不上 → 仍不报（同一级结果谈不上「领先有、主结果没」）', () => {
    const r = run(nalAcc(nalSnaps('2026-09-03', '2026-09-03T11:59:00Z'), '2026-09-03'), '2026-09-03', '2026-09-03T11:59:00Z', LEAD)
    expect(r.diagnoses.find(d => d.code === 'D8')).toBeUndefined()
  })

  it('多账户客户「没配目标单次成本」只出一条', () => {
    const acc = nalAcc(nalSnaps('2026-09-03', '2026-09-03T11:59:00Z'), '2026-09-03')
    const r = runDiagnostics({ clientId: 'c', date: '2026-09-03', evaluatedAt: '2026-09-03T11:59:00Z', outcome: { ...LEAD, targetCostPerPrimary: null }, outcomeConfigured: true, messagingReferralAvailable: false, digestRecipients: [], accounts: [acc, { ...acc, adAccountId: 'act_second' }] })
    expect(r.diagnoses.filter(d => d.code === 'D3' && d.notComparableReason === 'target_cost_not_configured')).toHaveLength(1)
  })
})

describe('加载器 / 时区 / 内部邮箱', () => {
  const row = (entity_id: string, captured_at: string, capture_reason: EntitySnapshotRow['capture_reason']) =>
    ({ level: 'adset', entity_id, captured_at, capture_reason }) as Pick<EntitySnapshotRow, 'level' | 'entity_id' | 'captured_at' | 'capture_reason'>

  it('latestSnapshotsAsOf：只取评估时刻之前的最新一行；最新一行是 disappeared 的实体不出现', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T09:00:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
    const a = snaps.find(s => s.entity_id === '52596939123725')!
    const rows: EntitySnapshotRow[] = [
      { ...a, captured_at: '2026-09-10T00:00:00Z', daily_budget_minor: 111 },
      { ...a, captured_at: '2026-09-12T00:00:00Z', daily_budget_minor: 222 },
      { ...a, captured_at: '2026-09-20T00:00:00Z', daily_budget_minor: 333 },
      { ...snaps.find(s => s.entity_id === '52596931528525')!, captured_at: '2026-09-11T00:00:00Z', capture_reason: 'disappeared' },
    ]
    const out = latestSnapshotsAsOf(rows, Date.parse('2026-09-13T12:00:00Z'))
    expect(out.map(r => [r.entity_id, r.daily_budget_minor])).toEqual([['52596939123725', 222]])
    void row
  })

  it('hourlyRowsFromGraph：真实小时字段 "14:00:00 - 14:59:59" → 14', () => {
    const raw = (ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days['2026-09-12']
    const parsed = hourlyRowsFromGraph(raw)
    expect(parsed).toHaveLength(raw.length)
    expect(parsed.find(h => h.hour === 14)?.spend).toBe(1.15)
  })

  it('半小时时区（Adelaide +9:30）日终切准；Auckland 夏令时切换日也准', () => {
    expect(new Date(localDayEndUtc('2026-08-01', 'Australia/Adelaide') + 1000).toISOString()).toBe('2026-08-01T14:30:00.000Z')
    expect(new Date(localDayEndUtc('2026-09-27', 'Pacific/Auckland') + 1000).toISOString()).toBe('2026-09-27T11:00:00.000Z')
  })

  it('内部邮箱：认域名与带显示名的写法；客户域名、gmail 不算；逗号串先拆开', () => {
    expect(isInternalEmail('Ray <hello@magicengine.cloud>')).toBe(true)
    expect(isInternalEmail('boss@ctstours.co.nz')).toBe(false)
    expect(isInternalEmail('someone@gmail.com')).toBe(false)
    expect(splitAddresses(['a@magicengine.cloud, boss@ctstours.co.nz'])).toEqual(['a@magicengine.cloud', 'boss@ctstours.co.nz'])
  })
})
