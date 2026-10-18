// 转公开成功后写两笔回执:工作日志「Reel 已公开」+ 执行事项 completed。
// 回执类写入:失败不回滚公开,只在授权回执里记 books_error(收尾时据此标 needs_attention)并写日志。
// 去重:先在流量记录回执里占位 books_work_order_id(带栅栏),占到才写;重入/租约重抢/补首评分支不会重复写。

import { sanitizeFailReason } from '../publish-display'
import { asRecord } from './guards'
import { fenced, mutatePayload, readAuth, withAuth } from './payload-lock'
import type { PromoteContext } from './context'
import type { PublishedFacts } from './publish-steps'
import type { PromoteDeps } from './types'

const ALREADY = '__books_already_written__'

export type BooksOutcome = 'written' | 'skipped' | 'failed'

/** 占位:同一工单只允许占到一次。返回 true = 本次占到,可以写。 */
async function claimBooks(deps: PromoteDeps, ctx: PromoteContext, attemptId: string): Promise<boolean | 'error'> {
  const res = await mutatePayload(deps, ctx.row, fenced(attemptId, (cur) =>
    readAuth(cur).books_work_order_id === ctx.order.id ? ALREADY : withAuth(cur, { books_work_order_id: ctx.order.id })), 3)
  if (res.ok) return true
  return res.message === ALREADY ? false : 'error'
}

async function recordFailure(deps: PromoteDeps, ctx: PromoteContext, attemptId: string, reason: string): Promise<void> {
  deps.alert(`公开回执(工作日志/执行事项)写入失败 order=${ctx.order.id}: ${reason}`)
  await mutatePayload(deps, ctx.row, fenced(attemptId, (cur) => withAuth(cur, { books_error: reason, needs_attention: true })), 3)
}

export async function writeCompletionBooks(deps: PromoteDeps, ctx: PromoteContext, facts: PublishedFacts, attemptId: string): Promise<BooksOutcome> {
  const claimed = await claimBooks(deps, ctx, attemptId)
  if (claimed === false) return 'skipped'
  if (claimed === 'error') { await recordFailure(deps, ctx, attemptId, '回执占位写入失败,未写公开回执'); return 'failed' }
  const label = String(asRecord(ctx.order.brief)['angle'] ?? '').trim() || ctx.target.expect_brand || 'Reel'
  const link = facts.permalink ?? ctx.videoId
  const today = deps.now().toISOString().slice(0, 10)
  const errors: string[] = []
  await deps.books.completeExecutionItem({
    clientId: ctx.order.client_id, rowId: ctx.row.id, existingItemId: ctx.row.execution_item_id ?? null,
    title: `【社媒 ${today}】工厂自动发布 Reel — ${label}`,
    description: `工厂自动发布 Reel「${label}」→ meta_graph(${link})`,
  }).catch((e: unknown) => { errors.push(`执行事项: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`) })
  await deps.books.writeWorkLog({
    clientId: ctx.order.client_id, summary: `【社媒｜工厂自动发布】Reel「${label}」已公开到 meta_graph。${link}`,
  }).catch((e: unknown) => { errors.push(`工作日志: ${sanitizeFailReason(e instanceof Error ? e.message : String(e))}`) })
  if (errors.length > 0) { await recordFailure(deps, ctx, attemptId, errors.join(';')); return 'failed' }
  return 'written'
}
