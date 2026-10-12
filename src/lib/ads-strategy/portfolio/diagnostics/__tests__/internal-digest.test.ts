/**
 * 内部版日报：内容用真实回放诊断（CTS 官方账户 2026-09-13、NAL 2026-09-13）生成，不自编诊断形状。
 * 🔴 只发内部：客户邮箱一律丢弃。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ctsSettings from '../../__tests__/fixtures/cts-settings.json'
import nalSettings from '../../__tests__/fixtures/nal-settings.json'
import nalDailyRaw from '../../__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import nalActivities from './fixtures/nal-activities-budget-create.json'
import ctsDailyRaw from './fixtures/cts-official-daily-adset-2026-09-07_2026-09-14.json'
import ctsHourlyRaw from './fixtures/cts-official-hourly-adset.json'
import ctsActivities from './fixtures/cts-official-activities-budget-create.json'
import { accountInput, dailyRowsFromGraph, hourlyFromGraph, replaySnapshots, settingsFixture, type ActivityRow } from './replay'
import { runDiagnostics } from '../run'
import type { DailyRow, DiagnosisRun } from '../types'
import type { GraphHourlySpendRow } from '@/lib/meta/entity-settings'

const sent: Array<{ to: string[]; subject: string; html: string }> = []
let sendError: { name: string; message: string; statusCode: number } | null = null
vi.mock('resend', () => ({
  Resend: class { emails = { send: async (m: { to: string[]; subject: string; html: string }) => { if (sendError) return { error: sendError }; sent.push(m); return { error: null } } } },
}))

type Row = Record<string, unknown>
const narratives: Row[] = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const filters: Array<[string, unknown, 'eq' | 'lt']> = []
      const match = () => narratives.filter(r => filters.every(([k, v, op]) => (op === 'eq' ? r[k] === v : String(r[k]) < String(v))))
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v, 'eq']); return b },
        lt: (k: string, v: unknown) => { filters.push([k, v, 'lt']); return b },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: match().sort((a, z) => String(z.insight_date).localeCompare(String(a.insight_date)))[0] ?? null, error: null }),
        update: (patch: Row) => ({ eq: (k1: string, v1: unknown) => ({ eq: async (k2: string, v2: unknown) => {
          for (const r of narratives) if (r[k1] === v1 && r[k2] === v2) Object.assign(r, patch)
          return { error: null }
        } }) }),
      }
      return b
    },
  },
}))

import { buildInternalDigest, decideInternalSend, persistAndSendInternalDigest, resolveInternalRecipients } from '../../internal-digest'
import { isInternalEmail as isInternalRecipient } from '../internal-email'

let ctsRun: DiagnosisRun
let nalRun: DiagnosisRun
beforeAll(async () => {
  const ctsDaily: DailyRow[] = await dailyRowsFromGraph(ctsDailyRaw)
  const nalDaily: DailyRow[] = await dailyRowsFromGraph(nalDailyRaw)
  const CTS = settingsFixture(ctsSettings)
  const NAL = settingsFixture(nalSettings)
  ctsRun = runDiagnostics({
    clientId: 'cts', date: '2026-09-13', evaluatedAt: '2026-09-14T03:00:00Z',
    outcome: { leading: 'lead', primary: 'lead', targetCostPerPrimary: 40, minPrimaryPerUnit: 5 }, outcomeConfigured: true,
    messagingReferralAvailable: false, digestRecipients: [],
    accounts: [accountInput({ fixture: CTS, snapshots: replaySnapshots({ fixture: CTS, clientId: 'cts', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] }), daily: ctsDaily, hourly: hourlyFromGraph((ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days), lastInsightDate: '2026-09-13' })],
  })
  nalRun = runDiagnostics({
    clientId: 'nal', date: '2026-09-13', evaluatedAt: '2026-09-13T09:00:00Z',
    outcome: { leading: 'messaging_started', primary: 'qualified_enquiry', targetCostPerPrimary: null, minPrimaryPerUnit: 5 }, outcomeConfigured: true,
    messagingReferralAvailable: false, digestRecipients: [],
    accounts: [accountInput({ fixture: NAL, snapshots: replaySnapshots({ fixture: NAL, clientId: 'nal', asOfIso: '2026-09-13T09:00:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] }), daily: nalDaily, lastInsightDate: '2026-09-13' })],
  })
})

beforeEach(() => { sent.length = 0; narratives.length = 0; sendError = null; process.env.RESEND_API_KEY = 'test'; delete process.env.AD_HEALTH_DIGEST_TO })

describe('收件人只留内部', () => {
  it('内部域名放行，客户域名丢弃', () => {
    expect(isInternalRecipient('hello@magicengine.cloud')).toBe(true)
    expect(isInternalRecipient('ops@magiclab.com')).toBe(true)
    expect(isInternalRecipient('owner@nalexpress.com')).toBe(false)
    expect(isInternalRecipient('someone@gmail.com')).toBe(false)
  })

  it('全是客户邮箱 → 发内部默认收件箱，并记下丢了几个', () => {
    const r = resolveInternalRecipients(['owner@nalexpress.com', 'boss@ctstours.co.nz'])
    expect(r.dropped).toBe(2)
    expect(r.to.length).toBe(1)
    expect(r.to.every(isInternalRecipient)).toBe(true)
  })

  it('🔴 兜底地址环境变量被设成客户邮箱（含逗号串）→ 不当内部，也不拿来兜底', () => {
    process.env.AD_HEALTH_DIGEST_TO = 'boss@ctstours.co.nz, owner@nalexpress.com'
    const r = resolveInternalRecipients(['boss@ctstours.co.nz'])
    expect(r.to).not.toContain('boss@ctstours.co.nz')
    expect(r.to.every(isInternalRecipient)).toBe(true)
  })

  it('带显示名、大小写混写的内部地址 → 认得出，按裸地址发', () => {
    expect(resolveInternalRecipients(['Ray <Hello@MagicEngine.cloud>']).to).toEqual(['hello@magicengine.cloud'])
  })
})

describe('发不发（防疲劳）', () => {
  it('有命中发；昨天有今天没有发「恢复」；昨天有、今天判不了 →「🟡 判不了」不算恢复；周一例行；其余不发', () => {
    expect(decideInternalSend({ hits: 1, notComparable: 0 }, 0, false)).toBe('alert')
    expect(decideInternalSend({ hits: 0, notComparable: 0 }, 2, false)).toBe('recovery')
    expect(decideInternalSend({ hits: 0, notComparable: 3 }, 2, false)).toBe('uncertain')
    expect(decideInternalSend({ hits: 0, notComparable: 0 }, 0, true)).toBe('weekly')
    expect(decideInternalSend({ hits: 0, notComparable: 0 }, null, false)).toBe('skip')
  })

  it('周一判定按数据日期：2026-09-14 是周一、09-16 不是（发 2 封对比）', async () => {
    const quiet = { ...ctsRun, diagnoses: [] }
    for (const date of ['2026-09-14', '2026-09-16']) narratives.push({ client_id: 'q', insight_date: date, payload: { campaigns: [] }, email_status: null })
    const mon = await persistAndSendInternalDigest({ clientId: 'q', clientName: 'Q', date: '2026-09-14', run: quiet, configuredRecipients: [] })
    const wed = await persistAndSendInternalDigest({ clientId: 'q', clientName: 'Q', date: '2026-09-16', run: quiet, configuredRecipients: [] })
    expect([mon.decision, wed.decision]).toEqual(['weekly', 'skip'])
  })
})

describe('日报内容（真实回放诊断）', () => {
  it('CTS 9/13：一句结论 + 账户层面「投放卡住」+ 样本量；明说只读、仅限内部', () => {
    const { subject, html } = buildInternalDigest({ clientName: 'CTS Tours NZ', date: '2026-09-13', run: ctsRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(subject).toContain('内部')
    // 「投放卡住」(D1) + 「没排除 Audience Network」(D9，2026-09-22 补的规则，抓的是真实存在的配置问题）。
    expect(html).toContain('发现 2 件要看的事')
    expect(html).toContain('账户层面')
    expect(html).toContain('投放卡住')
    expect(html).toContain('样本：')
    expect(html).toContain('只读诊断，没有改任何广告和预算')
    expect(html).toContain('NZD 23.22')
    expect(html).toContain('<a href="https://adsmanager.facebook.com/')
  })

  it('例行信里有判不了的 → 🟡 并明说「判不了」，不写「没问题」', () => {
    // 派生：把 CTS 9/13 那条真实 D1 改成「判不了」
    const run = { ...ctsRun, diagnoses: ctsRun.diagnoses.map(d => ({ ...d, status: 'not_comparable' as const, notComparableReason: 'no_hourly_data' as const })) }
    const { html } = buildInternalDigest({ clientName: 'C', date: '2026-09-14', run, decision: 'weekly', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(html).toContain('🟡')
    expect(html).toContain('判不了')
    expect(html).not.toContain('🟢')
  })

  it('相对链接补成正式站绝对地址、可点', () => {
    const run = { ...ctsRun, diagnoses: [{ ...ctsRun.diagnoses[0], manualTask: { what: 'x', how: 'y', href: '/dashboard/clients/c/settings' } }] }
    const { html } = buildInternalDigest({ clientName: 'C', date: '2026-09-13', run, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(html).toContain('<a href="https://app.magicengine.com.au/dashboard/clients/c/settings"')
  })

  it('广告名里的尖括号 / 引号被转义（不注入 HTML）', () => {
    const run = { ...ctsRun, diagnoses: [{ ...ctsRun.diagnoses[0], title: '<script>alert("x")</script>' }] }
    const { html } = buildInternalDigest({ clientName: 'C', date: '2026-09-13', run, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;x&quot;')
  })

  it('NAL 9/13：命中按角色分组（破冰下面是攒了人没收割），D8 也在', () => {
    const { html } = buildInternalDigest({ clientName: 'New Asian Logistics', date: '2026-09-13', run: nalRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    const awarenessAt = html.indexOf('破冰（让没见过的人看到）')
    expect(awarenessAt).toBeGreaterThan(-1)
    expect(html.indexOf('攒了人没收割')).toBeGreaterThan(awarenessAt)
    expect(html).toContain('结果真相断层')
  })

  it('目标进度未判：归属不足照旧写「归属数据不足」；广告设置读失败不冒充成归属不足', () => {
    const pace = { expectedToDate: 35, actualToDate: null, gapPct: null, projectedEnd: null, verdict: 'unknown' as const, reason: 'r' }
    const goal = { title: 'G', label: '留资', target: 50, dayIndex: 15, totalDays: 30, pace }
    const build = (g: typeof goal & { configReadError?: string }) =>
      buildInternalDigest({ clientName: 'C', date: '2026-09-13', run: ctsRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0, goal: g }).html
    expect(build(goal)).toContain('归属数据不足，未判（r）')
    const failed = build({ ...goal, pace: { ...pace, reason: '读不出广告设置' }, configReadError: 'boom' })
    expect(failed).toContain('— 未判（读不出广告设置）')
    expect(failed).not.toContain('归属数据不足')
  })

  it('不出现任何挪预算 / 改广告的操作指令', () => {
    const { html } = buildInternalDigest({ clientName: 'New Asian Logistics', date: '2026-09-13', run: nalRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(html).not.toMatch(/挪预算|加预算|减预算|暂停这/)
  })
})

describe('发送与回执', () => {
  it('🔴 配置里只有客户邮箱：邮件只发到内部收件箱，诊断并进当天体检记录，标 sent', async () => {
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { overall_verdict: 'healthy', campaigns: [] }, email_status: null })
    const r = await persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS Tours NZ', date: '2026-09-13', run: ctsRun, configuredRecipients: ['boss@ctstours.co.nz'] })
    expect(r).toMatchObject({ decision: 'alert', sent: true, recipients_dropped: 1, persisted: true })
    expect(sent).toHaveLength(1)
    expect(sent[0].to.every(isInternalRecipient)).toBe(true)
    expect(sent[0].to).not.toContain('boss@ctstours.co.nz')
    const stored = narratives[0].payload as { portfolio_diagnoses: { hit_count: number } }
    // D1（投放卡住）+ D9（GC 顶层 ThruPlay 广告组没排除 Audience Network，PITFALLS D9 那个真实的坑，
    // 2026-09-08 就已经存在，加了 D9 规则后这条真实回放数据正确地多命中一条，不是回归）。
    expect(stored.portfolio_diagnoses.hit_count).toBe(2)
    expect(narratives[0].email_status).toBe('sent')
  })

  it('🔴 所有地址都不是内部（兜底也被设成客户邮箱）→ 不发，回执写错误', async () => {
    process.env.AD_HEALTH_DIGEST_TO = 'boss@ctstours.co.nz'
    const prevTo = process.env.ME_MAIL_TO
    process.env.ME_MAIL_TO = 'boss@ctstours.co.nz'
    vi.resetModules()
    const mod = await import('../../internal-digest')
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { campaigns: [] }, email_status: null })
    const r = await mod.persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS', date: '2026-09-13', run: ctsRun, configuredRecipients: ['boss@ctstours.co.nz'] })
    expect(r.sent).toBe(false)
    expect(r.error).toContain('no internal recipient')
    expect(sent).toHaveLength(0)
    if (prevTo === undefined) delete process.env.ME_MAIL_TO; else process.env.ME_MAIL_TO = prevTo
    vi.resetModules()
  })

  it('发送商报错 → 回执标 failed，错误信息带状态码', async () => {
    sendError = { name: 'validation_error', message: 'bad', statusCode: 422 }
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { campaigns: [] }, email_status: null })
    const r = await persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS', date: '2026-09-13', run: ctsRun, configuredRecipients: [] })
    expect(r.error).toContain('HTTP 422')
    expect(narratives[0].email_status).toBe('failed')
  })

  it('同一天已经发过 → 不重发', async () => {
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { campaigns: [] }, email_status: 'sent' })
    const r = await persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS', date: '2026-09-13', run: ctsRun, configuredRecipients: [] })
    expect(r.sent).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
