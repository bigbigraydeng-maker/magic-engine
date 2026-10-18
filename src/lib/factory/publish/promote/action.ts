// Reel 授权后单条转公开 — 动作编排。设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
// 平台共享:适用于任何配了 publish_target 的客户;本文件不含客户名/工单 id。
// 🔴 本动作绕过 FACTORY_PUBLISH_LIVE 这道全局阀,改由「按条授权(预览→一次性令牌→确认)」负责(设计稿狄仁杰 L5)。
// 两种入口共用同一套令牌/抢占/栅栏:① 草稿转公开(buildContext);② 已公开后的收尾(resume.ts:补首评)。

import { sanitizeFailReason } from '../publish-display'
import { asRecord, emailSlot, hashToken, hashesEqual } from './guards'
import { buildContext, type PromoteContext } from './context'
import { decidePublished, finishStage, writeOrder, writeTraffic } from './publish-steps'
import { mutatePayload, readAuth, withAuth } from './payload-lock'
import { resumeContext, runResumeConfirm, type ResumeContext } from './resume'
import {
  CLAIM_LEASE_MS, PREVIEW_TTL_MS,
  type PreviewData, type PreviewSlot, type PromoteDeps, type PromoteInput, type PromoteResult, type PromotedData, type TrafficRow,
} from './types'

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

/** 令牌与抢占所需的最小事实(草稿转公开与补首评两种入口共用)。 */
export interface ClaimTarget {
  orderId: string
  row: TrafficRow
  fingerprint: string
  videoId: string
  pageId: string
}

export async function runPromote(deps: PromoteDeps, input: PromoteInput): Promise<PromoteResult> {
  try {
    const order = await deps.store.loadOrder(input.orderId)
    if (!order) return fail(404, '找不到这个工单')
    const resume = await resumeContext(deps, order)
    if (resume) return resume.ok ? await resumeStage(deps, input, resume as ResumeContext) : resume as Fail
    const ctx = await buildContext(deps, order)
    if ('ok' in ctx) return ctx
    return input.confirm ? await confirmStage(deps, input, ctx) : await previewStage(deps, input, claimTargetOf(ctx), previewDataOf(ctx))
  } catch (e) {
    return fail(500, `转公开出错: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`)
  }
}

const claimTargetOf = (ctx: PromoteContext): ClaimTarget => ({
  orderId: ctx.order.id, row: ctx.row, fingerprint: ctx.fingerprint, videoId: ctx.videoId, pageId: ctx.pageId,
})

const previewDataOf = (ctx: PromoteContext): Omit<PreviewData, 'preview_token' | 'expires_at'> => ({
  mode: ctx.view.published ? 'sync_only' : 'promote', page_id: ctx.pageId, video_id: ctx.videoId,
  caption: ctx.view.description, first_comment: ctx.firstComment, checklist_passed_at: ctx.approvedAt,
})

function readSlots(payload: Record<string, unknown>): Record<string, PreviewSlot> {
  return asRecord(payload['promote_preview']) as Record<string, PreviewSlot>
}

/** 预览:只写预览令牌槽(按管理员邮箱分槽,两人同时预览互不覆盖)。不做任何业务写入。 */
export async function previewStage(deps: PromoteDeps, input: PromoteInput, t: ClaimTarget, data: Omit<PreviewData, 'preview_token' | 'expires_at'>): Promise<PromoteResult> {
  const token = deps.randomToken()
  const expiresAt = new Date(deps.now().getTime() + PREVIEW_TTL_MS).toISOString()
  const slot: PreviewSlot = { token_hash: hashToken(token), work_order_id: t.orderId, fingerprint: t.fingerprint, expires_at: expiresAt, used: false }
  const key = emailSlot(input.adminEmail)
  const nowMs = deps.now().getTime()
  const written = await mutatePayload(deps, t.row, (cur) => {
    const live = Object.fromEntries(Object.entries(readSlots(cur)).filter(([, s]) => Date.parse(s.expires_at) > nowMs))
    return { ...cur, promote_preview: { ...live, [key]: slot } }
  }, 3)
  if (!written.ok) return fail(409, '预览没记上(有别的请求同时在改),请再点一次预览')
  return { ok: true, kind: 'preview', data: { ...data, preview_token: token, expires_at: expiresAt } }
}

/** 校验令牌:哈希匹配、同一邮箱槽、未过期、未用过、指纹一致。 */
function checkToken(deps: PromoteDeps, input: PromoteInput, t: ClaimTarget, payload: Record<string, unknown>): Fail | null {
  const slot = readSlots(payload)[emailSlot(input.adminEmail)]
  if (!input.previewToken || !slot) return fail(403, '请先点「预览」拿确认令牌,不能跳过预览直接确认')
  if (!hashesEqual(slot.token_hash, hashToken(input.previewToken))) return fail(403, '确认令牌不对(只有点预览的那位管理员能用)')
  if (slot.used) return fail(409, '这个确认令牌已经用过了,请重新预览')
  if (Date.parse(slot.expires_at) <= deps.now().getTime()) return fail(409, '确认令牌已过期(5 分钟),请重新预览')
  if (slot.work_order_id !== t.orderId) return fail(403, '确认令牌不是给这个工单的')
  if (slot.fingerprint !== t.fingerprint) return fail(409, '预览之后内容变了(草稿文案/首评/审片记录),请重新预览')
  return null
}

export interface ClaimIds {
  requestId: string
  attemptId: string
  /** 仅「补首评」入口:允许在已完成(consumed)但首评失败的回执上再次抢占。 */
  allowCommentRetry?: boolean
}

/** 抢占授权:同一次写入里标令牌已用 + 写 claimed + 换新栅栏;只试 1 次,失败直接 409。 */
export async function claim(deps: PromoteDeps, input: PromoteInput, t: ClaimTarget, ids: ClaimIds): Promise<{ payload: Record<string, unknown> } | Fail> {
  const early = checkToken(deps, input, t, asRecord(t.row.payload)) // 先用已读到的值给出准确的状态码,下面在最新值上再核一遍
  if (early) return early
  const nowIso = deps.now().toISOString()
  const key = emailSlot(input.adminEmail)
  const res = await mutatePayload(deps, t.row, (cur) => {
    const tokenFail = checkToken(deps, input, t, cur)
    if (tokenFail) return tokenFail.error
    const prior = readAuth(cur)
    const leaseLive = prior.status === 'claimed' && Date.parse(prior.claimed_at ?? '') + CLAIM_LEASE_MS > deps.now().getTime()
    if (leaseLive) return '另一个请求正在处理这条(5 分钟内),请稍后'
    const retryOk = ids.allowCommentRetry === true && prior.status === 'consumed' && prior.first_comment_status === 'failed'
    if (prior.status === 'consumed' && !retryOk) return '这条已经转过公开了'
    const slots = readSlots(cur)
    return withAuth({ ...cur, promote_preview: { ...slots, [key]: { ...slots[key], used: true } } }, {
      authorized_by: input.adminEmail, authorized_at: nowIso, work_order_id: t.orderId, video_id: t.videoId,
      page_id: t.pageId, fingerprint: t.fingerprint, request_id: ids.requestId, attempt_id: ids.attemptId,
      status: 'claimed', claimed_at: nowIso, promote_called_at: prior.promote_called_at,
    })
  }, 1)
  return res.ok ? { payload: res.payload } : fail(409, res.message)
}

async function confirmStage(deps: PromoteDeps, input: PromoteInput, ctx: PromoteContext): Promise<PromoteResult> {
  const requestId = deps.uuid()
  const claimed = await claim(deps, input, claimTargetOf(ctx), { requestId, attemptId: requestId })
  if ('ok' in claimed) return claimed
  const facts = await decidePublished(deps, ctx, claimed.payload, requestId)
  if ('ok' in facts) return facts
  const trafficFail = await writeTraffic(deps, ctx, facts, requestId)
  if (trafficFail) return trafficFail
  const orderFail = await writeOrder(deps, ctx, facts, requestId, requestId)
  if (orderFail) return orderFail
  const done = await finishStage(deps, {
    orderId: ctx.order.id, clientId: ctx.order.client_id, masterBriefId: ctx.order.master_brief_id ?? '',
    target: ctx.target, videoId: ctx.videoId, firstComment: ctx.firstComment, rowId: ctx.row.id,
  }, requestId)
  if (done.closed === 'fenced') return fail(409, '收尾被另一个请求接管了,请刷新页面查看结果')
  const data: PromotedData = {
    video_id: ctx.videoId, published_at: facts.publishedAt, published_at_estimated: facts.estimated,
    permalink: facts.permalink, first_comment_status: done.firstCommentStatus, request_id: requestId,
  }
  return { ok: true, kind: facts.synced ? 'synced' : 'promoted', data }
}

/** 已公开后的收尾(补首评/补回执):预览只发令牌,绝不执行;确认才执行,且同样要令牌、抢占与栅栏。 */
async function resumeStage(deps: PromoteDeps, input: PromoteInput, rc: ResumeContext): Promise<PromoteResult> {
  if (!input.confirm) {
    return previewStage(deps, input, rc.claimTarget, {
      mode: 'comment_only', page_id: rc.claimTarget.pageId, video_id: rc.claimTarget.videoId,
      caption: '', first_comment: rc.finish.firstComment, checklist_passed_at: rc.approvedAt,
    })
  }
  return runResumeConfirm(deps, input, rc, claim, deps.uuid())
}
