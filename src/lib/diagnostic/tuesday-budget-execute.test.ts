import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { listConfirmationCards } from '@/lib/confirmation-card'
import { pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import { submitBudgetCard } from '@/lib/ads-budget-card/flow'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import type { BudgetExecuteCall, BudgetExecuteResult, BudgetPath } from '@/lib/ads-budget-card/path'
import type { PrescriptionLock, VersionLockSource } from '@/lib/ads-budget-card/prescription-lock'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot } from '@/lib/ads-budget-card/types'
import { issueTuesdayBudgetTunes, type TuesdayPorts } from './tuesday-budget-execute'
import { planTuesdayBudgetTunes, runTuesdayBudgetTune } from './tuesday-budget-tune'
import type { TuesdaySuggestion } from './tuesday-budget-recheck'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const PRESCRIPTION = 'a1110000-0000-4000-8000-000000000001'
const lock: PrescriptionLock = { prescriptionId: PRESCRIPTION, version: 2, goalId: GOAL_A, planId: 'plan-1', planHash: 'hash-1', approvedOn: '2026-11-02' }

function proposal(over: Partial<TuesdaySuggestion> = {}): TuesdaySuggestion {
  return { clientId: CLIENT_A, subjectKey: 'wkignored', direction: 'increase', accountLabel: '在投日预算', beforeCents: 3000, afterCents: 3600, currencyLabel: '纽元', why: '连续多天点击好于账户中位，预算却偏低。', dateLabel: '这周二', scopeLabel: '只改这一次日预算', adsetId: '111', adAccountId: 'act_111111', prescriptionId: PRESCRIPTION, name: '春季组', ...over }
}

function live(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return { registeredAccountIds: ['act_111111'], accountId: '111111', adsetId: '111', status: 'ACTIVE', currentCents: 3000, name: '春季组', accountCapCents: 20000, accountLiveCents: 3000, countedInLive: true, otherAccountsLiveCents: 0, clientCapCents: 50000, lifetimeBlocks: false, stepRatio: 0.2, ...over }
}

function planRow(cents: number | null) {
  const promo: Record<string, unknown> = { schema: 'promo_v1', goal_id: GOAL_A, phases: [{ id: 'p1', name: '阶段', start_date: '2026-11-01', end_date: '2026-11-30', steps: [] }], checks: [] }
  if (cents !== null) promo.daily_total_cap_cents = cents
  return { id: 'plan-1', client_id: CLIENT_A, status: 'approved', plan_data: { promo } }
}

function patrol(direction: 'increase' | 'decrease') {
  const dates = direction === 'increase' ? ['2026-11-02', '2026-11-01', '2026-10-31'] : ['2026-11-02', '2026-11-01']
  const finding = { code: direction === 'increase' ? 'O1' : 'D3', status: 'hit', title: '', units: [{ level: 'adset', id: '111', name: null }] }
  return dates.map((date) => ({ client_id: CLIENT_A, date, data_completeness: 'complete', payload: direction === 'increase' ? { opportunities: [finding], problems: [] } : { problems: [finding], opportunities: [] } }))
}

function fixture(planCap: number | null = 50000, direction: 'increase' | 'decrease' = 'increase') {
  return makeFixture({ registry: ACTION_REGISTRY, capabilities: (sb) => createCapabilities(sb), startAt: '2026-11-02T00:00:00.000Z', options: { extraTables: { marketing_plans: [planRow(planCap)], ads_growth_states: patrol(direction) } } })
}

function ports(box: { current: BudgetSnapshot }): TuesdayPorts & { calls: BudgetExecuteCall[]; path: BudgetPath } {
  const calls: BudgetExecuteCall[] = []
  const locks: VersionLockSource = { read: async () => ({ ok: true, lock }) }
  const path: BudgetPath = { execute: async (call) => { calls.push(call); return call.raising ? { kind: 'awaiting', wrote: false, readbackCents: null, actionRunId: 'run-1', reason: '加预算还要花钱的人再点一次。' } : { kind: 'executed', wrote: true, readbackCents: call.afterCents, actionRunId: 'run-1', reason: '已改好，回读的日预算和要改的一致。' } } }
  return { locks, calls, path, readLive: async () => box.current }
}

function runtime(box: { current: BudgetSnapshot }): BudgetRuntime {
  return { read: async (_order: BudgetOrder) => box.current }
}

async function shown(f: ReturnType<typeof fixture>, runId: string) {
  const card = (await listConfirmationCards(f.kernel, CLIENT_A, OPC)).find((row) => row.runId === runId)
  if (!card) throw new Error('确认卡没有列出来')
  return card
}

function confirm(f: ReturnType<typeof fixture>, card: { runId: string; expectedDecisionId: string; fingerprint: string }, box: { current: BudgetSnapshot }, wired: ReturnType<typeof ports>, now?: Date) {
  return submitBudgetCard({ kernel: f.kernel, clientId: CLIENT_A, runId: card.runId, clicker: OPC, resolution: 'confirm', expectedDecisionId: card.expectedDecisionId, fingerprint: card.fingerprint, runtime: runtime(box), locks: wired.locks, path: wired.path, now })
}

describe('周二加减预算确认后走原来的改预算卡', () => {
  it('出卡不改预算，人确认之后减预算才执行一次', async () => {
    const box = { current: live({ name: '春季组' }) }
    const wired = ports(box)
    const f = fixture(50000, 'decrease')
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ direction: 'decrease', afterCents: 2400 })], wired)
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    expect(wired.calls).toEqual([])
    const card = await shown(f, row.runId ?? '')
    expect(card.what.startsWith('把广告组 ')).toBe(true)
    expect(pausedDraftClickUrl(CLIENT_A, card.runId, card.what)).toContain('/meta-ads/budget-cards/')
    const done = await confirm(f, card, box, wired)
    expect(done.status).toBe('executed')
    expect(wired.calls).toEqual([expect.objectContaining({ raising: false, afterCents: 2400 })])
  })

  it('加预算的第一次确认不写，仍要第二次点头', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    const done = await confirm(f, await shown(f, row.runId ?? ''), box, wired)
    expect(done.status).toBe('awaiting')
    expect(done.wroteMeta).toBe(false)
    expect(wired.calls).toEqual([expect.objectContaining({ raising: true, afterCents: 3600 })])
  })

  it('代理人能出卡，不能确认', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    await expect(submitBudgetCard({ kernel: f.kernel, clientId: CLIENT_A, runId: row.runId ?? '', clicker: AGENT, resolution: 'confirm', expectedDecisionId: 'x', fingerprint: row.fingerprint ?? '', runtime: runtime(box), locks: wired.locks, path: wired.path })).rejects.toThrow(/不能点/)
    expect(wired.calls).toEqual([])
  })

  it('条件变了、现预算变了、或计划上限没了，确认都不改', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    const card = await shown(f, row.runId ?? '')
    f.tables.ads_growth_states.splice(0, f.tables.ads_growth_states.length)
    const cleared = await confirm(f, card, box, wired)
    expect(cleared.status).toBe('blocked')
    expect(cleared.reason).toContain('不成立')
    f.tables.ads_growth_states.push(...patrol('increase'))
    box.current = live({ currentCents: 2800 })
    const moved = await confirm(f, card, box, wired)
    expect(moved.reason).toContain('现预算')
    box.current = live()
    f.tables.marketing_plans[0].plan_data = { promo: { schema: 'promo_v1', goal_id: GOAL_A, phases: [], checks: [] } }
    const uncapped = await confirm(f, card, box, wired)
    expect(uncapped.reason).toContain('每天广告总上限')
    expect(wired.calls).toEqual([])
  })

  it('没有每天上限时减预算仍可确认执行', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture(null, 'decrease')
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ direction: 'decrease', afterCents: 2400 })], wired)
    expect(row.issued).toBe(true)
    const done = await confirm(f, await shown(f, row.runId ?? ''), box, wired)
    expect(done.status).toBe('executed')
    expect(wired.calls).toEqual([expect.objectContaining({ raising: false })])
  })

  it('方向对不上、组号不是数字、或不止一处，都不出卡', async () => {
    const wired = ports({ current: live() })
    const f = fixture()
    const clash = await issueTuesdayBudgetTunes(f.kernel, [proposal(), proposal({ direction: 'decrease', afterCents: 2400, adsetId: '222' })], wired)
    expect(clash.every((row) => row.issued === false)).toBe(true)
    const [badDirection] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ afterCents: 1000 })], wired)
    const [badId] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ adsetId: 'adset-a' })], wired)
    expect(badDirection?.issued).toBe(false)
    expect(badId?.reason).toContain('哪一组')
    expect(wired.calls).toEqual([])
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('卡面不带账户号，当天 23:59 前仍可确认，过了就不改', async () => {
    const secret = '123456789012345'
    const box = { current: live({ name: secret }) }
    const wired = ports(box)
    const f = fixture(50000, 'decrease')
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ direction: 'decrease', afterCents: 2400, name: secret })], wired)
    const card = await shown(f, row.runId ?? '')
    const face = `${card.what} ${card.account} ${card.amount} ${card.scope}`
    expect(face).not.toContain(secret)
    expect(face).not.toContain('act_')
    expect(card.expiresLabel).toContain('23:59')
    const run = (f.tables.action_runs as Array<{ id?: string; input?: { lifetime?: string } }>).find((item) => item.id === row.runId)
    expect(run?.input?.lifetime).toBe('nz_day')
    expect((await confirm(f, card, box, wired, new Date('2026-11-02T00:31:00.000Z'))).status).toBe('executed')
    const [again] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ direction: 'decrease', afterCents: 2400, subjectKey: 'wk2' })], wired)
    const lateCard = await shown(f, again?.runId ?? '')
    const late = await confirm(f, lateCard, box, wired, new Date('2026-11-02T11:00:00.000Z'))
    expect(late.status).toBe('blocked')
    expect(late.wroteMeta).toBe(false)
    const later = await listConfirmationCards(f.kernel, CLIENT_A, OPC, new Date('2026-11-02T11:00:00.000Z'))
    expect(later.find((item) => item.runId === lateCard.runId)?.status).toBe('expired')
  })

  it('没有现成金额就不出卡，出卡代码也不另开改预算入口', async () => {
    const open = () => { throw new Error('不该打开执行') }
    const summary = { considered: 1, checked: 1, outcomes: [] }
    expect(await runTuesdayBudgetTune(open, summary)).toEqual([])
    expect(planTuesdayBudgetTunes(summary)).toEqual([])
    const root = join(__dirname, '../../..')
    for (const file of ['src/lib/diagnostic/tuesday-budget-tune.ts', 'src/lib/diagnostic/tuesday-budget-execute.ts', 'src/app/api/cron/prescription-weekly/route.ts']) {
      const src = readFileSync(join(root, file), 'utf8')
      for (const banned of ['scale_unit_budget', 'cut_unit_budget', 'cut_campaign_budget', 'getMetaToken', 'setAdSetDailyBudget', 'setCampaignDailyBudget', 'ME_SERVICE_PAUSE', '@/lib/meta']) {
        expect(src).not.toContain(banned)
      }
    }
    const writer = readFileSync(join(root, 'src/lib/action-submission/ads-budget-card.ts'), 'utf8')
    expect(writer).toContain('requireHumanApproval: true')
    expect(writer).toContain('call.raising')
    expect(readFileSync(join(root, 'src/lib/confirmation-card/issue.ts'), 'utf8')).toContain("args.lifetime ?? 'urgent_30m'")
    expect(readFileSync(join(root, 'src/lib/ads-budget-card/flow.ts'), 'utf8')).not.toContain("lifetime: 'nz_day'")
    expect(readFileSync(join(root, 'src/lib/diagnostic/tuesday-budget-execute.ts'), 'utf8')).toContain("lifetime: 'nz_day'")
  })
})
