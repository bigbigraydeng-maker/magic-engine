/**
 * 广告体检警报（ad_health_narratives）→ 今日待办「需要你动手」。
 * 与巡察共用同一套「要不要 surfaced」判据；每个客户每天最多一条。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { surfaceAdHealthForPatrol } from '@/lib/ads-strategy/agents/patrol-ad-health'
import type { NarrativePayload } from '@/lib/ads-strategy/evaluate'

export type AdsHealthPatrolItemKind = 'ads_health_patrol_alert'

function accountDayKey(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(now)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parsePayload(raw: unknown): NarrativePayload | null {
  if (!isRecord(raw)) return null
  if (typeof raw.overall_verdict !== 'string' || typeof raw.headline !== 'string') return null
  return raw as unknown as NarrativePayload
}

export function buildAdsHealthPatrolItem(
  clientId: string,
  clientName: string,
  insightDate: string,
  payload: NarrativePayload,
): ManualItem | null {
  const surface = surfaceAdHealthForPatrol(insightDate, payload)
  if (!surface) return null
  return {
    kind: 'ads_health_patrol_alert',
    client_id: clientId,
    client_name: clientName,
    what: `「${clientName}」广告体检：${surface.patrolLine}`,
    how: surface.prescriptionLine
      ? `按体检建议处理（例如补素材、换人群或看落地页），详情见广告健康页。`
      : '打开广告健康页看各系列的指标和原因。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`,
  }
}

export async function pushAdsHealthPatrolItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const day = accountDayKey(now)
  const { data, error } = await supabase
    .from('ad_health_narratives')
    .select('client_id, insight_date, payload')
    .eq('insight_date', day)
  if (error) throw new Error(`ad_health_narratives 读取失败：${error.message}`)

  const seen = new Set<string>()
  for (const row of data ?? []) {
    const r = row as { client_id?: string; insight_date?: string; payload?: unknown }
    const clientId = r.client_id
    if (typeof clientId !== 'string' || clientId.length === 0) continue
    if (seen.has(clientId)) continue
    seen.add(clientId)
    const payload = parsePayload(r.payload)
    if (!payload) continue
    const insightDate = typeof r.insight_date === 'string' ? r.insight_date : day
    const item = buildAdsHealthPatrolItem(clientId, nameOf(clientId), insightDate, payload)
    if (item) bucket.push(item)
  }
}