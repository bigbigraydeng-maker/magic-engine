/**
 * 把当日广告体检叙事（ad_health_narratives）接到巡察结论和今日待办。
 * 只读；不调 LLM、不写 Meta。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { NarrativePayload } from '@/lib/ads-strategy/evaluate'
import type { Prescription } from '@/lib/ads-strategy/prescription'
import type { Verdict } from '@/lib/ads-strategy/baseline'

export interface AdHealthPatrolSurface {
  readonly insightDate: string
  readonly overallVerdict: Verdict
  readonly headline: string
  readonly prescriptionLine: string | null
  /** 写进 growth_state.payload 与 buildHeadline */
  readonly patrolLine: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parsePayload(raw: unknown): NarrativePayload | null {
  if (!isRecord(raw)) return null
  if (typeof raw.overall_verdict !== 'string' || typeof raw.headline !== 'string') return null
  if (typeof raw.generated_for !== 'string') return null
  return raw as unknown as NarrativePayload
}

function pickPrescription(payload: NarrativePayload): Prescription | null {
  for (const c of payload.campaigns ?? []) {
    if (c.prescription) return c.prescription
  }
  return null
}

function shouldSurface(verdict: Verdict, prescription: Prescription | null): boolean {
  if (verdict === 'alert' || verdict === 'watch') return true
  return prescription !== null
}

/**
 * 从已存的 payload 抽出巡察要显示的一行（纯函数，可单测）。
 */
export function surfaceAdHealthForPatrol(
  insightDate: string,
  payload: NarrativePayload,
): AdHealthPatrolSurface | null {
  const prescription = pickPrescription(payload)
  if (!shouldSurface(payload.overall_verdict, prescription)) return null
  const prescriptionLine = prescription
    ? `${prescription.title}（${prescription.why}）`
  : null
  const parts = [payload.headline]
  if (prescriptionLine) parts.push(prescriptionLine)
  return {
    insightDate,
    overallVerdict: payload.overall_verdict,
    headline: payload.headline,
    prescriptionLine,
    patrolLine: parts.join('；'),
  }
}

export async function loadAdHealthPatrolSurface(
  clientId: string,
  insightDate: string,
): Promise<AdHealthPatrolSurface | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_health_narratives')
    .select('insight_date, payload')
    .eq('client_id', clientId)
    .eq('insight_date', insightDate)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { insight_date?: string; payload?: unknown }
  const payload = parsePayload(row.payload)
  if (!payload) return null
  const day = typeof row.insight_date === 'string' ? row.insight_date : insightDate
  return surfaceAdHealthForPatrol(day, payload)
}