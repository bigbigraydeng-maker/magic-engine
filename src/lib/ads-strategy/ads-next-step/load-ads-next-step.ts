/**
 * 广告健康页顶部「广告下一步」只读合并卡 —— 服务端聚合。
 *
 * 三块数据各读各的；任一块读失败 → 该行 kind: 'unreadable'（不显示 0、不抛错）。
 * 读成功但没有内容 → kind: 'empty'。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from '@/lib/kernel/types'
import { listPendingAdsAutoPauseForClient } from '@/lib/ads-strategy/auto-pause-pending'
import { listPendingRunsForActionForClient } from '@/lib/kernel-approval/action-pending'
import { ADS_O1_BUDGET_SCALE_ACTION_KEY } from '@/lib/action-submission/ads-o1-budget-scale'
import type { Diagnosis, DiagnosisRun } from '@/lib/ads-strategy/portfolio/diagnostics/types'
import type { Prescription } from '@/types/diagnostic'
import { prescriptionStatusLabel } from './prescription-labels'
import type { AdsNextStepPendingItem, AdsNextStepView, HealthRedLightsView } from './types'

/** D 系列命中展示优先级（越靠前越「红灯」）。 */
const DIAGNOSIS_HIT_PRIORITY: readonly string[] = [
  'D3', 'D1', 'D2', 'D10', 'D11', 'D4', 'D5', 'D9', 'D7', 'D8', 'D6',
]

function approvalsHref(clientId: string): string {
  return `/dashboard/clients/${clientId}/ads-health?tab=approvals`
}

function settingsHref(clientId: string): string {
  return `/dashboard/clients/${clientId}/ads-health?tab=settings`
}

function sortHits(diagnoses: readonly Diagnosis[]): Diagnosis[] {
  const rank = new Map(DIAGNOSIS_HIT_PRIORITY.map((code, i) => [code, i]))
  return [...diagnoses]
    .filter((d) => d.status === 'hit')
    .sort((a, b) => (rank.get(a.code) ?? 999) - (rank.get(b.code) ?? 999))
}

async function loadHealthRedLights(
  sb: SupabaseClient,
  clientId: string,
  staffView: boolean,
): Promise<HealthRedLightsView> {
  if (!staffView) {
    return { kind: 'staff_only' }
  }
  try {
    const { data, error } = await sb
      .from('ad_health_narratives')
      .select('payload')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { kind: 'unreadable' }
    if (!data) return { kind: 'empty' }

    const payload = data.payload as { portfolio_diagnoses?: DiagnosisRun } | null
    const run = payload?.portfolio_diagnoses
    if (!run || !Array.isArray(run.diagnoses)) return { kind: 'empty' }

    const hits = sortHits(run.diagnoses)
    const titles = hits.slice(0, 3).map((d) => d.title.trim()).filter((t) => t.length > 0)
    if (titles.length === 0) return { kind: 'empty' }
    return { kind: 'ok', data: { items: titles } }
  } catch {
    return { kind: 'unreadable' }
  }
}

/** 与 growth-panel O1Approval 一致：只列当前巡察日能在设置里批准的那批。 */
export function o1PendingMatchesGrowthCycleDate(
  run: Pick<ActionRun, 'evidence'>,
  growthCycleDate: string | null,
): boolean {
  if (!growthCycleDate) return false
  const d = (run.evidence as { date?: unknown } | null | undefined)?.date
  return d === growthCycleDate
}

type GrowthCycleDateRead =
  | { readonly ok: true; readonly date: string | null }
  | { readonly ok: false }

async function loadLatestGrowthCycleDate(
  sb: SupabaseClient,
  clientId: string,
): Promise<GrowthCycleDateRead> {
  const { data, error } = await sb
    .from('ads_growth_states')
    .select('date')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false }
  if (!data) return { ok: true, date: null }
  const date = (data as { date?: unknown }).date
  const cycleDate = typeof date === 'string' && date.length > 0 ? date : null
  return { ok: true, date: cycleDate }
}

async function loadPendingActions(
  sb: SupabaseClient,
  clientId: string,
  staffView: boolean,
): Promise<AdsNextStepView['pendingActions']> {
  try {
    const d3 = await listPendingAdsAutoPauseForClient(sb, clientId)
    let growthCycleDate: string | null = null
    if (staffView) {
      const cycle = await loadLatestGrowthCycleDate(sb, clientId)
      // 巡察日读失败时不能把还在等的 O1 滤成「没有待批」。
      if (!cycle.ok) return { kind: 'unreadable' }
      growthCycleDate = cycle.date
    }
    const o1 = staffView
      ? await listPendingRunsForActionForClient(sb, ADS_O1_BUDGET_SCALE_ACTION_KEY, clientId)
      : { items: [], hasMore: false }
    const items: AdsNextStepPendingItem[] = []

    for (const row of d3.items) {
      const summary =
        (row.diagnosisTitle?.trim() || '建议暂停花钱没结果的广告组').slice(0, 120)
      items.push({ summary, href: approvalsHref(clientId) })
    }
    for (const row of o1.items) {
      if (!o1PendingMatchesGrowthCycleDate(row.run, growthCycleDate)) continue
      const rationale =
        staffView
        && typeof row.run.rationale === 'string'
        && row.run.rationale.trim().length > 0
          ? row.run.rationale.trim().slice(0, 120)
          : '加预算建议等人批准'
      items.push({ summary: rationale, href: settingsHref(clientId) })
    }

    if (items.length === 0) return { kind: 'empty' }
    return { kind: 'ok', data: { count: items.length, items } }
  } catch {
    return { kind: 'unreadable' }
  }
}

async function loadPrescription(
  sb: SupabaseClient,
  clientId: string,
): Promise<AdsNextStepView['prescription']> {
  try {
    const { data, error } = await sb
      .from('prescriptions')
      .select('version, status, approved_at')
      .eq('client_id', clientId)
      .in('status', ['draft', 'generating', 'failed', 'approved', 'rejected', 'superseded'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<Pick<Prescription, 'version' | 'status' | 'approved_at'>>()

    if (error) return { kind: 'unreadable' }
    if (!data) return { kind: 'empty' }

    return {
      kind: 'ok',
      data: {
        version: data.version,
        statusLabel: prescriptionStatusLabel(data.status),
        approvedAt: data.approved_at,
      },
    }
  } catch {
    return { kind: 'unreadable' }
  }
}

export async function loadAdsNextStepView(
  sb: SupabaseClient,
  clientId: string,
  options: { readonly staffView: boolean },
): Promise<AdsNextStepView> {
  const [healthRedLights, pendingActions, prescription] = await Promise.all([
    loadHealthRedLights(sb, clientId, options.staffView),
    loadPendingActions(sb, clientId, options.staffView),
    loadPrescription(sb, clientId),
  ])
  return { healthRedLights, pendingActions, prescription }
}
