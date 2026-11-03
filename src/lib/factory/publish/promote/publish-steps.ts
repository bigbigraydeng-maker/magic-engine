// 转公开动作的执行阶段:调 Meta → 先写流量记录 → 再写工单 → 补首评 → 回读红线 → 收尾回执。
// 顺序不许调换(设计稿第 2 节第 7 步):补发任务只看工单,先写流量记录再写工单,
// 它看到 PUBLISHED 时流量记录一定已对齐,发布事件不会被适配器以 not_published 拒绝。
//
// 租约与栅栏:抢占后授权状态一直保持 claimed,直到收尾写成 consumed(或失败时显式释放成 failed /
// meta_published_db_pending);所有写入都带 attempt_id 栅栏,被别的请求接管就中止。

import { sanitizeFailReason } from '../publish-display'
import { asRecord, redlineSurface } from './guards'
import { fenced, mutatePayload, readAuth, withAuth } from './payload-lock'
import type { PromoteContext } from './context'
import type { AuthorizationStatus, PromoteDeps, PromoteResult } from './types'

type Fail = Extract<PromoteResult, { ok: false }>
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })
const iso = (deps: PromoteDeps): string => deps.now().toISOString()
const msgOf = (e: unknown): string => sanitizeFailReason(e instanceof Error ? e.message : String(e))

export interface PublishedFacts {
  publishedAt: string
  estimated: boolean
  permalink: string | null
  /** true = 本次没有调用 Meta 转公开(早已公开或上次已完成)。 */
  synced: boolean
}

/** 显式释放租约(失败时立即可重试),并可顺带保留已知的真实发布时间。尽力而为,栅栏不符则不写。 */
export async function releaseLease(
  deps: PromoteDeps, ref: { id: string; client_id: string }, attemptId: string,
  status: AuthorizationStatus, reason: string, keep: Partial<{ published_at: string; published_at_estimated: boolean }> = {},
): Promise<void> {
  await mutatePayload(deps, ref, fenced(attemptId, (cur) => withAuth(cur, {
    status, fail_reason: sanitizeFailReason(reason), promote_called_at: undefined, ...keep,
  })), 3)
}

/** 决定 published_at 并在需要时真正调 Meta。已公开分支绝不用 now(会让老帖子「变新」)。 */
export async function decidePublished(deps: PromoteDeps, ctx: PromoteContext, claimed: Record<string, unknown>, attemptId: string): Promise<PublishedFacts | Fail> {
  const ref = { id: ctx.row.id, client_id: ctx.row.client_id }
  const auth = readAuth(claimed)
  // 重入沿用已写的值:7.1 成功、7.2 失败后再来,两处时间必须一致
  if (claimed['video_state'] === 'PUBLISHED' && typeof claimed['published_at'] === 'string') {
    return {
      publishedAt: claimed['published_at'], estimated: claimed['published_at_estimated'] === true,
      permalink: typeof claimed['permalink'] === 'string' ? claimed['permalink'] : null, synced: true,
    }
  }
  if (ctx.view.published) return decideAlreadyPublic(deps, ctx, ref, attemptId, auth)
  const stamped = await mutatePayload(deps, ref, fenced(attemptId, (cur) => withAuth(cur, { promote_called_at: iso(deps) })), 3)
  if (!stamped.ok) return fail(409, '写调用时间失败或已被另一请求接管,未调用 Facebook')
  try {
    const out = await deps.meta.promote(ctx.target, ctx.videoId)
    return { publishedAt: out.published_at, estimated: out.published_at_estimated === true, permalink: out.permalink ?? ctx.view.permalink, synced: false }
  } catch (e) {
    const reason = msgOf(e)
    await releaseLease(deps, ref, attemptId, 'failed', reason)
    return fail(502, `转公开失败,工单仍是草稿,可以重新预览再试: ${reason}`)
  }
}

/** 视频在 Facebook 上已经公开(人手转过,或上次调用成功但没记上):取已知的真实时间,否则估算,再不行就拒绝。 */
async function decideAlreadyPublic(
  deps: PromoteDeps, ctx: PromoteContext, ref: { id: string; client_id: string }, attemptId: string,
  auth: ReturnType<typeof readAuth>,
): Promise<PublishedFacts | Fail> {
  const known = auth.published_at // 上次成功调用 Meta 时记下的真实值(写库失败时保留)
  if (known) return { publishedAt: known, estimated: auth.published_at_estimated === true, permalink: ctx.view.permalink, synced: true }
  const at = auth.promote_called_at ?? ctx.view.updatedTime
  if (!at) {
    await releaseLease(deps, ref, attemptId, 'failed', '已被人手公开但读不到真实发布时间')
    return fail(409, '这条视频已被人手公开,但读不到真实发布时间,保守拒绝(不用现在时间冒充)')
  }
  return { publishedAt: at, estimated: true, permalink: ctx.view.permalink, synced: true }
}

/** 7.1 先写流量记录:video_state / published_at / permalink 对齐,读-改-写合并。状态仍保持 claimed(租约不放)。 */
export async function writeTraffic(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts, attemptId: string): Promise<Fail | null> {
  const ref = { id: ctx.row.id, client_id: ctx.row.client_id }
  const done = await mutatePayload(deps, ref, fenced(attemptId, (cur) => ({
    ...withAuth(cur, { published_at: facts.publishedAt, published_at_estimated: facts.estimated, late_backfill: facts.estimated }),
    video_state: 'PUBLISHED', published_at: facts.publishedAt, published_at_estimated: facts.estimated,
    ...(facts.permalink ? { permalink: facts.permalink } : {}),
  })), 3)
  if (done.ok) return null
  if (done.reason === 'rejected') return fail(409, done.message)
  deps.alert(`Meta 已公开但流量记录写库失败 order=${ctx.order.id} (${done.message})`)
  // 释放租约以便立刻重试,并把已知的真实发布时间留在回执里(重入时沿用,不重取)
  await releaseLease(deps, ref, attemptId, 'failed', done.message, { published_at: facts.publishedAt, published_at_estimated: facts.estimated })
  return fail(500, 'Facebook 已公开,但写库失败;请再点一次「转公开」同步(不会重复调用 Facebook)')
}

/** 7.2 再写工单 published_ref:写前重读,拿新读到的 updated_at 比对,最多 3 次。失败时释放租约。 */
export async function writeOrder(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts, requestId: string, attemptId: string): Promise<Fail | null> {
  const failure = await writeOrderOnce(deps, ctx, facts, requestId)
  if (!failure) return null
  await releaseLease(deps, { id: ctx.row.id, client_id: ctx.row.client_id }, attemptId, 'meta_published_db_pending', failure.error)
  return failure
}

async function writeOrderOnce(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts, requestId: string): Promise<Fail | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await deps.store.loadOrder(ctx.order.id)
    if (!fresh || fresh.status !== 'published') return fail(409, '工单状态在转公开过程中变了,请核对')
    const cur = asRecord(fresh.published_ref)
    if (cur['video_state'] === 'PUBLISHED' && cur['promote_request_id'] === requestId) return null
    if (cur['video_state'] !== 'DRAFT') return fail(409, '工单已不是草稿状态,请核对')
    const next: Record<string, unknown> = {
      ...cur, video_state: 'PUBLISHED', published_at: facts.publishedAt, ...ctx.port.publishedRefExtras(),
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

export interface FinishOutcome {
  firstCommentStatus: 'ok' | 'failed'
  commentId: string | null
  /** fenced = 收尾回执被另一个请求接管而没写成。 */
  closed: 'ok' | 'fenced' | 'error'
}

/** 首评在发出前无条件过红线(不论是新转公开还是已被人手公开的分支)。返回拦截原因或 null。 */
async function firstCommentBlocked(deps: PromoteDeps, f: FinishInput): Promise<string | null> {
  try {
    return await deps.scanRedline(f.clientId, f.masterBriefId, redlineSurface(f.firstComment))
  } catch (e) {
    return `首评红线检查失败,保守不发: ${msgOf(e)}`
  }
}

async function sendFirstComment(deps: PromoteDeps, f: FinishInput, blocked: string | null): Promise<string | null> {
  if (blocked) { deps.alert(`首评命中红线,未发送 order=${f.orderId}: ${blocked}`); return null }
  try {
    return await deps.meta.ensureFirstComment({ target: f.target, videoId: f.videoId, idempotencyTag: f.orderId, message: f.firstComment })
  } catch (e) {
    deps.alert(`首评补发失败 order=${f.orderId}: ${msgOf(e)}`)
    return null
  }
}

async function rescanAfterPublish(deps: PromoteDeps, f: FinishInput): Promise<string | undefined> {
  try {
    const after = await deps.meta.readReel(f.target, f.videoId)
    const hit = await deps.scanRedline(f.clientId, f.masterBriefId, `${redlineSurface(after.description)}\n${redlineSurface(f.firstComment)}`)
    if (hit) deps.alert(`转公开后回读命中红线 order=${f.orderId}: ${hit}`)
    return hit ?? undefined
  } catch (e) {
    deps.alert(`转公开后回读失败 order=${f.orderId}: ${msgOf(e)}`)
    return undefined
  }
}

/** 工单侧标记「首评待补」(供工厂页显示补发入口)。尽力而为:写不成只告警。 */
async function markCommentPending(deps: PromoteDeps, orderId: string, pending: boolean): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await deps.store.loadOrder(orderId)
    if (!fresh || fresh.status !== 'published') return
    const cur = asRecord(fresh.published_ref)
    if ((cur['first_comment_pending'] === true) === pending) return
    const next = { ...cur }
    if (pending) next['first_comment_pending'] = true
    else delete next['first_comment_pending']
    if (await deps.store.writeOrderPublishedRef(orderId, fresh.updated_at, next)) return
  }
  deps.alert(`首评待补标记写入失败 order=${orderId}`)
}

/** 回执写入没写全:有错误记录,或有占位却没盖「写完」章(commentRetry 之后仍沿用,直到人处理)。 */
function booksIncomplete(auth: ReturnType<typeof readAuth>): boolean {
  return Boolean(auth.books_error) || (Boolean(auth.books_work_order_id) && !auth.books_written_at)
}

/** 补首评(永远执行,自带幂等;先过红线)→ 转公开后回读重扫红线 → 收尾回执。失败都不回滚公开。 */
export async function finishStage(deps: PromoteDeps, f: FinishInput, attemptId: string): Promise<FinishOutcome> {
  const blocked = await firstCommentBlocked(deps, f)
  const commentId = await sendFirstComment(deps, f, blocked)
  const redlineHit = await rescanAfterPublish(deps, f)
  const status = commentId ? 'ok' : 'failed'
  const closed = await mutatePayload(deps, { id: f.rowId, client_id: f.clientId }, fenced(attemptId, (cur) => ({
    ...withAuth(cur, {
      status: 'consumed', first_comment_status: status, fail_reason: blocked ?? undefined,
      needs_attention: status === 'failed' || redlineHit !== undefined || booksIncomplete(readAuth(cur)),
      post_publish_redline_hit: redlineHit,
    }),
    ...(commentId ? { first_comment_id: commentId } : {}),
  })), 3)
  if (!closed.ok) deps.alert(`收尾回执写入失败 order=${f.orderId} (${closed.message})`)
  if (closed.ok) await markCommentPending(deps, f.orderId, status === 'failed')
  const outcome: FinishOutcome['closed'] = closed.ok ? 'ok' : closed.reason === 'rejected' ? 'fenced' : 'error'
  return { firstCommentStatus: status, commentId, closed: outcome }
}
