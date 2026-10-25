import type { SupabaseClient } from '@supabase/supabase-js'
import type { Ga4Facts } from './types'
import { retryOnce, type Sleep } from './retry'
import { sanitizeError } from './sanitize'

export interface Ga4ReadDeps {
  loadPropertyId(clientId: string): Promise<string | null>
  fetchEventCounts(
    propertyId: string,
    clientId: string,
    eventNames: readonly string[],
    periodDays: number,
  ): Promise<Record<string, number> | null>
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

const NOT_CONNECTED = 'GA4 还没有连接属性：这个客户没有已连接的 GA4'
const NO_AUTH = '这个客户还没有可用的 Google 授权'

export async function readGa4Facts(
  input: { clientId: string; eventNames: readonly string[]; now: Date },
  deps: Ga4ReadDeps,
): Promise<{ facts: Ga4Facts; errors: string[] }> {
  const asOf = input.now.toISOString()

  try {
    const propertyId = await retryOnce(() => deps.loadPropertyId(input.clientId), { sleep: deps.sleep })
    if (propertyId === null) {
      return {
        facts: { read: false, error: NOT_CONNECTED, events_7d: {}, as_of: asOf },
        errors: [NOT_CONNECTED],
      }
    }

    const counts = await retryOnce(
      () => deps.fetchEventCounts(propertyId, input.clientId, input.eventNames, 7),
      { sleep: deps.sleep },
    )
    if (counts === null) {
      return {
        facts: { read: false, error: NO_AUTH, events_7d: {}, as_of: asOf },
        errors: [NO_AUTH],
      }
    }

    return {
      facts: { read: true, error: null, events_7d: counts, as_of: asOf },
      errors: [],
    }
  } catch (err) {
    const error = `GA4 读取失败：${sanitizeError(err)}`
    return {
      facts: { read: false, error, events_7d: {}, as_of: asOf },
      errors: [error],
    }
  }
}

interface ConnectorRow {
  config?: { property_id?: unknown } | null
}

function extractPropertyId(row: ConnectorRow | null): string | null {
  const raw = row?.config?.property_id
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}

export function makeSupabasePropertyLoader(
  supabase: SupabaseClient,
): Ga4ReadDeps['loadPropertyId'] {
  return async (clientId: string) => {
    const { data, error } = await supabase
      .from('client_connectors')
      .select('config')
      .eq('client_id', clientId)
      .eq('anchor', 'ga4')
      .eq('status', 'connected')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return extractPropertyId(data as ConnectorRow | null)
  }
}
