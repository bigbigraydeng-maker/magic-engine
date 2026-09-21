/**
 * 每道闸的独立用例（配合变异测试：拆掉哪道闸，就有哪条用例变红，且断言命中锚点而不只是「输出为空」）。
 * 输入全部从真实回放数据派生（CTS 官方账户 9/13、Oztop 8/19 之后、NAL 9/03）；派生方式写在用例里。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import ctsSettings from '../../__tests__/fixtures/cts-settings.json'
import nalSettings from '../../__tests__/fixtures/nal-settings.json'
import oztopSettings from '../../__tests__/fixtures/oztop-settings.json'
import nalDailyRaw from '../../__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import nalActivities from './fixtures/nal-activities-budget-create.json'
import ctsDailyRaw from './fixtures/cts-official-daily-adset-2026-09-07_2026-09-14.json'
import ctsHourlyRaw from './fixtures/cts-official-hourly-adset.json'
import ctsActivities from './fixtures/cts-official-activities-budget-create.json'
import oztopDailyRaw from './fixtures/oztop-daily-adset-2026-07-01_2026-08-18.json'
import oztopActivities from './fixtures/oztop-activities-budget-create.json'
import { accountInput, dailyRowsFromGraph, hourlyFromGraph, replaySnapshots, settingsFixture, type ActivityRow } from './replay'
import { runDiagnostics } from '../run'
import type { AccountInput, DailyRow, DiagnosisInput, HourlyRow } from '../types'
import type { OutcomeConfig } from '../../outcome-ladder'
import type { GraphHourlySpendRow } from '@/lib/meta/entity-settings'

const CTS = settingsFixture(ctsSettings)
const NAL = settingsFixture(nalSettings)
const OZ = settingsFixture(oztopSettings)
const CONFIGURED: OutcomeConfig = { leading: 'lead', primary: 'lead', targetCostPerPrimary: 40, minPrimaryPerUnit: 5 }

let ctsDaily: DailyRow[] = []
let nalDaily: DailyRow[] = []
let ozDaily: DailyRow[] = []
let ctsHourly: Record<string, HourlyRow[]> = {}
beforeAll(async () => {
  ctsDaily = await dailyRowsFromGraph(ctsDailyRaw)
  nalDaily = await dailyRowsFromGraph(nalDailyRaw)
  ozDaily = await dailyRowsFromGraph(oztopDailyRaw)
  ctsHourly = hourlyFromGraph((ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days)
})

function run(account: AccountInput, date: string, evaluatedAt: string, extra: Partial<DiagnosisInput> = {}) {
  return runDiagnostics({
    clientId: 'c', date, evaluatedAt, outcome: CONFIGURED, outcomeConfigured: true,
    messagingReferralAvailable: false, digestRecipients: ['team@magicengine.com.au'], accounts: [account], ...extra,
  })
}

function cts913(hourly: Record<string, HourlyRow[]>, patch: (snaps: ReturnType<typeof replaySnapshots>) => ReturnType<typeof replaySnapshots> = s => s) {
  const snapshots = patch(replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] }))
  return accountInput({ fixture: CTS, snapshots, daily: ctsDaily, hourly, lastInsightDate: '2026-09-13' })
}

describe('D1 各道闸', () => {
  it('没拿到当天小时数据 → not_comparable(no_hourly_data)，不猜', () => {
    const { ['2026-09-13']: _drop, ...rest } = ctsHourly
    const r = run(cts913(rest), '2026-09-13', '2026-09-14T03:00:00Z')
    expect(r.diagnoses.find(d => d.code === 'D1')).toMatchObject({ status: 'not_comparable', notComparableReason: 'no_hourly_data' })
  })

  it('零投放缺口全在夜间低谷（把 9/13 的缺口挪到 0–5 点）→ not_comparable(night_trough)', () => {
    // 派生：9/13 真实小时行里去掉 0–5 点，补回 14–23 点（取 9/12 同小时的真实行、日期改成 9/13）
    const night = [
      ...ctsHourly['2026-09-13'].filter(h => h.hour >= 6),
      ...ctsHourly['2026-09-12'].filter(h => h.hour >= 14),
    ]
    const r = run(cts913({ ...ctsHourly, '2026-09-13': night }), '2026-09-13', '2026-09-14T03:00:00Z')
    const d1 = r.diagnoses.find(d => d.code === 'D1')
    // 当天总花费照原数据算（预筛照样命中），缺口只剩夜里
    expect(d1).toMatchObject({ status: 'not_comparable', notComparableReason: 'night_trough', evidence: expect.objectContaining({ stall_start_hour: 0 }) })
  })

  it('缺口结束才 1 小时就评估（报表延迟窗口内）→ not_comparable(report_lag)', () => {
    const r = run(cts913(ctsHourly), '2026-09-13', '2026-09-13T12:30:00Z') // NZ 9/14 00:30
    expect(r.diagnoses.find(d => d.code === 'D1')).toMatchObject({ status: 'not_comparable', notComparableReason: 'report_lag' })
  })

  it('有用总预算（排期）的在投单位 → not_comparable(scheduled_delivery)', () => {
    const acc = cts913(ctsHourly, snaps => snaps.map(s => (s.entity_id === '52549857906273' ? { ...s, lifetime_budget_minor: 50000 } : s)))
    const r = run(acc, '2026-09-13', '2026-09-14T03:00:00Z')
    expect(r.diagnoses.find(d => d.code === 'D1')).toMatchObject({ status: 'not_comparable', notComparableReason: 'scheduled_delivery' })
  })

  it('昨天同时段也没投（把 9/12 下午的小时行去掉）→ 不报（这是常态不是卡住）', () => {
    const quietYesterday = { ...ctsHourly, '2026-09-12': ctsHourly['2026-09-12'].filter(h => h.hour < 14) }
    const r = run(cts913(quietYesterday), '2026-09-13', '2026-09-14T03:00:00Z')
    expect(r.diagnoses.find(d => d.code === 'D1')).toBeUndefined()
  })

  it('M5：前一天同一时刻（±1 小时）也停 → repeated_same_hour_days 计数', () => {
    // 派生：9/11 真实小时行去掉 13 点之后的，作为「前一天也在同一时刻停」
    const repeat = { ...ctsHourly, '2026-09-11': ctsHourly['2026-09-11'].filter(h => h.hour < 13) }
    const r = run(cts913(repeat), '2026-09-13', '2026-09-14T03:00:00Z')
    const d1 = r.diagnoses.find(d => d.code === 'D1')
    expect(d1?.status).toBe('hit')
    expect(d1?.evidence.repeated_same_hour_days).toBe(1)
    expect(d1?.reasons.join('')).toContain('单日花费上限')
  })
})

describe('§14 M9 共用账户', () => {
  it('同一账户登记给多个客户 → 只做账户级（D1/D7），实体级 D3/D4/D5/D8 一条都不出，excluded 里写明', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T09:00:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
    const shared = { ...accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-13' }), shared: true }
    const r = run(shared, '2026-09-13', '2026-09-13T09:00:00Z', { outcome: { ...CONFIGURED, leading: 'messaging_started', primary: 'qualified_enquiry' } })
    expect(r.excluded.find(e => e.reason === 'shared_account')?.id).toBe(NAL.ad_account_id)
    expect(r.diagnoses.filter(d => ['D3', 'D4', 'D5', 'D8'].includes(d.code))).toEqual([])
    // 同一份数据不标共用时 D4/D8 是命中的（证明上面是闸挡的，不是本来就没有）
    const notShared = run({ ...shared, shared: false }, '2026-09-13', '2026-09-13T09:00:00Z', { outcome: { ...CONFIGURED, leading: 'messaging_started', primary: 'qualified_enquiry' } })
    expect(notShared.diagnoses.filter(d => d.status === 'hit').map(d => d.code)).toEqual(expect.arrayContaining(['D4', 'D8']))
  })
})

describe('D7 授权/数据体检（只读，只下发人工任务）', () => {
  it('账户读不到（Roman 真实报错：403 账户主人没给读取权限）→ 命中，带三件套', () => {
    const snaps = replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] })
    const acc = { ...accountInput({ fixture: CTS, snapshots: snaps, daily: ctsDaily, hourly: ctsHourly, lastInsightDate: '2026-09-13' }),
      latestCaptures: [{ level: 'account', complete: false, skipped_shared: false, error: '(#200) Ad account owner has NOT grant ads_management or ads_read permission', captured_at: '2026-09-14T00:30:00Z' }] }
    const d7 = run(acc, '2026-09-13', '2026-09-14T03:00:00Z').diagnoses.find(d => d.code === 'D7' && d.title.includes('读不到'))
    expect(d7?.manualTask?.what).toContain('读不到')
    expect(d7?.manualTask?.how).toBeTruthy()
    expect(d7?.clientVisible).toBe(false)
  })

  it('Oztop 真实情况：有在投状态的单位，但 8/18 之后没有任何日数据 → 在 9/13 评估命中「数据停更」', () => {
    // 派生：按 8/18 当天的投放证据重建在投状态（表单组 8/17–8/18 有花费），评估日 9/13，日数据只到 8/18
    const snaps = replaySnapshots({ fixture: OZ, clientId: 'c', asOfIso: '2026-09-13T13:59:59Z', date: '2026-08-18', daily: ozDaily, activities: oztopActivities as ActivityRow[] })
    const acc = accountInput({ fixture: OZ, snapshots: snaps, daily: ozDaily, lastInsightDate: '2026-08-18' })
    const d7 = run(acc, '2026-09-13', '2026-09-13T23:00:00Z').diagnoses.find(d => d.code === 'D7' && d.title.includes('停更'))
    expect(d7?.evidence.last_insight_date).toBe('2026-08-18')
    expect(d7?.manualTask?.href).toContain('adsmanager.facebook.com')
  })

  it('日报收件人里有客户邮箱 → 命中；只有内部邮箱 → 不命中', () => {
    const snaps = replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-08T11:59:59Z', date: '2026-09-08', daily: ctsDaily, activities: ctsActivities as ActivityRow[] })
    const acc = accountInput({ fixture: CTS, snapshots: snaps, daily: ctsDaily, hourly: ctsHourly, lastInsightDate: '2026-09-08' })
    const ext = run(acc, '2026-09-08', '2026-09-08T23:00:00Z', { digestRecipients: ['team@magicengine.com.au', 'boss@client-example.co.nz'] })
    expect(ext.diagnoses.find(d => d.code === 'D7')?.evidence.external_recipients).toBe(1)
    // 全内部收件人时没有 D7 命中——但 GC 顶层 ThruPlay 广告组本身就没排除 Audience Network（真实存在，
    // D9 2026-09-22 补规则后才抓出来），跟收件人这条测的事无关，不能再断言零诊断。
    expect(run(acc, '2026-09-08', '2026-09-08T23:00:00Z').diagnoses.filter(d => d.code === 'D7')).toEqual([])
  })

  it('结果阶梯没配 → 命中（D3/D5 会一直判不了）', () => {
    const snaps = replaySnapshots({ fixture: CTS, clientId: 'c', asOfIso: '2026-09-08T11:59:59Z', date: '2026-09-08', daily: ctsDaily, activities: ctsActivities as ActivityRow[] })
    const acc = accountInput({ fixture: CTS, snapshots: snaps, daily: ctsDaily, hourly: ctsHourly, lastInsightDate: '2026-09-08' })
    const r = run(acc, '2026-09-08', '2026-09-08T23:00:00Z', { outcomeConfigured: false, outcome: { leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: 5 } })
    expect(r.diagnoses.find(d => d.code === 'D7')?.title).toContain('广告结果怎么算')
  })
})

describe('D3 / D5 结果闸', () => {
  it('M8：D3 主结果是合格询盘（归不到广告）、配了目标 → 3PL 组花费够线也只能 not_comparable(primary_result_unknown)，绝不报命中', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-08-27T11:59:00Z', date: '2026-08-27', daily: nalDaily, activities: nalActivities as ActivityRow[] })
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-08-27' }), '2026-08-27', '2026-08-27T11:59:00Z',
      { outcome: { leading: 'messaging_started', primary: 'qualified_enquiry', targetCostPerPrimary: 25, minPrimaryPerUnit: 5 } })
    const d3 = r.diagnoses.filter(d => d.code === 'D3')
    expect(d3.some(d => d.status === 'hit')).toBe(false)
    expect(d3.find(d => d.units[0].id === '52589907084325')).toMatchObject({ status: 'not_comparable', notComparableReason: 'primary_result_unknown' })
  })

  it('M6：D5 只比同角色——NAL 9/13 两个 ThruPlay 破冰系列绝不进入主结果占比比较', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T09:00:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-13' }), '2026-09-13', '2026-09-13T09:00:00Z',
      { outcome: { leading: 'messaging_started', primary: 'messaging_started', targetCostPerPrimary: null, minPrimaryPerUnit: 5 } })
    const d5Units = r.diagnoses.filter(d => d.code === 'D5').flatMap(d => d.units)
    expect(d5Units.some(u => u.id === '52596939123525' || u.id === '52596931528325')).toBe(false)
    expect(d5Units.some(u => u.role === 'awareness')).toBe(false)
  })
})

describe('D4 各道闸', () => {
  it('破冰只投了 2 天（NAL 9/12：9/11–9/12）→ 不报（刚开投没收割不算问题）', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-12T11:59:00Z', date: '2026-09-12', daily: nalDaily, activities: nalActivities as ActivityRow[] })
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-12' }), '2026-09-12', '2026-09-12T11:59:00Z')
    expect(r.diagnoses.find(d => d.code === 'D4')).toBeUndefined()
  })

  it('再营销组包含覆盖视频的受众、组在投 → 算已收割，不报', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T12:30:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
      .map(s => (s.entity_id === '52597304727125' ? { ...s, effective_status: 'ACTIVE' } : s))
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-13' }), '2026-09-13', '2026-09-13T12:30:00Z')
    expect(r.diagnoses.find(d => d.code === 'D4')).toBeUndefined()
  })

  it('M8：包含受众的组 Advantage+ 开着（mixed，不是再营销）→ 不算已收割 → 仍报（受众太新则 not_comparable）', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T12:30:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
      .map(s => (s.entity_id === '52597304727125' ? { ...s, effective_status: 'ACTIVE', advantage_audience: 1 } : s))
      .map(s => (s.level === 'audience' ? { ...s, audience_created_at: '2026-09-01T00:00:00.000Z', audience_count_lower: 5000 } : s))
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-13' }), '2026-09-13', '2026-09-13T12:30:00Z')
    expect(r.diagnoses.find(d => d.code === 'D4')).toMatchObject({ status: 'hit', evidence: expect.objectContaining({ unharvested_audiences: '52597304640525' }) })
  })

  it('覆盖受众人数在 Meta 显示下限（≤1000）且建成已超 72 小时 → not_comparable(audience_below_floor)', () => {
    const snaps = replaySnapshots({ fixture: NAL, clientId: 'c', asOfIso: '2026-09-13T12:30:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] })
      .map(s => (s.level === 'audience' ? { ...s, audience_created_at: '2026-09-01T00:00:00.000Z' } : s))
    const r = run(accountInput({ fixture: NAL, snapshots: snaps, daily: nalDaily, lastInsightDate: '2026-09-13' }), '2026-09-13', '2026-09-13T12:30:00Z')
    expect(r.diagnoses.find(d => d.code === 'D4')).toMatchObject({ status: 'not_comparable', notComparableReason: 'audience_below_floor' })
  })
})
