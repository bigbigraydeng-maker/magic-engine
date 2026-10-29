/**
 * A tiny chainable stand-in for the Supabase query builder: every call is recorded, awaiting the chain (or
 * calling maybeSingle) resolves to the configured result for that table.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StubResult {
  data: unknown
  error: { message: string } | null
}

export interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

export interface QueryStub {
  db: SupabaseClient
  calls: RecordedCall[]
  /** The recorded calls of one table, in order. */
  of(table: string): RecordedCall[]
  /** True when the table was queried at all. */
  touched(table: string): boolean
}

const CHAIN_METHODS = ['select', 'eq', 'in', 'gte', 'lte', 'limit', 'order'] as const

export function ok(data: unknown): StubResult {
  return { data, error: null }
}

export function fail(message: string): StubResult {
  return { data: null, error: { message } }
}

export function createQueryStub(tables: Record<string, StubResult>): QueryStub {
  const calls: RecordedCall[] = []
  const db = {
    from(table: string) {
      calls.push({ table, method: 'from', args: [] })
      const result = tables[table] ?? fail(`unexpected table ${table}`)
      const builder: Record<string, unknown> = {}
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return builder
        }
      }
      builder.maybeSingle = () => {
        calls.push({ table, method: 'maybeSingle', args: [] })
        return Promise.resolve(result)
      }
      builder.then = (resolve: (value: StubResult) => unknown) => resolve(result)
      return builder
    },
  } as unknown as SupabaseClient
  return {
    db,
    calls,
    of: (table) => calls.filter((c) => c.table === table),
    touched: (table) => calls.some((c) => c.table === table),
  }
}
