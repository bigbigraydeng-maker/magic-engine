/**
 * Confirming a Tuesday budget card runs the existing budget-card path.
 * Issuing the card does not. Guards and the second nod for a raise stay.
 */
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
import type { WeeklyBudgetSuggestion, WeeklyCheckSummary } from './prescription-weekly-check'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const PRESCRIPTION = 'a1110000-0000-4000-8000-000000000001'

const lock: PrescriptionLock = {
  prescriptionId: PRESCRIPTION,
  version: 2,
  goalId: GOAL_A,
  planId: 'plan-1',
  planHash: 'hash-1',
  approvedOn: '2026-11-02',
}

function proposal(over: Partial<WeeklyBudgetSuggestion> = {}): WeeklyBudgetSuggestion {
  return {
    clientId: CLIENT_A,
    subjectKey: 'wkignored',
    direction: 'increase',
    accountLabel: '在投日预算',
    beforeCents: 3000,
    afterCents: 3600,
    currencyLabel: '纽元',
    why: '连续多天点击好于账户中位，预算却偏低。',
    dateLabel: '这周二',
    scopeLabel: '只改这一次日预算',
    adsetId: '111',
    adAccountId: 'act_111111',
    prescriptionId: PRESCRIPTION,
    name: '春季组',
    ...over,
  }
}

function live(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    registeredAccountIds: ['act_111111'],
    accountId: '111111',
    adsetId: '111',
    status: 'ACTIVE',
    currentCents: 3000,
    name: '春季组',
    accountCapCents: 20000,
    accountLiveCents: 3000,
    countedInLive: true,
    otherAccountsLiveCents: 0,
    clientCapCents: 50000,
    lifetimeBlocks: false,
    stepRatio: 0.2,
    ...over,
  }
}

function planRow(cents: number | null) {
  const promo: Record<string, unknown> = {
    schema: 'promo_v1',
    goal_id: GOAL_A,
    phases: [{ id: 'p1', name: '阶段', start_date: '2026-11-01', end_date: '2026-11-30', steps: [] }],
    checks: [],
  }
  if (cents !== null) promo.daily_total_cap_cents = cents
  return { id: 'plan-1', client_id: CLIENT_A, status: 'approved', plan_data: { promo } }
}

function patrol(direction: 'increase' | 'decrease') {
  const dates = direction === 'increase'
    ? ['2026-11-02', '2026-11-01', '2026-10-31']
    : ['2026-11-02', '2026-11-01']
  const finding = {
    code: direction === 'increase' ? 'O1' : 'D3',
    status: 'hit',
    title: '',
    units: [{ level: 'adset', id: '111', name: null }],
  }
  return dates.map((date) => ({
    client_id: CLIENT_A,
    date,
    data_completeness: 'complete',
    payload: direction === 'increase'
      ? { opportunities: [finding], problems: [] }
      : { problems: [finding], opportunities: [] },
  }))
}

function fixture(planCap: number | null = 50000, direction: 'increase' | 'decrease' = 'increase') {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: '2026-11-02T00:00:00.000Z',
    options: {
      extraTables: {
        marketing_plans: [planRow(planCap)],
        ads_growth_states: patrol(direction),
      },
    },
  })
}

function ports(box: { current: BudgetSnapshot }): TuesdayPorts & { calls: BudgetExecuteCall[]; path: BudgetPath } {
  const calls: BudgetExecuteCall[] = []
  const locks: VersionLockSource = { read: async () => ({ ok: true, lock }) }
  const path: BudgetPath = {
    execute: async (call) => {
      calls.push(call)
      const awaiting = call.raising
      const result: BudgetExecuteResult = awaiting
        ? { kind: 'awaiting', wrote: false, readbackCents: null, actionRunId: 'run-1', reason: '加预算还要花钱的人再点一次。' }
        : { kind: 'executed', wrote: true, readbackCents: call.afterCents, actionRunId: 'run-1', reason: '已改好，回读的日预算和要改的一致。' }
      return result
    },
  }
  return {
    locks,
    calls,
    path,
    readLive: async () => box.current,
  }
}

function runtime(box: { current: BudgetSnapshot }): BudgetRuntime {
  return { read: async (_order: BudgetOrder) => box.current }
}

describe('周二加减预算确认后走原来的改预算卡', () => {
  it('出卡不改预算，人确认之后减预算才执行一次', async () => {
    const box = { current: live({ name: '春季组' }) }
    const wired = ports(box)
    const f = fixture(50000, 'decrease')
    const cut = proposal({ direction: 'decrease', afterCents: 2400, why: '巡检连续看到花钱没有对上结果。' })
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [cut], wired)
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    expect(wired.calls).toEqual([])
    const shown = await shownCard(f, row.runId ?? '')
    expect(shown.what.startsWith('把广告组 ')).toBe(true)
    expect(shown.confirmEnabled).toBe(true)
    expect(pausedDraftClickUrl(CLIENT_A, shown.runId, shown.what)).toContain('/meta-ads/budget-cards/')
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: shown.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: shown.expectedDecisionId,
      fingerprint: shown.fingerprint,
      runtime: runtime(box),
      locks: wired.locks,
      path: wired.path,
    })
    expect(done.status).toBe('executed')
    expect(wired.calls).toHaveLength(1)
    expect(wired.calls[0]?.raising).toBe(false)
    expect(wired.calls[0]?.afterCents).toBe(2400)
  })

  it('加预算的第一次确认不写，仍要第二次点头', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    const shown = await shownCard(f, row.runId ?? '')
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: shown.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: shown.expectedDecisionId,
      fingerprint: shown.fingerprint,
      runtime: runtime(box),
      locks: wired.locks,
      path: wired.path,
    })
    expect(done.status).toBe('awaiting')
    expect(done.wroteMeta).toBe(false)
    expect(wired.calls).toHaveLength(1)
    expect(wired.calls[0]?.raising).toBe(true)
    expect(wired.calls[0]?.afterCents).toBe(3600)
  })

  it('代理人能出卡，不能确认', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    await expect(submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: row.runId ?? '',
      clicker: AGENT,
      resolution: 'confirm',
      expectedDecisionId: 'x',
      fingerprint: row.fingerprint ?? '',
      runtime: runtime(box),
      locks: wired.locks,
      path: wired.path,
    })).rejects.toThrow(/不能点/)
    expect(wired.calls).toEqual([])
  })

  it('巡检条件不再成立时确认不改', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    const shown = await shownCard(f, row.runId ?? '')
    f.tables.ads_growth_states.splice(0, f.tables.ads_growth_states.length)
    const done = await submitBudgetCard(submitOf(f, shown, box, wired))
    expect(done.status).toBe('blocked')
    expect(done.reason).toContain('不成立')
    expect(wired.calls).toEqual([])
  })

  it('确认时现预算变了就不改', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    const shown = await shownCard(f, row.runId ?? '')
    box.current = live({ currentCents: 2800 })
    const done = await submitBudgetCard(submitOf(f, shown, box, wired))
    expect(done.status).toBe('blocked')
    expect(done.reason).toContain('现预算')
    expect(wired.calls).toEqual([])
  })

  it('计划里没有每天上限时，加预算确认不改', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture(50000, 'increase')
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal()], wired)
    const shown = await shownCard(f, row.runId ?? '')
    const plan = f.tables.marketing_plans[0]
    plan.plan_data = { promo: { schema: 'promo_v1', goal_id: GOAL_A, phases: [], checks: [] } }
    const done = await submitBudgetCard(submitOf(f, shown, box, wired))
    expect(done.status).toBe('blocked')
    expect(done.reason).toContain('每天广告总上限')
    expect(wired.calls).toEqual([])
  })

  it('没有每天上限时减预算仍可确认执行', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture(null, 'decrease')
    const cut = proposal({ direction: 'decrease', afterCents: 2400 })
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [cut], wired)
    expect(row.issued).toBe(true)
    const shown = await shownCard(f, row.runId ?? '')
    const done = await submitBudgetCard(submitOf(f, shown, box, wired))
    expect(done.status).toBe('executed')
    expect(wired.calls).toHaveLength(1)
    expect(wired.calls[0]?.raising).toBe(false)
  })

  it('方向对不上、组号不是数字、或不止一处，都不出卡', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture()
    const clash = await issueTuesdayBudgetTunes(f.kernel, [
      proposal(),
      proposal({ direction: 'decrease', afterCents: 2400, adsetId: '222' }),
    ], wired)
    expect(clash.every((row) => row.issued === false && row.executed === false)).toBe(true)
    const [badDirection] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ afterCents: 1000 })], wired)
    expect(badDirection.issued).toBe(false)
    const [badId] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ adsetId: 'adset-a' })], wired)
    expect(badId.issued).toBe(false)
    expect(badId.reason).toContain('哪一组')
    expect(wired.calls).toEqual([])
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('卡面上没有账户号，过期到当天新西兰 23:59', async () => {
    const secret = '123456789012345'
    const box = { current: live({ name: secret }) }
    const wired = ports(box)
    const f = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [proposal({ name: secret })], wired)
    const shown = await shownCard(f, row.runId ?? '')
    const face = `${shown.what} ${shown.account} ${shown.amount} ${shown.scope}`
    expect(face).not.toContain(secret)
    expect(face).not.toContain('act_')
    expect(face.startsWith('把广告组 ')).toBe(true)
    expect(shown.expiresLabel).toContain('23:59')
    expect(cardLifetime(f, row.runId ?? '')).toBe('nz_day')
  })

  it('过了 30 分钟、当天 23:59 之前确认仍会执行', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture(50000, 'decrease')
    const cut = proposal({ direction: 'decrease', afterCents: 2400 })
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [cut], wired)
    const shown = await shownCard(f, row.runId ?? '')
    const done = await submitBudgetCard({
      ...submitOf(f, shown, box, wired),
      now: new Date('2026-11-02T00:31:00.000Z'),
    })
    expect(done.status).toBe('executed')
    expect(wired.calls).toHaveLength(1)
  })

  it('过了当天新西兰 23:59 再确认，不改预算', async () => {
    const box = { current: live() }
    const wired = ports(box)
    const f = fixture(50000, 'decrease')
    const cut = proposal({ direction: 'decrease', afterCents: 2400 })
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [cut], wired)
    const shown = await shownCard(f, row.runId ?? '')
    const done = await submitBudgetCard({
      ...submitOf(f, shown, box, wired),
      now: new Date('2026-11-02T11:00:00.000Z'),
    })
    expect(done.wroteMeta).toBe(false)
    expect(done.status).toBe('blocked')
    expect(wired.calls).toEqual([])
    const later = await listConfirmationCards(f.kernel, CLIENT_A, OPC, new Date('2026-11-02T11:00:00.000Z'))
    expect(later.find((card) => card.runId === shown.runId)?.status).toBe('expired')
  })

  it('这周没有现成金额时不出卡，也不去准备执行', async () => {
    const open = () => {
      throw new Error('不该打开执行')
    }
    const summary: WeeklyCheckSummary = { considered: 1, checked: 1, outcomes: [] }
    const rows = await runTuesdayBudgetTune(open, summary)
    expect(planTuesdayBudgetTunes(summary)).toEqual([])
    expect(rows).toEqual([])
  })

  it('出卡代码和定时入口里没有另一条改预算的入口', () => {
    const root = join(__dirname, '../../..')
    const files = [
      'src/lib/diagnostic/tuesday-budget-tune.ts',
      'src/lib/diagnostic/tuesday-budget-execute.ts',
      'src/lib/diagnostic/tuesday-budget-live.ts',
      'src/app/api/cron/prescription-weekly/route.ts',
    ]
    for (const file of files) {
      const src = readFileSync(join(root, file), 'utf8')
      expect(src).not.toContain('scale_unit_budget')
      expect(src).not.toContain('cut_unit_budget')
      expect(src).not.toContain('cut_campaign_budget')
      expect(src).not.toContain('getMetaToken')
      expect(src).not.toContain('setAdSetDailyBudget')
      expect(src).not.toContain('setCampaignDailyBudget')
      expect(src).not.toContain('ME_SERVICE_PAUSE')
      expect(src).not.toContain("@/lib/meta")
    }
    const writer = readFileSync(join(root, 'src/lib/action-submission/ads-budget-card.ts'), 'utf8')
    expect(writer).toContain('requireHumanApproval: true')
    expect(writer).toContain('call.raising')
    const issue = readFileSync(join(root, 'src/lib/confirmation-card/issue.ts'), 'utf8')
    expect(issue).toContain("args.lifetime ?? 'urgent_30m'")
    const budgetFlow = readFileSync(join(root, 'src/lib/ads-budget-card/flow.ts'), 'utf8')
    expect(budgetFlow).not.toContain("lifetime: 'nz_day'")
    const tuesday = readFileSync(join(root, 'src/lib/diagnostic/tuesday-budget-execute.ts'), 'utf8')
    expect(tuesday).toContain("lifetime: 'nz_day'")
  })
})

function submitOf(
  f: ReturnType<typeof fixture>,
  shown: { runId: string; expectedDecisionId: string; fingerprint: string },
  box: { current: BudgetSnapshot },
  wired: TuesdayPorts & { path: BudgetPath },
) {
  return {
    kernel: f.kernel,
    clientId: CLIENT_A,
    runId: shown.runId,
    clicker: OPC,
    resolution: 'confirm' as const,
    expectedDecisionId: shown.expectedDecisionId,
    fingerprint: shown.fingerprint,
    runtime: runtime(box),
    locks: wired.locks,
    path: wired.path,
  }
}

function cardLifetime(f: ReturnType<typeof fixture>, runId: string): string | null {
  const run = (f.tables.action_runs as Array<{ id?: string; input?: { lifetime?: string } }>)
    .find((row) => row.id === runId)
  return run?.input?.lifetime ?? null
}

async function shownCard(f: ReturnType<typeof fixture>, runId: string) {
  const cards = await listConfirmationCards(f.kernel, CLIENT_A, OPC)
  const card = cards.find((row) => row.runId === runId)
  if (!card) throw new Error('确认卡没有列出来')
  return card
}
