/**
 * Instagram 交叉发布的 Inngest 事件发送与补发（从 instagram-crosspost.ts 拆出）。
 * 事件失败只记日志，绝不改状态（帖子已存在，回滚会导致重复发布）。
 */

import type { PublishedRef } from '../types'
import { buildInstagramReelSubmittedEvent } from './instagram-publish-event'
import { readReceipt, withReceipt, type InstagramPublishReceipt } from './instagram-receipt'
import type { CrosspostCandidate, CrosspostDeps, Current } from './instagram-crosspost'

/** emitMissingEvents 最多补发的候选数。 */
const MISSING_EVENTS_LIMIT = 5

/**
 * 发 Inngest 事件并把 event_ids 写回回执。任何失败只记日志，绝不改状态
 * （帖子已存在，回滚会导致重复发布）。
 */
export async function emitFor(
  current: Current,
  ref: PublishedRef,
  d: CrosspostDeps,
): Promise<void> {
  const r = current.receipt
  const mediaId = r.media_id ?? ref.video_id
  // 草稿还是排期以「刚拿到的回执 ref」为准:成功回执写库冲突时 current.receipt 可能还停在 creating,
  // 那时拿它兜底成 draft 会把真排期的帖子报成「草稿/未发布」,而事件 id 固定,之后再补发也会被去重 —— 下游永远以为没公开。
  const providerState = ref.provider_state ?? r.provider_state
  if (mediaId === undefined || providerState === undefined) {
    console.error(
      `[instagram-crosspost] 缺 media_id 或发布状态,跳过事件 order=${current.candidate.id}`,
    )
    return
  }
  let ev: { id: string; name: string; data: Record<string, unknown> }
  try {
    ev = buildInstagramReelSubmittedEvent({
      workOrderId: current.candidate.id,
      clientId: current.candidate.client_id,
      publerAccountId: r.publer_account_id,
      mediaId,
      postId: ref.post_id ?? r.post_id,
      providerState,
      scheduledAt: ref.scheduled_at ?? r.scheduled_at,
      firstCommentRequested: r.first_comment_requested,
      requestId: r.request_id,
      createdAt: d.now().toISOString(),
    })
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 事件构造失败', e)
    return
  }

  let sent: { event_ids: string[] }
  try {
    sent = await d.emit(ev)
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 事件发送失败', e)
    return
  }

  const withEvents: InstagramPublishReceipt = {
    ...r,
    event_ids: sent.event_ids,
    updated_at: d.now().toISOString(),
  }
  const w = await d.store.writeOutput(
    current.candidate.id,
    current.updatedAt,
    withReceipt(current.output, withEvents),
  )
  if (!w.ok) {
    console.error(
      `[instagram-crosspost] event_ids 写入冲突 order=${current.candidate.id}`,
    )
    return
  }
  current.receipt = withEvents
  current.updatedAt = w.updatedAt
  current.output = withReceipt(current.output, withEvents)
}

/**
 * 补发漏掉的事件：只处理 draft/scheduled 且缺 event_ids 的候选，最多 5 个。
 * 事件 id 是确定性的，重发无害。
 */
export async function emitMissingEvents(
  candidates: CrosspostCandidate[],
  d: CrosspostDeps,
): Promise<void> {
  let count = 0
  for (const c of candidates) {
    if (count >= MISSING_EVENTS_LIMIT) return
    const receipt = readReceipt(c.output)
    if (receipt === null) continue
    if (receipt.status !== 'draft' && receipt.status !== 'scheduled') continue
    if (receipt.post_id === undefined) continue
    if (receipt.media_id === undefined) continue
    if (receipt.event_ids !== undefined && receipt.event_ids.length > 0) continue
    count += 1
    await emitMissingOne(c, receipt, d)
  }
}

/** 补发单个候选的事件。 */
async function emitMissingOne(
  c: CrosspostCandidate,
  receipt: InstagramPublishReceipt,
  d: CrosspostDeps,
): Promise<void> {
  const mediaId = receipt.media_id
  if (mediaId === undefined) return
  const providerState = receipt.provider_state ?? (receipt.status === 'scheduled' ? 'scheduled' : 'draft')
  let ev: { id: string; name: string; data: Record<string, unknown> }
  try {
    ev = buildInstagramReelSubmittedEvent({
      workOrderId: c.id,
      clientId: c.client_id,
      publerAccountId: receipt.publer_account_id,
      mediaId,
      postId: receipt.post_id,
      providerState,
      scheduledAt: receipt.scheduled_at,
      firstCommentRequested: receipt.first_comment_requested,
      requestId: receipt.request_id,
      createdAt: d.now().toISOString(),
    })
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 补发事件构造失败', e)
    return
  }
  let sent: { event_ids: string[] }
  try {
    sent = await d.emit(ev)
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 补发事件发送失败', e)
    return
  }
  const withEvents: InstagramPublishReceipt = {
    ...receipt,
    event_ids: sent.event_ids,
    updated_at: d.now().toISOString(),
  }
  const w = await d.store.writeOutput(
    c.id,
    c.updated_at,
    withReceipt(c.output, withEvents),
  )
  if (!w.ok) {
    console.error(`[instagram-crosspost] 补发 event_ids 写入冲突 order=${c.id}`)
  }
}
