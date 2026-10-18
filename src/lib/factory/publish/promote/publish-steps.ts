// 转公开动作的执行阶段:调 Meta → 先写流量记录 → 再写工单 → 补首评 → 回读红线 → 收尾回执。
// 顺序不许调换(设计稿第 2 节第 7 步):补发任务只看工单,先写流量记录再写工单,
// 它看到 PUBLISHED 时流量记录一定已对齐,发布事件不会被适配器以 not_published 拒绝。

import { sanitizeFailReason } from '../publish-display'
import { asRecord, redlineSurface } from './guards'
import { mutatePayload, readAuth, withAuth } from './payload-lock'
import type { PromoteContext } from './context'
import type { PromoteDeps, PromoteResult } from './types'

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })
const iso = (deps: PromoteDeps): string => deps.now().toISOString()

export interface PublishedFacts {
  publishedAt: string
  estimated: boolean
  permalink: string | null
  /** true = 本次没有调用 Meta 转公开(早已公开或上次已完成)。 */
  synced: boolean
}

/** 决定 published_at 并在需要时真正调 Meta。已公开分支绝不用 now(会让老帖子「变新」)。 */
export async function decidePublished(deps: PromoteDeps, ctx: PromoteContext, claimed: Record<string, unknown>): Promise<PublishedFacts | Fail> {
  const ref = { id: ctx.row.id, client_id: ctx.row.client_id }
  // 重入沿用已写的值:7.1 成功、7.2 失败后再来,两处时间必须一致
  if (claimed['video_state'] === 'PUBLISHED' && typeof claimed['published_at'] === 'string') {
    return {
      publishedAt: claimed['published_at'], estimated: claimed['published_at_estimated'] === true,
      permalink: typeof claimed['permalink'] === 'string' ? claimed['permalink'] : null, synced: true,
    }
  }
  const calledAt = readAuth(claimed).promote_called_at
  if (ctx.view.published) {
    const at = calledAt ?? ctx.view.updatedTime
    if (!at) return fail(409, '这条视频已被人手公开,但读不到真实发布时间,保守拒绝(不用现在时间冒充)')
    return { publishedAt: at, estimated: true, permalink: ctx.view.permalink, synced: true }
  }
  const stamped = await mutatePayload(deps, ref, (cur) => withAuth(cur, { promote_called_at: iso(deps) }), 3)
  if (!stamped.ok) return fail(409, '写调用时间失败,未调用 Facebook')
  try {
    const out = await deps.meta.promote(ctx.target, ctx.videoId)
    return { publishedAt: out.published_at, estimated: false, permalink: out.permalink ?? ctx.view.permalink, synced: false }
  } catch (e) {
    const reason = sanitizeFailReason(e instanceof Error ? e.message : String(e))
    await mutatePayload(deps, ref, (cur) => withAuth(cur, { status: 'failed', fail_reason: reason }), 3)
    return fail(502, `转公开失败,工单仍是草稿,可以重新预览再试: ${reason}`)
  }
}

/** 7.1 先写流量记录:video_state / published_at / permalink 对齐,读-改-写合并,不整体覆盖。 */
export async function writeTraffic(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts): Promise<Fail | null> {
  const ref = { id: ctx.row.id, client_id: ctx.row.client_id }
  const done = await mutatePayload(deps, ref, (cur) => ({
    ...withAuth(cur, {
      status: 'meta_published_db_pending', published_at: facts.publishedAt,
      published_at_estimated: facts.estimated, late_backfill: facts.estimated,
    }),
    video_state: 'PUBLISHED', published_at: facts.publishedAt, published_at_estimated: facts.estimated,
    ...(facts.permalink ? { permalink: facts.permalink } : {}),
  }), 3)
  if (done.ok) return null
  deps.alert(`Meta 已公开但流量记录写库失败 order=${ctx.order.id} (${done.message})`)
  return fail(500, 'Facebook 已公开,但写库失败;请再点一次「转公开」同步(不会重复调用 Facebook)')
}

/** 7.2 再写工单 published_ref:写前重读,拿新读到的 updated_at 比对,最多 3 次。 */
export async function writeOrder(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts, requestId: string): Promise<Fail | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await deps.store.loadOrder(ctx.order.id)
    if (!fresh || fresh.status !== 'published') return fail(409, '工单状态在转公开过程中变了,请核对')
    const cur = asRecord(fresh.published_ref)
    if (cur['video_state'] === 'PUBLISHED' && cur['promote_request_id'] === requestId) return null
    if (cur['video_state'] !== 'DRAFT') return fail(409, '工单已不是草稿状态,请核对')
    const next: Record<string, unknown> = {
      ...cur, video_state: 'PUBLISHED', published_at: facts.publishedAt, ig_crosspost_blocked: true,
      promote_request_id: requestId,
      ...(facts.permalink ? { permalink: facts.permalink } : {}),
      ...(facts.estimated ? { published_at_estimated: true } : {}),
    }
    delete next['event_ids'] // 清掉旧发布信号回执,补发任务才会重新发
    if (!facts.estimated) delete next['published_at_estimated']
    if (await deps.store.writeOrderPublishedRef(ctx.order.id, fresh.updated_at, next)) return null
  }
  deps.alert(`Meta 已公开但工单写库失败 order=${ctx.order.id}`)
  return fail(500, 'Facebook 已公开,流量记录已对齐,但工单没写成功;请再点一次「转公开」')
}

export interface FinishInput {
  orderId: string
  clientId: string
  masterBriefId: string
  target: PromoteContext['target']
  videoId: string
  firstComment: string
  rowId: string
}

/** 补首评(永远执行,自带幂等)→ 转公开后回读重扫红线 → 收尾回执。失败都不回滚公开。 */
export async function finishStage(deps: PromoteDeps, f: FinishInput): Promise<{ firstCommentStatus: 'ok' | 'failed'; commentId: string | null }> {
  let commentId: string | null = null
  try {
    commentId = await deps.meta.ensureFirstComment({ target: f.target, videoId: f.videoId, idempotencyTag: f.orderId, message: f.firstComment })
  } catch (e) {
    deps.alert(`首评补发失败 order=${f.orderId}: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`)
  }
  let redlineHit: string | undefined
  try {
    const after = await deps.meta.readReel(f.target, f.videoId)
    const hit = await deps.scanRedline(f.clientId, f.masterBriefId, `${redlineSurface(after.description)}\n${redlineSurface(f.firstComment)}`)
    if (hit) { redlineHit = hit; deps.alert(`转公开后回读命中红线 order=${f.orderId}: ${hit}`) }
  } catch (e) {
    deps.alert(`转公开后回读失败 order=${f.orderId}: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`)
  }
  const status = commentId ? 'ok' : 'failed'
  const closed = await mutatePayload(deps, { id: f.rowId, client_id: f.clientId }, (cur) => ({
    ...withAuth(cur, {
      status: 'consumed', first_comment_status: status,
      needs_attention: status === 'failed' || redlineHit !== undefined,
      ...(redlineHit ? { post_publish_redline_hit: redlineHit } : {}),
    }),
    ...(commentId ? { first_comment_id: commentId } : {}),
  }), 3)
  if (!closed.ok) deps.alert(`收尾回执写入失败 order=${f.orderId}`)
  return { firstCommentStatus: status, commentId }
}
