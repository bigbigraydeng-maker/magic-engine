/**
 * 通话分析 → 客人在电话里的表态（`call_stance`），写到这通电话的 CRM 触点上。
 *
 * 只认**已通过原话核验**、**说话人是客人**的事实；员工说的、分不清谁说的一律不算。
 * 两种都出现时取更明确的「不感兴趣」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { CallStance } from '@/lib/crm/segments'
import { mergeTouchpointMetadata, type MetadataMergeOutcome } from '@/lib/crm/touchpoint-metadata'
import type { RawFact } from './analysis-schema'

export function callStanceFromFacts(facts: readonly RawFact[]): CallStance | null {
  const byCustomer = facts.filter((f) => f.speaker === 'customer')
  if (byCustomer.some((f) => f.key === 'not_interested')) return 'not_interested'
  if (byCustomer.some((f) => f.key === 'not_ready_now')) return 'not_now'
  return null
}

/**
 * 把表态合并进触点 metadata。前提：这条触点挂的正是这份分析，且这份分析没被人驳回。
 * 并发保护见 `mergeTouchpointMetadata`。
 */
export function writeCallStance(input: {
  touchpointId: string
  clientId: string
  analysisId: string
  stance: CallStance
}): Promise<MetadataMergeOutcome> {
  return mergeTouchpointMetadata({
    touchpointId: input.touchpointId,
    clientId: input.clientId,
    decide: (md) => {
      if (md.call_analysis_id !== input.analysisId) return null
      if (md.call_analysis_review === 'rejected') return null
      if (md.call_stance === input.stance) return null
      return { call_stance: input.stance }
    },
  })
}

/**
 * 人工复核改了分析状态 → 同步到挂着这份分析的触点上（`call_analysis_review`）。
 *
 * 为什么要同步：触点上的 `call_analysis_review` 以前只在分析刚出来时写一次 `pending_review`，
 * 之后复核驳回不会回写 —— CRM 读触点时根本不知道这份分析被驳回了，表态就会照样生效。
 * 尽力而为：失败只记日志，复核本身已经成功。
 */
export async function mirrorReviewToTouchpoints(input: {
  clientId: string
  analysisId: string
  review: 'confirmed' | 'rejected' | 'pending_review'
}): Promise<void> {
  try {
    await mirrorReview(input)
  } catch (e) {
    console.error('[call-stance] 复核状态同步到触点失败:', e instanceof Error ? e.message : 'unknown')
  }
}

async function mirrorReview(input: Parameters<typeof mirrorReviewToTouchpoints>[0]): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('metadata->>call_analysis_id', input.analysisId)
  if (error) {
    console.error('[call-stance] 找触点失败，复核状态没同步到 CRM:', error.message)
    return
  }
  for (const row of (data ?? []) as { id: string }[]) {
    try {
      await mergeTouchpointMetadata({
        touchpointId: row.id,
        clientId: input.clientId,
        decide: (md) =>
          md.call_analysis_id === input.analysisId && md.call_analysis_review !== input.review
            ? { call_analysis_review: input.review }
            : null,
      })
    } catch (e) {
      console.error('[call-stance] 复核状态同步到触点失败:', e instanceof Error ? e.message : 'unknown')
    }
  }
}
