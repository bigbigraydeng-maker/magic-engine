// Reel 授权后单条转公开 — 动作编排。设计稿:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
// 平台共享:适用于任何配了 publish_target 的客户;本文件不含客户名/工单 id。
// 🔴 本动作绕过 FACTORY_PUBLISH_LIVE 这道全局阀,改由「按条授权(预览→一次性令牌→确认)」负责(设计稿狄仁杰 L5)。

import { buildReelFirstComment } from '@/lib/social/reel-publishing'
import { sanitizeFailReason } from '../publish-display'
import { asRecord, emailSlot, hashToken, hashesEqual } from './guards'
import { buildContext, type PromoteContext } from './context'
import { decidePublished, finishStage, writeOrder, writeTraffic } from './publish-steps'
import { mutatePayload, readAuth, withAuth } from './payload-lock'
import {
  CLAIM_LEASE_MS, PREVIEW_TTL_MS,
  type PreviewSlot, type PromoteDeps, type PromoteInput, type PromoteOrder, type PromoteResult, type PromotedData,
} from './types'

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

export async function runPromote(deps: PromoteDeps, input: PromoteInput): Promise<PromoteResult> {
  try {
    const order = await deps.store.loadOrder(input.orderId)
    if (!order) return fail(404, '找不到这个工单')
    const resumed = await resumeIfAlreadyPromoted(deps, order)
    if (resumed) return resumed
    const ctx = await buildContext(deps, order)
    if ('ok' in ctx) return ctx
    return input.confirm ? await confirmStage(deps, input, ctx) : await previewStage(deps, input, ctx)
  } catch (e) {
    return fail(500, `转公开出错: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`)
  }
}

function readSlots(payload: Record<string, unknown>): Record<string, PreviewSlot> {
  return asRecord(payload['promote_preview']) as Record<string, PreviewSlot>
}

/** 预览:只写预览令牌槽(按管理员邮箱分槽,两人同时预览互不覆盖)。 */
async function previewStage(deps: PromoteDeps, input: PromoteInput, ctx: PromoteContext): Promise<PromoteResult> {
  const token = deps.randomToken()
  const expiresAt = new Date(deps.now().getTime() + PREVIEW_TTL_MS).toISOString()
  const slot: PreviewSlot = {
    token_hash: hashToken(token), work_order_id: ctx.order.id, fingerprint: ctx.fingerprint, expires_at: expiresAt, used: false,
  }
  const key = emailSlot(input.adminEmail)
  const nowMs = deps.now().getTime()
  const written = await mutatePayload(deps, ctx.row, (cur) => {
    const live = Object.fromEntries(Object.entries(readSlots(cur)).filter(([, s]) => Date.parse(s.expires_at) > nowMs))
    return { ...cur, promote_preview: { ...live, [key]: slot } }
  }, 3)
  if (!written.ok) return fail(409, '预览没记上(有别的请求同时在改),请再点一次预览')
  return {
    ok: true, kind: 'preview',
    data: {
      preview_token: token, expires_at: expiresAt, mode: ctx.view.published ? 'sync_only' : 'promote',
      page_id: ctx.pageId, video_id: ctx.videoId, caption: ctx.view.description, first_comment: ctx.firstComment,
      checklist_passed_at: ctx.approvedAt,
    },
  }
}

/** 校验令牌:哈希匹配、同一邮箱槽、未过期、未用过、指纹一致。 */
function checkToken(deps: PromoteDeps, input: PromoteInput, ctx: PromoteContext, payload: Record<string, unknown>): Fail | null {
  const slot = readSlots(payload)[emailSlot(input.adminEmail)]
  if (!input.previewToken || !slot) return fail(403, '请先点「预览」拿确认令牌,不能跳过预览直接确认')
  if (!hashesEqual(slot.token_hash, hashToken(input.previewToken))) return fail(403, '确认令牌不对(只有点预览的那位管理员能用)')
  if (slot.used) return fail(409, '这个确认令牌已经用过了,请重新预览')
  if (Date.parse(slot.expires_at) <= deps.now().getTime()) return fail(409, '确认令牌已过期(5 分钟),请重新预览')
  if (slot.work_order_id !== ctx.order.id) return fail(403, '确认令牌不是给这个工单的')
  if (slot.fingerprint !== ctx.fingerprint) return fail(409, '预览之后内容变了(草稿文案/首评/审片记录),请重新预览')
  return null
}

/** 抢占授权:同一次写入里标令牌已用 + 写 claimed;只试 1 次,失败直接 409。 */
async function claim(deps: PromoteDeps, input: PromoteInput, ctx: PromoteContext, requestId: string): Promise<{ payload: Record<string, unknown> } | Fail> {
  const nowIso = deps.now().toISOString()
  const key = emailSlot(input.adminEmail)
  const res = await mutatePayload(deps, ctx.row, (cur) => {
    const tokenFail = checkToken(deps, input, ctx, cur)
    if (tokenFail) return tokenFail.error
    const prior = readAuth(cur)
    const leaseLive = prior.status === 'claimed' && Date.parse(prior.claimed_at ?? '') + CLAIM_LEASE_MS > deps.now().getTime()
    if (leaseLive) return '另一个请求正在处理这条(5 分钟内),请稍后'
    if (prior.status === 'consumed') return '这条已经转过公开了'
    const slots = readSlots(cur)
    return withAuth({ ...cur, promote_preview: { ...slots, [key]: { ...slots[key], used: true } } }, {
      authorized_by: input.adminEmail, authorized_at: nowIso, work_order_id: ctx.order.id, video_id: ctx.videoId,
      page_id: ctx.pageId, fingerprint: ctx.fingerprint, request_id: requestId, status: 'claimed', claimed_at: nowIso,
      promote_called_at: prior.promote_called_at,
    })
  }, 1)
  if (res.ok) return { payload: res.payload }
  return fail(409, res.message)
}

async function confirmStage(deps: PromoteDeps, input: PromoteInput, ctx: PromoteContext): Promise<PromoteResult> {
  const requestId = deps.uuid()
  const claimed = await claim(deps, input, ctx, requestId)
  if ('ok' in claimed) return claimed
  const facts = await decidePublished(deps, ctx, claimed.payload)
  if ('ok' in facts) return facts
  const trafficFail = await writeTraffic(deps, ctx, facts)
  if (trafficFail) return trafficFail
  const orderFail = await writeOrder(deps, ctx, facts, requestId)
  if (orderFail) return orderFail
  const done = await finishStage(deps, {
    orderId: ctx.order.id, clientId: ctx.order.client_id, masterBriefId: ctx.order.master_brief_id ?? '',
    target: ctx.target, videoId: ctx.videoId, firstComment: ctx.firstComment, rowId: ctx.row.id,
  })
  const data: PromotedData = {
    video_id: ctx.videoId, published_at: facts.publishedAt, published_at_estimated: facts.estimated,
    permalink: facts.permalink, first_comment_status: done.firstCommentStatus, request_id: requestId,
  }
  return { ok: true, kind: facts.synced ? 'synced' : 'promoted', data }
}

/**
 * 上次已把工单写成公开(本动作盖的 promote_request_id),但补首评/收尾回执没做完:
 * 补做这两步即可。不再调 Meta 转公开、不需要新令牌(授权在上次已经按条记过)。
 */
async function resumeIfAlreadyPromoted(deps: PromoteDeps, order: PromoteOrder): Promise<PromoteResult | null> {
  const ref = asRecord(order.published_ref)
  const requestId = ref['promote_request_id']
  if (order.status !== 'published' || ref['video_state'] !== 'PUBLISHED' || typeof requestId !== 'string') return null
  const rows = await deps.store.loadTrafficRows(order.id, order.client_id)
  if (rows.length !== 1) return null
  const auth = readAuth(asRecord(rows[0].payload))
  if (auth.request_id !== requestId) return null
  if (auth.status === 'consumed') return fail(409, '这条已经转过公开了')
  const target = await deps.resolveTarget(order.client_id)
  const videoId = typeof ref['video_id'] === 'string' ? ref['video_id'] : ''
  const copy = asRecord(asRecord(order.brief)['copy'])
  const first = buildReelFirstComment(asRecord(copy['endcard']), order.id)
  if (!target || !videoId || !first || !order.master_brief_id) return fail(422, '补做收尾所需的配置缺失')
  const done = await finishStage(deps, {
    orderId: order.id, clientId: order.client_id, masterBriefId: order.master_brief_id, target, videoId, firstComment: first.text, rowId: rows[0].id,
  })
  const data: PromotedData = {
    video_id: videoId, published_at: String(ref['published_at'] ?? ''), published_at_estimated: ref['published_at_estimated'] === true,
    permalink: typeof ref['permalink'] === 'string' ? ref['permalink'] : null, first_comment_status: done.firstCommentStatus, request_id: requestId,
  }
  return { ok: true, kind: 'synced', data }
}
