/**
 * 通话分析 → 客人在电话里的表态（`call_stance`），写到这通电话的 CRM 触点上。
 *
 * 只认**已通过原话核验**、**说话人是客人**的事实；员工说的、分不清谁说的一律不算。
 * 两种都出现时取更明确的「不感兴趣」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { CallStance } from '@/lib/crm/segments'
import { mergeTouchpointMetadata, type MetadataMergeOutcome } from '@/lib/crm/touchpoint-metadata'
import { norm, STANCE_FACT_KEYS, type RawFact } from './analysis-schema'

/**
 * 客人在同一通电话里还**要了东西**（约了下一步 / 给了邮箱 / 约了回电时间 / 说了想去哪）——
 * 他不是「先放着」的人，照常走通话后的提醒（复审 2026-10-29 的两句真实说法：
 * "I'm not ready to book yet but send me the brochure"、"I am not interested in Japan, I want China."）。
 * 下一步 / 邮箱 / 回电只要不是员工说的就算（分不清谁说的宁可当客人要的，不把人挪走）；
 * 目的地必须是客人自己说的（员工介绍线路不算）。
 */
const STILL_WANTS_KEYS: ReadonlySet<string> = new Set(['next_step', 'contact_email', 'callback_time'])
/** 只有「下一步 / 回电时间」可能只是一句推托；邮箱永远算真要了东西。 */
const MAYBE_DEFERRAL_KEYS: ReadonlySet<string> = new Set(['next_step', 'callback_time'])

/**
 * 真的要了东西：发资料 / 发邮件 / 指定时间回电。命中它的「下一步」永远挡住表态，
 * 哪怕原话跟表态是同一句（"I'm not ready to book yet but send me the brochure"）。
 */
const REAL_REQUEST = /\b(?:send|email|e-mail|mail|text)\b|brochure|catalog(?:ue)?|\binfo(?:rmation)?\b|details|itinerar|quote|\bcall me\b.*\b(?:on|at|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)|发(?:给)?我|寄|邮件|邮箱|资料|行程|报价|(?:周|星期|礼拜)[一二三四五六日天]|\d+\s*点/i
/** 只是推托：改天 / 以后 / 再联系。（复审 2026-10-29：模型会从 Gavin 那句里再抽一条「改天再聊」当下一步。） */
const DEFERRAL_ONLY = /another day|another time|some other time|\blater\b|\bsome ?time\b|get back to you|be in touch|改天|以后再说|下次再说|回头再说|再联系|过阵子|以后/i

/** 两段原话归一化后互相包含 = 说的是同一句。 */
function overlaps(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x))
}

/** 这条「下一步 / 回电」只是表态本身的推托，不算客人还要了东西。 */
function isJustDeferral(f: RawFact, stanceQuotes: readonly string[]): boolean {
  if (!MAYBE_DEFERRAL_KEYS.has(f.key)) return false
  const text = `${f.value} ${f.quote}`
  if (REAL_REQUEST.test(text)) return false
  return stanceQuotes.some((q) => overlaps(q, f.quote)) || DEFERRAL_ONLY.test(text)
}

function stillAskedForSomething(facts: readonly RawFact[]): boolean {
  const stanceQuotes = facts.filter((f) => STANCE_FACT_KEYS.has(f.key)).map((f) => f.quote)
  return facts.some(
    (f) =>
      (STILL_WANTS_KEYS.has(f.key) && f.speaker !== 'employee' && !isJustDeferral(f, stanceQuotes)) ||
      (f.key === 'destination_or_tour' && f.speaker === 'customer'),
  )
}

export function callStanceFromFacts(facts: readonly RawFact[]): CallStance | null {
  if (stillAskedForSomething(facts)) return null
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

/** 复核状态同步到触点的结果：`ok` = 都同步了（或没有挂这份分析的触点）。 */
export type ReviewSyncResult = 'ok' | 'conflict' | 'failed'

/**
 * 人工复核改了分析状态 → 同步到挂着这份分析的触点上（`call_analysis_review`）。
 *
 * 为什么要同步：触点上的 `call_analysis_review` 以前只在分析刚出来时写一次 `pending_review`，
 * 之后复核驳回不会回写 —— CRM 读触点时根本不知道这份分析被驳回了，表态就会照样生效。
 * 不抛错（复核本身已经成功），但**结果要交回去**：同步失败不能只死在日志里，调用方要让人看得见。
 */
export async function mirrorReviewToTouchpoints(input: {
  clientId: string
  analysisId: string
  review: 'confirmed' | 'rejected' | 'pending_review'
}): Promise<ReviewSyncResult> {
  try {
    return await mirrorReview(input)
  } catch (e) {
    console.error('[call-stance] 复核状态同步到触点失败:', e instanceof Error ? e.message : 'unknown')
    return 'failed'
  }
}

async function mirrorReview(input: Parameters<typeof mirrorReviewToTouchpoints>[0]): Promise<ReviewSyncResult> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('metadata->>call_analysis_id', input.analysisId)
  if (error) {
    console.error('[call-stance] 找触点失败，复核状态没同步到 CRM:', error.message)
    return 'failed'
  }
  let result: ReviewSyncResult = 'ok'
  for (const row of (data ?? []) as { id: string }[]) {
    try {
      const outcome = await mergeTouchpointMetadata({
        touchpointId: row.id,
        clientId: input.clientId,
        decide: (md) =>
          md.call_analysis_id === input.analysisId && md.call_analysis_review !== input.review
            ? { call_analysis_review: input.review }
            : null,
      })
      if (outcome === 'conflict' && result === 'ok') result = 'conflict'
    } catch (e) {
      console.error('[call-stance] 复核状态同步到触点失败:', e instanceof Error ? e.message : 'unknown')
      result = 'failed'
    }
  }
  return result
}
