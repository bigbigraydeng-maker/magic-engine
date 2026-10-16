// P21.J P2 — 审核执行层(DB ops):/review route + 嵌入 Claude 对话工具共用同一实现。
// 不走内部 HTTP 自调用(zhangqian 事故教训),两个前脸 import 同一 lib。
// 花钱闸(approve 的 $50 硬顶)在 applyApprove 内服务端强制,对话框也绕不过(魏征红线③)。

import type { SupabaseClient } from '@supabase/supabase-js'
import { approveBudgetWithinCap } from './review-actions'
import {
  REEL_AUTO_CHECK_KEYS,
  REEL_HUMAN_CHECK_KEYS_V2,
  checklistPasses,
  hasChecklistFailure,
  isValidContentSourceRef,
  validateContentChecklist,
  type ContentCheckItemResult,
} from '@/lib/social/content-review'
import { computeReviewFeedbackDigest, RecipeConfigError, winnerRecipeFromBrief } from './recipe'
import type { ReviewRejectCategory } from './types'

export interface ReviewApplyResult {
  ok: boolean
  status: number
  error?: string
  data?: Record<string, unknown>
}

type WO = Record<string, unknown>

async function validateChecklistSources(
  supabase: SupabaseClient,
  clientId: string,
  items: readonly ContentCheckItemResult[],
): Promise<string | null> {
  const refs = items.map(item => item.source_ref).filter((ref): ref is string => Boolean(ref))
  if (refs.some(ref => !isValidContentSourceRef(ref))) return 'checklist contains an invalid source_ref'
  const assetIds = Array.from(new Set(refs
    .filter(ref => ref.startsWith('client_asset:'))
    .map(ref => ref.slice('client_asset:'.length))))
  if (assetIds.length === 0) return null
  const { data, error } = await supabase.from('client_assets').select('id').eq('client_id', clientId).in('id', assetIds)
  if (error) return `checklist source lookup failed: ${error.message}`
  if ((data ?? []).length !== assetIds.length) return 'checklist source is not owned by this client'
  return null
}

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
  checklistHuman: unknown = null,
): Promise<ReviewApplyResult> {
  const { wo, err } = await loadInReview(supabase, id, clientId)
  if (err) return err
  const checkedHuman = validateContentChecklist(checklistHuman, REEL_HUMAN_CHECK_KEYS_V2, 'HUMAN')
  if (!checkedHuman.ok) return { ok: false, status: 400, error: checkedHuman.error }
  if (!checklistPasses(checkedHuman.items)) return { ok: false, status: 422, error: 'all human checklist items must PASS' }
  const sourceError = await validateChecklistSources(supabase, String(wo!.client_id), checkedHuman.items)
  if (sourceError) return { ok: false, status: 422, error: sourceError }
  const output = (wo!.output ?? {}) as Record<string, unknown>
  const checkedAuto = validateContentChecklist(output.quality_checklist_auto, REEL_AUTO_CHECK_KEYS, 'AUTO')
  if (!checkedAuto.ok) return { ok: false, status: 422, error: `automatic checklist unavailable: ${checkedAuto.error}` }
  if (!checklistPasses(checkedAuto.items)) return { ok: false, status: 422, error: 'automatic checklist is incomplete or not measured' }
  const reviewRef = (wo!.review_ref ?? {}) as Record<string, unknown>
  const gate = approveBudgetWithinCap(reviewRef)
  if (!gate.ok) return { ok: false, status: 422, error: gate.error }

  const { data: upd, error } = await supabase
    .from('content_work_orders')
    .update({
      status: 'approved',
      review_ref: { ...reviewRef, approved_by: reviewer, approved_at: new Date().toISOString(), checklist_human: checkedHuman.items },
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
  checklistHuman: unknown = null,
): Promise<ReviewApplyResult> {
  const { wo, err } = await loadInReview(supabase, id, clientId)
  if (err) return err
  const checkedHuman = validateContentChecklist(checklistHuman, REEL_HUMAN_CHECK_KEYS_V2, 'HUMAN')
  if (!checkedHuman.ok) return { ok: false, status: 400, error: checkedHuman.error }
  if (!hasChecklistFailure(checkedHuman.items)) return { ok: false, status: 400, error: 'quality rejection requires a failed checklist item' }
  const sourceError = await validateChecklistSources(supabase, String(wo!.client_id), checkedHuman.items)
  if (sourceError) return { ok: false, status: 422, error: sourceError }

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
  // recipe 单被打回:清掉 stale creative_recipe/plan,打上结构化 replan-required marker。
  // worker 遇到 marker 会在任何 provider 之前 fail-closed,直到服务端产出新的合法 plan(合同 R3/R4)。
  // 无 recipe 的普通单:继承 review_feedback 直接进 queued,legacy 行为不变。
  let originallyHadRecipe = false
  try {
    originallyHadRecipe = winnerRecipeFromBrief(brief) !== null
  } catch (e) {
    // brief 里恰好带非法 creative_recipe:视作确实有 recipe(把它当 recipe 单处理,强制 replan)
    if (e instanceof RecipeConfigError) originallyHadRecipe = true
    else throw e
  }
  const newBrief: Record<string, unknown> = {
    ...brief,
    review_feedback: feedback.slice(0, 2000),
    review_feedback_by: reviewer,
    reopened_from: id,
    review_checklist_failed_items: checkedHuman.items.filter(item => item.outcome === 'FAIL').map(item => item.key),
  }
  if (originallyHadRecipe) {
    // 保留旧 recipe 供审计,但从 top-level 抹掉,worker/evaluate 都不再拿到可用 recipe
    newBrief.previous_creative_recipe = brief.creative_recipe ?? null
    delete newBrief.creative_recipe
    // 同时清 stale 计划字段,避免 assertRecipePlanShape 拿旧 plan 走通
    delete newBrief.clip_generation_plan
    delete newBrief.segments
    delete newBrief.max_new_clips
    newBrief.recipe_replan_required = true
    newBrief.recipe_replan_reason = feedback.slice(0, 400)
    // R3 硬绑定:把当前 feedback 的 sha256 digest 落进 brief。任何后续 replanner 必须把
    // digest 明确 ack 进 creative_recipe.acknowledged_review_feedback_digest,不然 worker 侧
    // assertRecipeReplanAcknowledged 会 fail-closed —— 阻止「静默换个新 recipe 但没吃反馈」。
    newBrief.review_feedback_digest = computeReviewFeedbackDigest(feedback)
  }
  // blocker 3:frozen contract —— worker 不许从 free-text feedback 里 infer plan。
  // recipe 单 reopen 时不要落回 'queued'（那样 worker 会抢单跑一个 doomed order）;
  // 落进已有的非可认领状态 'dead_letter' 并写 recipe_replan_required,等服务端明确 replan 后
  // 再由服务端创建新的 queued 单。legacy 单保持原行为(queued)。
  const reopenStatus = originallyHadRecipe ? 'dead_letter' : 'queued'
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
      brief: newBrief,
      budget_cap_usd: wo!.budget_cap_usd,
      source_ad_id: wo!.source_ad_id,
      status: reopenStatus,
    })
    .select('id')
    .single()
  if (insErr) return { ok: false, status: 500, error: `reopen insert failed: ${insErr.message}` }
  return {
    ok: true,
    status: 200,
    data: {
      status: 'review_rejected',
      reopened_work_order_id: reopened.id,
      reopened_status: reopenStatus,
      recipe_replan_required: originallyHadRecipe,
      // truthful:recipe 单 park 在 dead_letter,等 server 显式 replan 才建新 queued
      parked_pending_replan: originallyHadRecipe,
      review_feedback_digest: originallyHadRecipe
        ? (newBrief.review_feedback_digest as string)
        : null,
    },
  }
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
