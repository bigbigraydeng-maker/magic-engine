/**
 * A tiny chainable stand-in for the Supabase query builder: every call is recorded, awaiting the chain (or
 * calling maybeSingle) resolves to the configured result for that table. A table's result may also be a function of
 * the calls of that one query, for code that queries the same table twice with different filters.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StubResult {
  data: unknown
  error: { message: string; code?: string } | null
}

/** A fixed result, or one computed from the calls of the query being answered (from `from` onwards). */
export type StubAnswer = StubResult | ((query: RecordedCall[]) => StubResult)

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

const CHAIN_METHODS = ['select', 'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'is', 'not', 'limit', 'order', 'range', 'insert', 'upsert', 'update', 'or'] as const

export function ok(data: unknown): StubResult {
  return { data, error: null }
}

export function fail(message: string): StubResult {
  return { data: null, error: { message } }
}

export function createQueryStub(tables: Record<string, StubAnswer>): QueryStub {
  const calls: RecordedCall[] = []
  const db = {
    from(table: string) {
      const query: RecordedCall[] = []
      const record = (call: RecordedCall): void => {
        calls.push(call)
        query.push(call)
      }
      record({ table, method: 'from', args: [] })
      const answer = tables[table] ?? fail(`unexpected table ${table}`)
      const resolveResult = (): StubResult => (typeof answer === 'function' ? answer(query) : answer)
      const builder: Record<string, unknown> = {}
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          record({ table, method, args })
          return builder
        }
      }
      builder.maybeSingle = () => {
        record({ table, method: 'maybeSingle', args: [] })
        return Promise.resolve(resolveResult())
      }
      builder.single = () => {
        record({ table, method: 'single', args: [] })
        return Promise.resolve(resolveResult())
      }
      builder.then = (resolve: (value: StubResult) => unknown) => resolve(resolveResult())
      return builder
    },
    /** A database function call: answered by the entry `rpc:<name>`, recorded as one call with its arguments. */
    rpc(name: string, args: unknown) {
      const table = `rpc:${name}`
      calls.push({ table, method: 'rpc', args: [args] })
      const answer = tables[table] ?? fail(`unexpected function ${name}`)
      return Promise.resolve(typeof answer === 'function' ? answer([{ table, method: 'rpc', args: [args] }]) : answer)
    },
  } as unknown as SupabaseClient
  return {
    db,
    calls,
    of: (table) => calls.filter((c) => c.table === table),
    touched: (table) => calls.some((c) => c.table === table),
  }
}
