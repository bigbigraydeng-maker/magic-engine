/**
 * 日趋势 Check（growth_state.payload.trendCheck）→ 今日待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import type { TrendCheckPatrolSurface } from '@/lib/ads-strategy/trend-check/patrol-surface'

export type AdsTrendCheckItemKind = 'ads_trend_check_alert'

function accountDayKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function parseTrendPayload(raw: unknown): TrendCheckPatrolSurface | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const trend = (raw as { trendCheck?: unknown }).trendCheck
  if (!trend || typeof trend !== 'object' || Array.isArray(trend)) return null
  const surface = trend as TrendCheckPatrolSurface
  if (!Array.isArray(surface.lines) || surface.lines.length === 0) return null
  return surface
}

export function buildAdsTrendCheckItem(
  clientId: string,
  clientName: string,
  surface: TrendCheckPatrolSurface,
): ManualItem {
  const summary = surface.lines.length === 1 ? surface.lines[0] : `${surface.lines.length} 条：${surface.lines.join('；')}`
  return {
    kind: 'ads_trend_check_alert',
    client_id: clientId,
    client_name: clientName,
    what: `「${clientName}」趋势检查：${summary}`,
    how: '打开广告门看经营视图里的趋势检查栏；系统不会自动改素材或预算。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`,
  }
}

export async function pushAdsTrendCheckItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const day = accountDayKey(now)
  const { data, error } = await supabase
    .from('ads_growth_states')
    .select('client_id, payload')
    .eq('date', day)
  if (error) throw new Error(`ads_growth_states 读取失败（趋势待办）：${error.message}`)

  const seen = new Set<string>()
  for (const row of data ?? []) {
    const r = row as { client_id?: string; payload?: unknown }
    const clientId = r.client_id
    if (typeof clientId !== 'string' || seen.has(clientId)) continue
    const surface = parseTrendPayload(r.payload)
    if (!surface) continue
    seen.add(clientId)
    bucket.push(buildAdsTrendCheckItem(clientId, nameOf(clientId), surface))
  }
}