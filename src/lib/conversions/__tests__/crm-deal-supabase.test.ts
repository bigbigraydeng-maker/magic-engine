import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CRM_STAGE_MANUAL_SOURCE, DEAL_DEDUPE_WINDOW_MS } from '../crm-deal-record'
import { supabaseDealIo } from '../crm-deal-supabase'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'

interface Call {
  method: string
  args: unknown[]
}

function queryDb(rows: unknown[]) {
  const calls: Call[] = []
  const chain: Record<string, unknown> = {}
  const self = new Proxy(chain, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null })
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return self
      }
    },
  })
  const db = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] })
      return self
    },
  }
  return { calls, db: db as unknown as SupabaseClient }
}

describe('loadApprovedPurchases query', () => {
  it('filters the last 30 days and drops the same source before any row limit', async () => {
    const { calls, db } = queryDb([{
      source_kind: 'crm_sheet_sync',
      occurred_at: new Date().toISOString(),
      review_status: 'approved',
      outcome_kind: 'purchase',
    }])
    const rows = await supabaseDealIo(db).loadApprovedPurchases(CLIENT, CONTACT)
    const methods = calls.map((call) => call.method)
    expect(methods).not.toContain('limit')
    expect(calls).toContainEqual({ method: 'neq', args: ['source_kind', CRM_STAGE_MANUAL_SOURCE] })
    const gte = calls.find((call) => call.method === 'gte')
    expect(gte?.args[0]).toBe('occurred_at')
    const since = Date.parse(String(gte?.args[1]))
    const age = Date.now() - since
    expect(age).toBeGreaterThan(DEAL_DEDUPE_WINDOW_MS - 5_000)
    expect(age).toBeLessThan(DEAL_DEDUPE_WINDOW_MS + 5_000)
    const neqAt = methods.indexOf('neq')
    const gteAt = methods.indexOf('gte')
    expect(neqAt).toBeGreaterThan(methods.indexOf('eq'))
    expect(gteAt).toBeGreaterThan(neqAt)
    expect(rows).toEqual([{
      sourceKind: 'crm_sheet_sync',
      occurredAt: expect.any(String),
      reviewStatus: 'approved',
      outcomeKind: 'purchase',
    }])
  })
})
