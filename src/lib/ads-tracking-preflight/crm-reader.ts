import type { SupabaseClient } from '@supabase/supabase-js'
import type { CrmFacts } from './types'
import { sanitizeError } from './sanitize'

const SEVEN_DAYS_MS = 7 * 86_400_000

interface TouchpointRow {
  occurred_at?: unknown
}

function emptyFacts(error: string, asOf: string): CrmFacts {
  return {
    read: false,
    error,
    web_form_touchpoints_7d: 0,
    latest_web_form_at: null,
    as_of: asOf,
  }
}

export async function readCrmFacts(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ facts: CrmFacts; errors: string[] }> {
  const asOf = now.toISOString()
  const sinceIso = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString()

  try {
    const { data, count, error } = await supabase
      .from('contact_touchpoints')
      .select('occurred_at', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('channel', 'web_form')
      .gte('occurred_at', sinceIso)
      .order('occurred_at', { ascending: false })
      .limit(1)

    if (error) {
      const message = `CRM 读取失败：${sanitizeError(error.message)}`
      return { facts: emptyFacts(message, asOf), errors: [message] }
    }

    const rows: TouchpointRow[] = Array.isArray(data) ? (data as TouchpointRow[]) : []
    const total = typeof count === 'number' ? count : rows.length
    const latest = rows[0]?.occurred_at

    return {
      facts: {
        read: true,
        error: null,
        web_form_touchpoints_7d: total,
        latest_web_form_at: typeof latest === 'string' ? latest : null,
        as_of: asOf,
      },
      errors: [],
    }
  } catch (err) {
    const message = `CRM 读取失败：${sanitizeError(err)}`
    return { facts: emptyFacts(message, asOf), errors: [message] }
  }
}
