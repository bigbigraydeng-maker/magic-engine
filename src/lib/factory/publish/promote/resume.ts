// 已公开之后的收尾入口:补首评(首评失败后重试)与补做收尾回执。
// 与草稿转公开共用令牌/抢占/栅栏;不调 Meta 转公开,只补首评、回读红线、写回执。

import { buildReelFirstComment } from '@/lib/social/reel-publishing'
import { asRecord, computeFingerprint, redlineSurface } from './guards'
import { finishStage, type FinishInput } from './publish-steps'
import { readAuth } from './payload-lock'
import type { ClaimIds, ClaimTarget } from './action'
import {
  CLAIM_LEASE_MS,
  type PromoteDeps, type PromoteInput, type PromoteOrder, type PromoteResult, type PromotedData,
} from './types'

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

export interface ResumeContext {
  ok: true
  claimTarget: ClaimTarget
  finish: FinishInput
  approvedAt: string
  requestId: string
  /** true = 上次已完成但首评失败(补首评);false = 上次收尾没做完(补收尾)。 */
  commentRetry: boolean
  publishedAt: string
  estimated: boolean
  permalink: string | null
}

/**
 * 本动作自己转公开过的工单(工单上有 promote_request_id,且与流量记录回执对得上)才进这里。
 * 返回 null = 不是,走草稿转公开的正常前置校验;返回 Fail = 是,但现在不能做。
 */
export async function resumeContext(deps: PromoteDeps, order: PromoteOrder): Promise<ResumeContext | Fail | null> {
  const ref = asRecord(order.published_ref)
  const requestId = ref['promote_request_id']
  if (order.status !== 'published' || ref['video_state'] !== 'PUBLISHED' || typeof requestId !== 'string') return null
  const rows = await deps.store.loadTrafficRows(order.id, order.client_id)
  if (rows.length !== 1) return null
  const auth = readAuth(asRecord(rows[0].payload))
  if (auth.request_id !== requestId) return null
  const commentRetry = auth.status === 'consumed' && auth.first_comment_status === 'failed'
  if (auth.status === 'consumed' && !commentRetry) return fail(409, '这条已经转过公开了,首评也已发好')
  if (auth.status === 'claimed' && Date.parse(auth.claimed_at ?? '') + CLAIM_LEASE_MS > deps.now().getTime()) {
    return fail(409, '另一个请求正在处理这条(5 分钟内),请稍后')
  }
  return buildResume(deps, order, rows[0], requestId, commentRetry)
}

async function buildResume(deps: PromoteDeps, order: PromoteOrder, row: ResumeContext['claimTarget']['row'], requestId: string, commentRetry: boolean): Promise<ResumeContext | Fail> {
  const ref = asRecord(order.published_ref)
  const target = await deps.resolveTarget(order.client_id)
  const videoId = typeof ref['video_id'] === 'string' ? ref['video_id'] : ''
  const pageId = typeof ref['page_id'] === 'string' ? ref['page_id'] : ''
  const copy = asRecord(asRecord(order.brief)['copy'])
  const first = buildReelFirstComment(asRecord(copy['endcard']), order.id)
  const approvedAt = asRecord(order.review_ref)['approved_at']
  if (!target || target.platform !== 'facebook' || target.page_id !== pageId || !target.expect_brand) return fail(422, '发布目标缺失或与工单主页不一致,不能补做收尾')
  if (!videoId || !first || !order.master_brief_id || typeof approvedAt !== 'string') return fail(422, '补做收尾所需的配置缺失')
  const hit = await deps.scanRedline(order.client_id, order.master_brief_id, redlineSurface(first.text))
  if (hit) return fail(422, `首评命中红线,不能发送: ${hit}`)
  const fingerprint = computeFingerprint({ videoId, description: '', firstComment: first.text, approvedAt })
  return {
    ok: true, claimTarget: { orderId: order.id, row, fingerprint, videoId, pageId }, approvedAt, requestId, commentRetry,
    finish: { orderId: order.id, clientId: order.client_id, masterBriefId: order.master_brief_id, target, videoId, firstComment: first.text, rowId: row.id },
    publishedAt: String(ref['published_at'] ?? ''), estimated: ref['published_at_estimated'] === true,
    permalink: typeof ref['permalink'] === 'string' ? ref['permalink'] : null,
  }
}

type Claim = (deps: PromoteDeps, input: PromoteInput, t: ClaimTarget, ids: ClaimIds) => Promise<{ payload: Record<string, unknown> } | Fail>

export async function runResumeConfirm(deps: PromoteDeps, input: PromoteInput, rc: ResumeContext, claim: Claim, attemptId: string): Promise<PromoteResult> {
  const claimed = await claim(deps, input, rc.claimTarget, { requestId: rc.requestId, attemptId, allowCommentRetry: rc.commentRetry })
  if ('ok' in claimed) return claimed
  const done = await finishStage(deps, rc.finish, attemptId)
  if (done.closed === 'fenced') return fail(409, '收尾被另一个请求接管了,请刷新页面查看结果')
  const data: PromotedData = {
    video_id: rc.claimTarget.videoId, published_at: rc.publishedAt, published_at_estimated: rc.estimated,
    permalink: rc.permalink, first_comment_status: done.firstCommentStatus, request_id: rc.requestId,
  }
  return { ok: true, kind: 'synced', data }
}
