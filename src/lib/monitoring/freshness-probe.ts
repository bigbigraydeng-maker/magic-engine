/**
 * The database side of the freshness check: read the registry, and ask each
 * registered stream when it last received a row.
 *
 * Split out from the cron route so the per-client dashboard endpoint runs the
 * exact same probe against the exact same registry — one definition of "fresh",
 * not two that drift.
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  assertSafeIdentifier,
  type FreshnessExpectation,
  type FreshnessObservation,
} from '@/lib/monitoring/data-freshness'

/**
 * filter_prefix is a value rather than an identifier, but it is still operator
 * input reaching a PostgREST `like` pattern, so keep it boring on purpose:
 * no % or _ wildcards, no commas or parentheses that could break out of the
 * filter expression.
 */
const SAFE_PREFIX = /^[A-Za-z0-9_.\-:]{1,64}$/

export interface ProbeOptions {
  /** Scope the probe to one client. Ignored for streams with no client_column. */
  clientId?: string
}

/** Read every registered expectation. */
export async function loadFreshnessRegistry(): Promise<FreshnessExpectation[]> {
  const { data, error } = await supabaseAdmin.from('data_freshness_expectations').select('*')
  if (error) throw new Error(`Cannot read registry: ${error.message}`)
  return (data ?? []) as FreshnessExpectation[]
}

/**
 * Probe one registered stream: when was the last row written, and how many are
 * there? Uses PostgREST rather than raw SQL so table/column names never reach a
 * query string unescaped, and validates every identifier that comes from the
 * registry table before use.
 */
export async function probeStream(
  expectation: FreshnessExpectation,
  options: ProbeOptions = {},
): Promise<FreshnessObservation> {
  try {
    const table = assertSafeIdentifier(expectation.table_name, 'table_name')
    const tsColumn = assertSafeIdentifier(expectation.timestamp_column, 'timestamp_column')

    let query = supabaseAdmin
      .from(table)
      .select(tsColumn, { count: 'exact' })
      .order(tsColumn, { ascending: false })
      .limit(1)

    if (expectation.filter_column && expectation.filter_prefix) {
      const filterColumn = assertSafeIdentifier(expectation.filter_column, 'filter_column')
      if (!SAFE_PREFIX.test(expectation.filter_prefix)) {
        return { lastWrittenAt: null, rowCount: null, error: 'Unsafe filter_prefix in registry' }
      }
      query = query.like(filterColumn, `${expectation.filter_prefix}%`)
    }

    if (options.clientId) {
      if (!expectation.client_column) {
        // Global stream (industry benchmarks, cron heartbeats). Nothing here
        // belongs to a single client, so report it as "no data for this client"
        // rather than silently attributing a global row to them.
        return { lastWrittenAt: null, rowCount: null, error: null }
      }
      const clientColumn = assertSafeIdentifier(expectation.client_column, 'client_column')
      query = query.eq(clientColumn, options.clientId)
    }

    const { data, count, error } = await query

    if (error) {
      return { lastWrittenAt: null, rowCount: null, error: error.message }
    }

    // supabase-js types this row as a union that includes its own error shape,
    // so go through `unknown` rather than asserting across the union.
    const row =
      Array.isArray(data) && data.length > 0
        ? (data[0] as unknown as Record<string, unknown>)
        : null
    const value = row?.[expectation.timestamp_column]

    return {
      lastWrittenAt: typeof value === 'string' ? value : null,
      rowCount: typeof count === 'number' ? count : null,
      error: null,
    }
  } catch (err) {
    return {
      lastWrittenAt: null,
      rowCount: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
