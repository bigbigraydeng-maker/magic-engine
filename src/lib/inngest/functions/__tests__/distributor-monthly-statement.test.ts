import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))

import {
  DISTRIBUTOR_STATEMENT_CRON, DISTRIBUTOR_STATEMENT_EVENT, DISTRIBUTOR_STATEMENT_FUNCTION_ID, DISTRIBUTOR_STATEMENT_JOB,
  DISTRIBUTOR_STATEMENT_SCHEDULE, createDistributorStatementFunction, type StatementDeps, type StatementReceipt,
} from '../distributor-monthly-statement'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'

type Fn = ReturnType<typeof createDistributorStatementFunction>
const opts = (fn: Fn) => Reflect.get(fn, 'opts') as { id?: string; triggers?: { cron?: string; event?: string }[]; retries?: number; concurrency?: { limit?: number } }
const step = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })
/** Runs the registered handler the way Inngest would, with a pass-through step. */
const handleStatement = (d: StatementDeps, event: { name: string; data: unknown }, s: ReturnType<typeof step>) =>
  (Reflect.get(createDistributorStatementFunction(d), 'fn') as (a: { event: unknown; step: unknown }) => Promise<StatementReceipt>)({ event, step: s })

function deps(over: Partial<StatementDeps> = {}): StatementDeps {
  return {
    now: () => new Date('2026-11-30T20:00:00Z'), // 2026-12-01 09:00 NZDT
    tablesReady: vi.fn(async () => true),
    compute: vi.fn(async (month: string, dryRun: boolean) => ({ month, dryRun, statementId: dryRun ? null : 'st-1', totalPayableCents: 123, salesSettled: 4, lines: 9, distributorsPaid: 2 })),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    ...over,
  }
}

describe('distributor monthly statement function', () => {
  it('is registered: monthly cron + event, never retries, one at a time, in the cron registry', () => {
    const o = opts(createDistributorStatementFunction(deps()))
    expect(o.id).toBe(`${CLOUD_FN_PREFIX}distributor-monthly-statement`)
    expect(o.id).toBe(DISTRIBUTOR_STATEMENT_FUNCTION_ID)
    expect(o.triggers?.[0]?.cron).toBe(DISTRIBUTOR_STATEMENT_CRON)
    expect(DISTRIBUTOR_STATEMENT_CRON).toBe('TZ=Pacific/Auckland 0 9 1 * *')
    expect(o.triggers?.[1]?.event).toBe(DISTRIBUTOR_STATEMENT_EVENT)
    expect(o.retries).toBe(0)
    expect(o.concurrency?.limit).toBe(1)
    expect(CRON_REGISTRY.find((e) => e.jobName === DISTRIBUTOR_STATEMENT_JOB)).toMatchObject({ scheduler: 'inngest', logsRuns: true, schedule: DISTRIBUTOR_STATEMENT_SCHEDULE })
  })

  it('cron computes the previous NZ month for real and writes one receipt that says nobody was paid', async () => {
    const d = deps()
    const out = await handleStatement(d, { name: 'inngest/scheduled.timer', data: {} }, step())
    expect(d.compute).toHaveBeenCalledWith('2026-11', false)
    expect(out).toMatchObject({ trigger: 'cron', month: '2026-11', status: 'computed', statement_id: 'st-1', total_payable_cents: 123, no_payout: true })
    expect(vi.mocked(d.finishRun).mock.calls[0][0]).toMatchObject({ processed: 4, failed: 0, summary: { status: 'computed', no_payout: true } })
  })

  it('event with dry_run computes the given month without saving', async () => {
    const d = deps()
    const out = await handleStatement(d, { name: DISTRIBUTOR_STATEMENT_EVENT, data: { month: '2026-10', dry_run: true } }, step())
    expect(d.compute).toHaveBeenCalledWith('2026-10', true)
    expect(out).toMatchObject({ trigger: 'event', status: 'dry_run', statement_id: null, dry_run: true })
  })

  it('skips quietly while the tables are not applied, and when the month already has a statement', async () => {
    const missing = deps({ tablesReady: vi.fn(async () => false) })
    expect(await handleStatement(missing, { name: 'x', data: {} }, step())).toMatchObject({ status: 'skipped_tables_missing' })
    expect(missing.compute).not.toHaveBeenCalled()
    const exists = deps({ compute: vi.fn(async () => { throw new Error('a statement for 2026-11 already exists; void it first') }) })
    const out = await handleStatement(exists, { name: 'x', data: {} }, step())
    expect(out.status).toBe('skipped_exists')
    expect(vi.mocked(exists.finishRun).mock.calls[0][0].failed).toBe(0)
  })

  it('records a failure instead of throwing when computing or reading the tables breaks', async () => {
    const broken = deps({ tablesReady: vi.fn(async () => { throw new Error('db down') }) })
    const out = await handleStatement(broken, { name: 'x', data: {} }, step())
    expect(out).toMatchObject({ status: 'failed', error: 'db down', no_payout: true })
    expect(vi.mocked(broken.finishRun).mock.calls[0][0]).toMatchObject({ failed: 1 })
  })
})
