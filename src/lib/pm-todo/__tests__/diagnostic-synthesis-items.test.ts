import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SYNTHESIS_ITEM_LOOKBACK_DAYS,
  extractSynthesisFailures,
  buildDiagnosticSynthesisItems,
  pushDiagnosticSynthesisItems,
} from '../diagnostic-synthesis-items'

function logWith(outcomes: unknown): { summary: unknown } {
  return { summary: { outcomes } }
}

describe('extractSynthesisFailures', () => {
  it('ignores null / non-object summaries and non-array outcomes', () => {
    const logs = [
      { summary: null },
      { summary: 'oops' },
      { summary: { outcomes: 'nope' } },
      { summary: { outcomes: [] } },
    ]
    expect(extractSynthesisFailures(logs)).toEqual([])
  })

  it('skips entries without clientId and receipts with wrong types', () => {
    const logs = [
      logWith([
        { clientName: 'No Id', synthesis: { state: 'failed', failed_modules: [], errors: [], total_cost_usd: 0 } },
        { clientId: 'c1', clientName: 'C1', synthesis: { state: 'failed', failed_modules: 'not-array', errors: [], total_cost_usd: 0 } },
        { clientId: 'c2', clientName: 'C2', synthesis: { state: 42 } },
      ]),
    ]
    const out = extractSynthesisFailures(logs)
    // c1 的 failed_modules 不是数组 -> 收成 []，但 state 合法，仍算失败
    expect(out.map((f) => f.clientId)).toEqual(['c1'])
    expect(out[0].receipt.failed_modules).toEqual([])
  })

  it('newest outcome wins: a newer ok cancels an older failed for the same client', () => {
    const logs = [
      logWith([{ clientId: 'c1', clientName: 'C1', synthesis: { state: 'ok', failed_modules: [], errors: [], total_cost_usd: 0.1 } }]),
      logWith([{ clientId: 'c1', clientName: 'C1', synthesis: { state: 'failed', failed_modules: ['score_explanations'], errors: ['boom'], total_cost_usd: 0.2 } }]),
    ]
    expect(extractSynthesisFailures(logs)).toEqual([])
  })

  it('reports a different client failure even when another client recovered', () => {
    const logs = [
      logWith([
        { clientId: 'c1', clientName: 'C1', synthesis: { state: 'ok', failed_modules: [], errors: [], total_cost_usd: 0 } },
        { clientId: 'c2', clientName: 'C2', synthesis: { state: 'partial', failed_modules: ['competitor_analysis'], errors: [], total_cost_usd: 0.3 } },
      ]),
      logWith([{ clientId: 'c1', clientName: 'C1', synthesis: { state: 'failed', failed_modules: ['score_explanations'], errors: [], total_cost_usd: 0.2 } }]),
    ]
    const out = extractSynthesisFailures(logs)
    expect(out.map((f) => f.clientId)).toEqual(['c2'])
    expect(out[0].receipt.state).toBe('partial')
  })

  it('skipped and ok states produce nothing', () => {
    const logs = [
      logWith([
        { clientId: 'c1', clientName: 'C1', synthesis: { state: 'skipped', failed_modules: [], errors: [], total_cost_usd: 0 } },
        { clientId: 'c2', clientName: 'C2', synthesis: { state: 'ok', failed_modules: [], errors: [], total_cost_usd: 0 } },
      ]),
    ]
    expect(extractSynthesisFailures(logs)).toEqual([])
  })

  it('coerces total_cost_usd to a finite number else 0', () => {
    const logs = [
      logWith([
        { clientId: 'c1', clientName: 'C1', synthesis: { state: 'failed', failed_modules: [], errors: [], total_cost_usd: 'NaN' } },
        { clientId: 'c2', clientName: 'C2', synthesis: { state: 'failed', failed_modules: [], errors: [], total_cost_usd: 0.5 } },
      ]),
    ]
    const out = extractSynthesisFailures(logs)
    expect(out[0].receipt.total_cost_usd).toBe(0)
    expect(out[1].receipt.total_cost_usd).toBe(0.5)
  })
})

describe('buildDiagnosticSynthesisItems', () => {
  it('builds one item per failure with the expected text and href', () => {
    const items = buildDiagnosticSynthesisItems([
      {
        clientId: 'c1',
        clientName: 'Acme',
        receipt: {
          state: 'failed',
          failed_modules: ['score_explanations', 'weird_module'],
          errors: ['LLM timeout'],
          total_cost_usd: 0.4,
        },
      },
    ])
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe('diagnostic_synthesis_failing')
    expect(item.client_id).toBe('c1')
    expect(item.client_name).toBe('Acme')
    expect(item.what).toContain('Acme')
    expect(item.what).toContain('没写成')
    expect(item.what).toContain('打分解释')
    expect(item.what).toContain('weird_module')
    expect(item.what).toContain('首个原因：LLM timeout')
    expect(item.how).toContain('欠账')
    expect(item.href.endsWith('/diagnostic/report')).toBe(true)
  })

  it('omits the first-error suffix when there are no errors', () => {
    const items = buildDiagnosticSynthesisItems([
      { clientId: 'c1', clientName: 'Acme', receipt: { state: 'partial', failed_modules: [], errors: [], total_cost_usd: 0 } },
    ])
    expect(items[0].what).not.toContain('首个原因')
    expect(items[0].what).toContain('未知模块')
  })
})

describe('pushDiagnosticSynthesisItems', () => {
  function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const chain = {
      select: (...args: unknown[]) => (calls.push({ method: 'select', args }), chain),
      eq: (...args: unknown[]) => (calls.push({ method: 'eq', args }), chain),
      gte: (...args: unknown[]) => (calls.push({ method: 'gte', args }), chain),
      order: (...args: unknown[]) => (calls.push({ method: 'order', args }), chain),
      limit: (...args: unknown[]) => (calls.push({ method: 'limit', args }), chain),
      then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    const supabase = { from: (table: string) => (calls.push({ method: 'from', args: [table] }), chain) }
    return { supabase: supabase as unknown as SupabaseClient, calls }
  }

  it('queries diagnostic-weekly since ~8 days ago and pushes items', async () => {
    const now = new Date('2026-03-10T00:00:00.000Z')
    const { supabase, calls } = fakeSupabase({
      data: [
        {
          summary: {
            outcomes: [
              { clientId: 'c1', clientName: 'Acme', synthesis: { state: 'failed', failed_modules: ['score_explanations'], errors: [], total_cost_usd: 0.2 } },
            ],
          },
        },
      ],
      error: null,
    })
    const items: unknown[] = []
    await pushDiagnosticSynthesisItems(supabase, items as never, now)

    expect(items).toHaveLength(1)
    expect(calls.find((c) => c.method === 'from')?.args[0]).toBe('cron_run_logs')
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['job_name', 'diagnostic-weekly'])
    const gte = calls.find((c) => c.method === 'gte')
    expect(gte?.args[0]).toBe('started_at')
    const since = new Date(gte?.args[1] as string)
    const days = (now.getTime() - since.getTime()) / 86_400_000
    expect(days).toBeCloseTo(SYNTHESIS_ITEM_LOOKBACK_DAYS, 5)
  })

  it('throws on query error', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: 'boom' } })
    await expect(
      pushDiagnosticSynthesisItems(supabase, [], new Date()),
    ).rejects.toThrow('cron_run_logs query failed: boom')
  })
})

describe('review fixes 2026-10-18', () => {
  it('a newer skipped receipt (rate-limited / disabled) does NOT cancel an older failure', () => {
    const failed = { state: 'failed', failed_modules: ['market_context'], errors: ['boom'], total_cost_usd: 0.4 }
    const skipped = { state: 'skipped', failed_modules: [], errors: [], total_cost_usd: 0 }
    const out = extractSynthesisFailures([
      { summary: { outcomes: [{ clientId: 'c1', clientName: 'C1', synthesis: skipped }] } },
      { summary: { outcomes: [{ clientId: 'c1', clientName: 'C1', synthesis: failed }] } },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].receipt.state).toBe('failed')
  })

  it('the item kind is never dropped by the dead-link filter (its link needs a login)', async () => {
    const { NEVER_DROP_KINDS } = await import('../manual-item-types')
    expect(NEVER_DROP_KINDS.has('diagnostic_synthesis_failing')).toBe(true)
  })
})
