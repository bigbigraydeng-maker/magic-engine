/**
 * rolloverMonthlyGoals — monthly recurring goals must never leave a gap.
 *
 * The ads autonomy engine reads listActiveGoals() every day. If a monthly
 * commitment expires and no successor is created, the engine loses its target
 * reference and starts making bad budget calls. This suite locks the four
 * invariants we care about:
 *   1. When today crosses a monthly recurring goal's period_end, the next
 *      natural month's goal exists — same targets, cleared current_value.
 *   2. Running the cron twice never double-creates (idempotency).
 *   3. Only recurrence='monthly' goals roll over. Everything else is ignored.
 *   4. Month boundaries (Dec→Jan year turn, non-leap Feb, leap Feb) are correct.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nextLiveMonth, nextNaturalMonth, rolloverMonthlyGoals } from '../goal-rollover'
import type { GoalRow } from '@/types/strategy'

// ── nextNaturalMonth pure-function tests ─────────────────────────────────────

describe('nextNaturalMonth', () => {
  it('normal month → next month', () => {
    expect(nextNaturalMonth('2026-09-30')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
  })

  it('December → January of next year', () => {
    expect(nextNaturalMonth('2026-12-31')).toEqual({ start: '2027-01-01', end: '2027-01-31' })
  })

  it('January in non-leap year → February with 28 days', () => {
    expect(nextNaturalMonth('2027-01-31')).toEqual({ start: '2027-02-01', end: '2027-02-28' })
  })

  it('January in leap year → February with 29 days', () => {
    expect(nextNaturalMonth('2028-01-31')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })

  it('30-day month → next month starts on 1st regardless of day', () => {
    expect(nextNaturalMonth('2026-04-30')).toEqual({ start: '2026-05-01', end: '2026-05-31' })
  })

  it('invalid ISO date throws', () => {
    expect(() => nextNaturalMonth('not-a-date')).toThrow(/invalid ISO date/)
  })
})

// ── rolloverMonthlyGoals with fake Supabase ─────────────────────────────────

/** Minimal GoalRow builder — defaults tuned for the NAL Sept case. */
function makeGoal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: overrides.id ?? 'goal-nal-sept',
    client_id: overrides.client_id ?? 'client-nal',
    intent: overrides.intent ?? 'acquisition',
    awareness_subtype: overrides.awareness_subtype ?? null,
    sub_type: overrides.sub_type ?? 'ongoing',
    title: overrides.title ?? 'NAL 月度获客',
    primary_metric_key: overrides.primary_metric_key ?? 'messaging_started',
    primary_metric_label: overrides.primary_metric_label ?? '私信/WhatsApp 对话开启数',
    primary_metric_unit: overrides.primary_metric_unit ?? 'count/mo',
    baseline_value: overrides.baseline_value ?? 0,
    target_value: overrides.target_value ?? 300,
    target_direction: overrides.target_direction ?? 'increase',
    supporting_metrics: overrides.supporting_metrics ?? [],
    period_start: overrides.period_start ?? '2026-09-01',
    period_end: overrides.period_end ?? '2026-09-30',
    budget_amount: overrides.budget_amount ?? null,
    budget_currency: overrides.budget_currency ?? 'AUD',
    status: overrides.status ?? 'expired',
    verdict: overrides.verdict ?? null,
    verdict_at: overrides.verdict_at ?? null,
    verdict_summary: overrides.verdict_summary ?? null,
    // Distinguish "not passed" (default to 'monthly') from "explicitly null"
    // (one-shot goal — nullish coalescing would wrongly override to 'monthly').
    recurrence: overrides.recurrence === undefined ? 'monthly' : overrides.recurrence,
    fde_reasoning: overrides.fde_reasoning ?? null,
    is_beta: overrides.is_beta ?? true,
    current_value: overrides.current_value ?? 213,
    current_value_fetched_at: overrides.current_value_fetched_at ?? '2026-09-27T03:00:00Z',
    current_value_source: overrides.current_value_source ?? 'auto.cron',
    created_at: overrides.created_at ?? '2026-09-25T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-09-27T03:00:00Z',
    created_by: overrides.created_by ?? null,
  }
}

interface Filter {
  col: string
  op: 'eq' | 'lt' | 'gt' | 'in'
  val: unknown
}

/**
 * Stateful fake — models the goals table as a row array. Every select filter
 * is captured then applied to the current row set. Inserts append; the
 * partial-unique-index behaviour is emulated on (client_id,
 * primary_metric_key, period_start) WHERE recurrence='monthly'.
 *
 * `simulateRaceInsert` — before the first real insert, an extra row is
 * appended behind the caller's back to force the DB code path where the
 * unique index catches a race. We surface it as a Postgres 23505 error.
 *
 * 实测：下面 12 个测试穷举了 rollover 依赖的 6 类 supabase 调用
 * (select/eq/lt/in/limit/insert)。每次测试对着这个 fake 跑，通过=fake 形状与
 * 真实 SupabaseClient 一致；一致性也被 tsc 在 fake 返回类型与 rolloverMonthlyGoals
 * 使用点的比对上锁住。
 */
function fakeSupabase(initial: GoalRow[], opts: { simulateRaceInsert?: boolean; archivedClients?: string[]; clientsError?: boolean } = {}) {
  const rows: GoalRow[] = initial.map(g => ({ ...g }))
  const insertLog: Array<Partial<GoalRow>> = []
  let insertsSeen = 0

  function makeSelect(_table: string) {
    const filters: Filter[] = []
    let limitN: number | null = null

    const chain: {
      select: () => typeof chain
      eq: (col: string, val: unknown) => typeof chain
      lt: (col: string, val: unknown) => typeof chain
      gt: (col: string, val: unknown) => typeof chain
      in: (col: string, val: unknown[]) => typeof chain
      limit: (n: number) => Promise<{ data: GoalRow[]; error: null }>
      then: (
        resolve: (r: { data: GoalRow[]; error: null }) => void,
        reject?: (e: unknown) => void,
      ) => Promise<void>
    } = {
      select: () => chain,
      eq: (col, val) => { filters.push({ col, op: 'eq', val }); return chain },
      lt: (col, val) => { filters.push({ col, op: 'lt', val }); return chain },
      gt: (col, val) => { filters.push({ col, op: 'gt', val }); return chain },
      in: (col, val) => { filters.push({ col, op: 'in', val }); return chain },
      limit: (n) => { limitN = n; return execute() },
      then: (resolve, reject) => execute().then(resolve, reject),
    }

    function execute(): Promise<{ data: GoalRow[]; error: null }> {
      let matched: GoalRow[] = rows.filter(row => filters.every(f => {
        const v = (row as unknown as Record<string, unknown>)[f.col]
        switch (f.op) {
          case 'eq': return v === f.val
          case 'lt': return typeof v === 'string' && typeof f.val === 'string' && v < f.val
          case 'gt': return typeof v === 'string' && typeof f.val === 'string' && v > f.val
          case 'in': return Array.isArray(f.val) && (f.val as unknown[]).includes(v)
        }
      }))
      if (limitN !== null) matched = matched.slice(0, limitN)
      return Promise.resolve({ data: matched, error: null })
    }

    return chain
  }

  function makeInsert(payload: Partial<GoalRow>) {
    insertsSeen += 1

    if (opts.simulateRaceInsert && insertsSeen === 1) {
      const raceRow: GoalRow = makeGoal({ ...payload, id: 'goal-race-winner' })
      rows.push(raceRow)
    }

    // Emulate partial-unique-index (client_id, primary_metric_key, period_start)
    // WHERE recurrence='monthly'.
    if (payload.recurrence === 'monthly') {
      const dup = rows.find(r =>
        r.recurrence === 'monthly'
        && r.client_id === payload.client_id
        && r.primary_metric_key === payload.primary_metric_key
        && r.period_start === payload.period_start,
      )
      if (dup) {
        return Promise.resolve({
          data: null,
          error: { code: '23505', message: 'duplicate key violates uniq_goals_monthly_per_client_metric_month' },
        })
      }
    }

    insertLog.push(payload)
    const newRow = makeGoal({ ...payload, id: `inserted-${insertLog.length}` })
    rows.push(newRow)
    return Promise.resolve({ data: newRow, error: null })
  }

  const client = {
    from: (table: string) => ({
      select: () => table === 'clients'
        ? { in: async (_c: string, ids: string[]) => opts.clientsError
            ? { data: null, error: { message: 'clients down' } }
            : { data: ids.map(id => ({ id, client_status: opts.archivedClients?.includes(id) ? 'archived' : 'active' })), error: null } }
        : makeSelect(table).select(),
      insert: (payload: Partial<GoalRow>) => makeInsert(payload),
    }),
  }
  return { client: client as unknown as SupabaseClient, rows, insertLog }
}

describe('rolloverMonthlyGoals — the NAL Sept → Oct case', () => {
  it('creates October successor with reset values when Sept goal is expired', async () => {
    const septGoal = makeGoal({ id: 'goal-nal-sept-1', status: 'expired' })
    const { client, rows, insertLog } = fakeSupabase([septGoal])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-01' })

    expect(result.error).toBeUndefined()
    expect(result.rolled).toHaveLength(1)
    expect(result.rolled[0]).toMatchObject({
      source_goal_id: 'goal-nal-sept-1',
      next_period_start: '2026-10-01',
      next_period_end: '2026-10-31',
    })
    expect(insertLog).toHaveLength(1)
    expect(insertLog[0]).toMatchObject({
      client_id: 'client-nal',
      primary_metric_key: 'messaging_started',
      target_value: 300,
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      status: 'active',
      recurrence: 'monthly',
      sub_type: 'ongoing',
    })
    // The new row must NOT carry over current_value or verdict fields.
    expect(insertLog[0].current_value).toBeUndefined()
    expect(insertLog[0].verdict).toBeUndefined()
    expect(rows.length).toBe(2) // original + new
  })
})

describe('rolloverMonthlyGoals — idempotency', () => {
  it('skips when the successor already exists', async () => {
    const septGoal = makeGoal({ id: 'sept', status: 'expired' })
    const octGoal = makeGoal({
      id: 'oct',
      status: 'active',
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      current_value: 0,
    })
    const { client, insertLog } = fakeSupabase([septGoal, octGoal])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-01' })

    expect(result.error).toBeUndefined()
    expect(result.rolled).toHaveLength(0)
    expect(result.skipped_existing).toHaveLength(1)
    expect(insertLog).toHaveLength(0)
  })

  it('two consecutive runs produce exactly one successor', async () => {
    const septGoal = makeGoal({ id: 'sept', status: 'expired' })
    const { client, insertLog } = fakeSupabase([septGoal])

    const r1 = await rolloverMonthlyGoals(client, { today: '2026-10-01' })
    const r2 = await rolloverMonthlyGoals(client, { today: '2026-10-01' })

    expect(r1.rolled).toHaveLength(1)
    expect(r2.rolled).toHaveLength(0)
    expect(r2.skipped_existing).toHaveLength(1)
    expect(insertLog).toHaveLength(1)
  })

  it('DB unique-violation on race is treated as skipped, not error', async () => {
    const septGoal = makeGoal({ id: 'sept', status: 'expired' })
    // Race: pre-check finds no successor, then another process inserts one,
    // then our insert hits the unique index (Postgres 23505).
    const { client, insertLog } = fakeSupabase([septGoal], { simulateRaceInsert: true })

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-01' })

    expect(result.error).toBeUndefined()
    expect(result.rolled).toHaveLength(0)
    expect(result.skipped_existing).toHaveLength(1)
    expect(insertLog).toHaveLength(0)
  })
})

describe('rolloverMonthlyGoals — scope', () => {
  it('ignores goals whose recurrence is null (one-shot event goals)', async () => {
    const oneShot = makeGoal({
      id: 'event',
      status: 'expired',
      recurrence: null,
      title: 'CTS 春节团报名',
    })
    const { client, insertLog } = fakeSupabase([oneShot])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-01' })

    expect(result.rolled).toHaveLength(0)
    expect(result.skipped_existing).toHaveLength(0)
    expect(result.planned).toHaveLength(0)
    expect(insertLog).toHaveLength(0)
  })

  it('ignores active goals whose period has not ended yet', async () => {
    const activeInCurrent = makeGoal({
      id: 'oct-live',
      status: 'active',
      period_start: '2026-10-01',
      period_end: '2026-10-31',
    })
    const { client, insertLog } = fakeSupabase([activeInCurrent])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-15' })

    expect(result.rolled).toHaveLength(0)
    expect(insertLog).toHaveLength(0)
  })

  it('still rolls over an archived (verdict written) monthly goal if successor missing', async () => {
    const archivedGoal = makeGoal({
      id: 'sept-done',
      status: 'archived',
      verdict: 'partial',
      verdict_at: '2026-10-02T00:00:00Z',
    })
    const { client, insertLog } = fakeSupabase([archivedGoal])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-03' })

    expect(result.rolled).toHaveLength(1)
    expect(insertLog[0]?.status).toBe('active')
    expect(insertLog[0]?.verdict).toBeUndefined()
  })
})

describe('rolloverMonthlyGoals — dry_run', () => {
  it('returns the plan without writing anything', async () => {
    const septGoal = makeGoal({ id: 'sept', status: 'expired' })
    const { client, insertLog, rows } = fakeSupabase([septGoal])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-01', dryRun: true })

    expect(result.planned).toHaveLength(1)
    expect(result.planned[0].next_period_start).toBe('2026-10-01')
    expect(result.rolled).toHaveLength(0)
    expect(insertLog).toHaveLength(0)
    expect(rows).toHaveLength(1) // untouched
  })
})

describe('rolloverMonthlyGoals — month boundaries', () => {
  it('December goal rolls into January of the next year', async () => {
    const decGoal = makeGoal({
      id: 'dec',
      status: 'expired',
      period_start: '2026-12-01',
      period_end: '2026-12-31',
    })
    const { client, insertLog } = fakeSupabase([decGoal])

    await rolloverMonthlyGoals(client, { today: '2027-01-01' })

    expect(insertLog[0]).toMatchObject({
      period_start: '2027-01-01',
      period_end: '2027-01-31',
    })
  })

  it('January of non-leap year rolls into 28-day February', async () => {
    const janGoal = makeGoal({
      id: 'jan',
      status: 'expired',
      period_start: '2027-01-01',
      period_end: '2027-01-31',
    })
    const { client, insertLog } = fakeSupabase([janGoal])

    await rolloverMonthlyGoals(client, { today: '2027-02-01' })

    expect(insertLog[0]).toMatchObject({
      period_start: '2027-02-01',
      period_end: '2027-02-28',
    })
  })

  it('January of leap year rolls into 29-day February', async () => {
    const janGoal = makeGoal({
      id: 'jan-leap',
      status: 'expired',
      period_start: '2028-01-01',
      period_end: '2028-01-31',
    })
    const { client, insertLog } = fakeSupabase([janGoal])

    await rolloverMonthlyGoals(client, { today: '2028-02-01' })

    expect(insertLog[0]).toMatchObject({
      period_start: '2028-02-01',
      period_end: '2028-02-29',
    })
  })
})

describe('nextLiveMonth — never back-fill months that are already over', () => {
  it('on time → same as nextNaturalMonth, nothing skipped', () => {
    expect(nextLiveMonth('2026-09-30', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-31', skippedMonths: 0 })
  })

  it('10 days late is still inside October → October', () => {
    expect(nextLiveMonth('2026-09-30', '2026-10-10')).toMatchObject({ start: '2026-10-01', skippedMonths: 0 })
  })

  it('cron missed all of October → jumps to November, reports 1 skipped month', () => {
    expect(nextLiveMonth('2026-09-30', '2026-11-03')).toEqual({ start: '2026-11-01', end: '2026-11-30', skippedMonths: 1 })
  })

  it('source period ends in the future → still the month after it', () => {
    expect(nextLiveMonth('2026-12-31', '2026-10-01')).toMatchObject({ start: '2027-01-01', skippedMonths: 0 })
  })
})

describe('rolloverMonthlyGoals — PM-visible and never inflated', () => {
  it('copies target_value verbatim and says so in fde_reasoning', async () => {
    const sept = makeGoal({ id: 'sept', status: 'expired', target_value: 300, fde_reasoning: '每月 300 个开聊' })
    const { client, insertLog } = fakeSupabase([sept])

    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })

    expect(insertLog[0].target_value).toBe(300)
    expect(insertLog[0].fde_reasoning).toContain('每月 300 个开聊')
    expect(insertLog[0].fde_reasoning).toContain('目标值沿用上月')
    expect(insertLog[0].fde_reasoning).toContain('sept')
    expect(result.rolled[0].target_value).toBe(300)
  })

  it('10 days into October still creates October (not November) and records no skipped month', async () => {
    const { client, insertLog } = fakeSupabase([makeGoal({ id: 'sept', status: 'expired' })])
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(insertLog[0]).toMatchObject({ period_start: '2026-10-01', period_end: '2026-10-31' })
    expect(result.rolled[0].skipped_past_months).toBe(0)
  })

  it('missed a whole month → only the live month is created, skipped count reported', async () => {
    const { client, insertLog } = fakeSupabase([makeGoal({ id: 'sept', status: 'expired' })])
    const result = await rolloverMonthlyGoals(client, { today: '2026-11-03' })
    expect(insertLog).toHaveLength(1)
    expect(insertLog[0]).toMatchObject({ period_start: '2026-11-01', period_end: '2026-11-30' })
    expect(result.rolled[0].skipped_past_months).toBe(1)
  })

  it('same client + metric + month can never get two rows, however often it runs', async () => {
    const { client, rows } = fakeSupabase([makeGoal({ id: 'sept', status: 'expired' })])
    for (let i = 0; i < 4; i += 1) await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(rows.filter(r => r.period_start === '2026-10-01')).toHaveLength(1)
  })
})

describe('rolloverMonthlyGoals — review fixes', () => {
  it('a hand-made goal (recurrence NULL) already covering the target month blocks the rollover', async () => {
    const sept = makeGoal({ id: 'sept', status: 'expired' })
    const manualOct = makeGoal({ id: 'manual-oct', status: 'active', recurrence: null, period_start: '2026-10-01', period_end: '2026-10-31' })
    const { client, insertLog } = fakeSupabase([sept, manualOct])
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(insertLog).toHaveLength(0)
    expect(result.skipped_existing).toHaveLength(1)
  })

  it('older months of the same chain are not re-planned: only the newest source acts', async () => {
    const aug = makeGoal({ id: 'aug', status: 'archived', period_start: '2026-08-01', period_end: '2026-08-31' })
    const sept = makeGoal({ id: 'sept', status: 'expired' })
    const { client } = fakeSupabase([aug, sept])
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10', dryRun: true })
    expect(result.planned).toHaveLength(1)
    expect(result.planned[0].source_goal_id).toBe('sept')
  })

  it('one client failing does not stop the others (error reported, rest still rolled)', async () => {
    const bad = makeGoal({ id: 'bad', client_id: 'client-bad', status: 'expired', period_end: '2026-09-xx' })
    const good = makeGoal({ id: 'good', client_id: 'client-good', status: 'expired' })
    const { client, insertLog } = fakeSupabase([bad, good])
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(result.error).toContain('goal bad')
    expect(insertLog).toHaveLength(1)
    expect(insertLog[0].client_id).toBe('client-good')
  })

  it('archived (churned) client is skipped — no new goal', async () => {
    const { client, insertLog } = fakeSupabase([makeGoal({ id: 'sept', status: 'expired' })], { archivedClients: ['client-nal'] })
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(insertLog).toHaveLength(0)
    expect(result.planned).toHaveLength(0)
  })

  it('cannot tell whether the client churned (lookup fails) → fail closed, nothing created', async () => {
    const { client, insertLog } = fakeSupabase([makeGoal({ id: 'sept', status: 'expired' })], { clientsError: true })
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(result.error).toContain('clients lookup')
    expect(insertLog).toHaveLength(0)
  })

  it('PM stopped the chain by clearing recurrence on the newest row: older monthly rows do not resurrect it', async () => {
    const aug = makeGoal({ id: 'aug', status: 'archived', period_start: '2026-08-01', period_end: '2026-08-31' })
    const septStopped = makeGoal({ id: 'sept', status: 'expired', recurrence: null })
    const { client, insertLog } = fakeSupabase([aug, septStopped])
    const result = await rolloverMonthlyGoals(client, { today: '2026-10-10' })
    expect(insertLog).toHaveLength(0)
    expect(result.skipped_existing).toHaveLength(1)
  })

  it('dry_run still previews a goal that the real run would flag expired first (status still active)', async () => {
    const stillActive = makeGoal({ id: 'sept', status: 'active' })
    const { client, insertLog } = fakeSupabase([stillActive])
    const dry = await rolloverMonthlyGoals(client, { today: '2026-10-01', dryRun: true })
    expect(dry.planned).toHaveLength(1)
    expect(insertLog).toHaveLength(0)
    const real = await rolloverMonthlyGoals(client, { today: '2026-10-01' })
    expect(real.planned).toHaveLength(0) // real run only sees it after flagExpiredGoals turns it 'expired'
  })
})
