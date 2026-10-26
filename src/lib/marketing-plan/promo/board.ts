/**
 * 推广计划「一页纸」数据：把计划 + 事实 + 纯函数拼起来。看板接口和批准接口共用。
 */

import type { MarketingPlan, PromoManualCheckRecord } from '../types'
import { loadPromoFacts, type LoadPromoFactsOptions } from './facts'
import {
  blockers, evaluateApproval, evaluatePhaseGates, unverified, worstLight,
  type ApprovalVerdict, type GateResult, type Light,
} from './gates'
import { reconcileWeek, type Reconciliation } from './reconcile'
import { promoContentHash } from './content-hash'
import { hasPromoField, nextPhaseFrom, parsePromoSpec, type PromoPhase, type PromoSpec, type PromoValidationIssue } from './spec'

export interface PhaseGateView {
  phase: Pick<PromoPhase, 'id' | 'name' | 'start_date' | 'end_date'>
  results: GateResult[]
  worst: Light
  blockers: GateResult[]
  unverified: GateResult[]
}

export interface PromoBoard {
  plan_id: string
  plan_status: MarketingPlan['status']
  /** 计划行的 updated_at，前端保存时当乐观锁用 */
  updated_at: string | null
  has_promo: boolean
  spec_valid: boolean
  issues: PromoValidationIssue[]
  today: string | null
  timezone_known: boolean
  playbook: { key: string; evidence: string } | null
  /** 批准计划前的检查（只看第一阶段的硬门）；计划已批准后仍给出，供参考 */
  approval: ApprovalVerdict | null
  next_phase: PhaseGateView | null
  reconcile: Reconciliation | null
  /** 本窗口 PM 是否已点过「按计划继续」 */
  reviewed_this_window: boolean
  /** 批准之后推广内容被改过（回执指纹和现在的指纹对不上）；旧回执没有指纹时为 false */
  content_changed: boolean
}

export function manualChecksOf(plan: Pick<MarketingPlan, 'generation_meta'>): PromoManualCheckRecord[] {
  return plan.generation_meta?.promo_checks ?? []
}

function phaseView(spec: PromoSpec, phase: PromoPhase, results: GateResult[]): PhaseGateView {
  return {
    phase: { id: phase.id, name: phase.name, start_date: phase.start_date, end_date: phase.end_date },
    results, worst: worstLight(results), blockers: blockers(results), unverified: unverified(results),
  }
}

const EMPTY = (plan: MarketingPlan, has: boolean, issues: PromoValidationIssue[]): PromoBoard => ({
  plan_id: plan.id, plan_status: plan.status, updated_at: plan.updated_at ?? null, has_promo: has, spec_valid: false, issues,
  today: null, timezone_known: false, playbook: null, approval: null, next_phase: null,
  reconcile: null, reviewed_this_window: false, content_changed: false,
})

export async function buildPromoBoard(plan: MarketingPlan, now: Date = new Date(), options: LoadPromoFactsOptions = {}): Promise<PromoBoard> {
  const raw = (plan.plan_data as unknown as { promo?: unknown } | null)?.promo
  if (!hasPromoField(plan.plan_data)) return EMPTY(plan, false, [])
  const parsed = parsePromoSpec(raw)
  if (!parsed.ok) return EMPTY(plan, true, parsed.issues) // 畸形 = 不放行

  const spec = parsed.spec
  const facts = await loadPromoFacts(plan.client_id, spec, manualChecksOf(plan), now, options)
  const approval = evaluateApproval(spec, facts.gate)
  const next = nextPhaseFrom(spec, facts.today)
  const reconcile = reconcileWeek(spec, facts.today, facts.recon, facts.playbook)
  const reviewed = (plan.generation_meta?.weekly_reviews ?? []).some(r => r.week_start === reconcile.window.start)

  const receiptHash = plan.generation_meta?.approval_receipt?.content_hash
  // 已批准却没有批准指纹（绕过批准接口批的，或指纹上线前批的）按「没法确认」处理，和自动执行那边的口径一致（那边也会停）
  const hasFingerprint = typeof receiptHash === 'string' && receiptHash !== ''
  const contentChanged = plan.status === 'approved' && (!hasFingerprint || receiptHash !== promoContentHash(spec))

  return {
    plan_id: plan.id, plan_status: plan.status, updated_at: plan.updated_at ?? null, has_promo: true, spec_valid: true, issues: [],
    today: facts.today, timezone_known: facts.timezone_known,
    playbook: { key: facts.playbook.key, evidence: facts.playbook.evidence },
    approval,
    next_phase: next ? phaseView(spec, next, evaluatePhaseGates(spec, next, facts.gate)) : null,
    reconcile, reviewed_this_window: reviewed, content_changed: contentChanged,
  }
}
