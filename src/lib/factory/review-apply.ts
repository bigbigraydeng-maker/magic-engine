// P21.J P2 — 审核执行层(DB ops):/review route + 嵌入 Claude 对话工具共用同一实现。
// 不走内部 HTTP 自调用(zhangqian 事故教训),两个前脸 import 同一 lib。
// 花钱闸(approve 的 $50 硬顶)在 applyApprove 内服务端强制,对话框也绕不过(魏征红线③)。

import type { SupabaseClient } from '@supabase/supabase-js'
import { approveBudgetWithinCap } from './review-actions'
import type { ReviewRejectCategory } from './types'

export interface ReviewApplyResult {
  ok: boolean
  status: number
  error?: string
  data?: Record<string, unknown>
}

type WO = Record<string, unknown>

/** 载入并校验:必须存在、in_review、(可选)属于该客户 */
async function loadInReview(
  supabase: SupabaseClient,
  id: string,
  clientId?: string,
): Promise<{ wo?: WO; err?: ReviewApplyResult }> {
  const { data: wo, error } = await supabase
    .from('content_work_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return { err: { ok: false, status: 500, error: error.message } }
  if (!wo) return { err: { ok: false, status: 404, error: 'work order not found' } }
  if (clientId && wo.client_id !== clientId) {
    return { err: { ok: false, status: 403, error: 'work order not in this client' } }
  }
  if (wo.status !== 'in_review') {
    return { err: { ok: false, status: 409, error: `only in_review can be reviewed (status=${wo.status})` } }
  }
  return { wo }
}

/** 通过并投放:in_review → approved,服务端重判 $50 硬顶 */
export async function applyApprove(
  supabase: SupabaseClient,
  id: string,
  reviewer: string,
  clientId?: string,
): Promise<ReviewApplyResult> {
  const { wo, err } = await loadInReview(supabase, id, clientId)
  if (err) return err
  const reviewRef = (wo!.review_ref ?? {}) as Record<string, unknown>
  const gate = approveBudgetWithinCap(reviewRef)
  if (!gate.ok) return { ok: false, status: 422, error: gate.error }

  const { data: upd, error } = await supabase
    .from('content_work_orders')
    .update({
      status: 'approved',
      review_ref: { ...reviewRef, approved_by: reviewer, approved_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return { ok: false, status: 500, error: error.message }
  if (!upd || upd.length === 0) return { ok: false, status: 409, error: 'work order no longer in_review' }
  return { ok: true, status: 200, data: { status: 'approved', budget_usd: gate.budget } }
}

/** 打回·画面质量:老单 review_rejected + 重开新单,意见进新 brief */
export async function applyQualityReject(
  supabase: SupabaseClient,
  id: string,
  feedback: string,
  reviewer: string,
  clientId?: string,
): Promise<ReviewApplyResult> {
  const { wo, err } = await loadInReview(supabase, id, clientId)
  if (err) return err

  const { data: upd, error } = await supabase
    .from('content_work_orders')
    .update({
      status: 'review_rejected',
      reject_category: 'quality' satisfies ReviewRejectCategory,
      reject_reason: feedback.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return { ok: false, status: 500, error: error.message }
  if (!upd || upd.length === 0) return { ok: false, status: 409, error: 'work order no longer in_review' }

  const brief = (wo!.brief ?? {}) as Record<string, unknown>
  const { data: reopened, error: insErr } = await supabase
    .from('content_work_orders')
    .insert({
      client_id: wo!.client_id,
      signal_id: wo!.signal_id,
      goal_id: wo!.goal_id,
      master_brief_id: wo!.master_brief_id,
      winner_structure_id: wo!.winner_structure_id,
      order_type: wo!.order_type,
      angle: wo!.angle,
      angle_source: wo!.angle_source,
      rationale_one_liner: wo!.rationale_one_liner,
      brief: { ...brief, review_feedback: feedback.slice(0, 2000), review_feedback_by: reviewer, reopened_from: id },
      budget_cap_usd: wo!.budget_cap_usd,
      source_ad_id: wo!.source_ad_id,
      status: 'queued',
    })
    .select('id')
    .single()
  if (insErr) return { ok: false, status: 500, error: `reopen insert failed: ${insErr.message}` }
  return { ok: true, status: 200, data: { status: 'review_rejected', reopened_work_order_id: reopened.id } }
}

/** 打回·预算不对:只改投放预算回 in_review 二次确认,不重生产 */
export async function applyBudgetUpdate(
  supabase: SupabaseClient,
  id: string,
  newBudget: number,
  reviewer: string,
  clientId?: string,
): Promise<ReviewApplyResult> {
  const { wo, err } = await loadInReview(supabase, id, clientId)
  if (err) return err
  const reviewRef = (wo!.review_ref ?? {}) as Record<string, unknown>

  const { data: upd, error } = await supabase
    .from('content_work_orders')
    .update({
      review_ref: {
        ...reviewRef,
        publish_budget_usd: newBudget,
        budget_updated_at: new Date().toISOString(),
        budget_updated_by: reviewer,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return { ok: false, status: 500, error: error.message }
  if (!upd || upd.length === 0) return { ok: false, status: 409, error: 'work order no longer in_review' }
  return { ok: true, status: 200, data: { status: 'in_review', publish_budget_usd: newBudget } }
}
