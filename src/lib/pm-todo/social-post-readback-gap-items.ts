/**
 * 今日待办：发后读数有问题（过点没回执 / 读不到 / 重试用尽 / Story 不支持 T+N）。
 * 复用 R-1 的 loadSocialReadbackBundle，组装时现算，不加 cron、不写库。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import {
  defaultReadbackWindow,
  loadSocialReadbackBundle,
} from '@/lib/social/social-readback-load'
import {
  dueAtForReadbackWindow,
  publicTimeOfPublish,
  reasonToZh,
  type SocialReadbackItem,
} from '@/lib/social/social-readback-panel'
import {
  readingFromReceipt,
  receiptAtWindow,
  type PublishActionRow,
  type ReceiptRow,
} from '@/lib/social/post-performance'

export type SocialPostReadbackGapKind =
  | 'social_post_readback_missing'
  | 'social_post_readback_unreadable'
  | 'social_post_readback_retries_exhausted'
  | 'social_story_readback_unsupported'

const APP_BASE = 'https://app.magicengine.com.au'
const MAX_ITEMS_PER_CLIENT = 20
/** Same grace as gap report: T+N + 1h before we surface 「过点没读到」. */
export const READBACK_GAP_GRACE_MS = 60 * 60 * 1000

function payloadPostId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const postId = (payload as { post_id?: unknown }).post_id
  return typeof postId === 'string' ? postId : null
}

function actionById(actions: PublishActionRow[]): Map<string, PublishActionRow> {
  return new Map(actions.map((a) => [a.id, a]))
}

function isPastGapDue(
  payload: unknown,
  publicTime: string | null,
  windowHours: number,
  now: Date,
): boolean {
  const dueIso = dueAtForReadbackWindow(payload, windowHours, publicTime)
  if (dueIso === null) return false
  const dueMs = Date.parse(dueIso)
  if (!Number.isFinite(dueMs)) return false
  return now.getTime() >= dueMs + READBACK_GAP_GRACE_MS
}

function unreadableReason(receipt: ReceiptRow): string {
  if (receipt.reason) return reasonToZh(receipt.reason)
  for (const metric of ['likes', 'comments', 'shares'] as const) {
    const r = readingFromReceipt(receipt, metric)
    if (r.kind === 'not_readable') return reasonToZh(r.reason)
  }
  return '读不到'
}

export function buildGapItemsForClient(input: {
  clientId: string
  clientName: string
  now: Date
  panel: { items: SocialReadbackItem[] }
  actions: PublishActionRow[]
  receipts: ReceiptRow[]
}): ManualItem[] {
  const actions = actionById(input.actions)
  const receiptsByAction = new Map<string, ReceiptRow[]>()
  for (const r of input.receipts) {
    const list = receiptsByAction.get(r.action_id)
    if (list === undefined) receiptsByAction.set(r.action_id, [r])
    else list.push(r)
  }

  const out: ManualItem[] = []
  const seen = new Set<string>()
  const href = `${APP_BASE}/dashboard/clients/${encodeURIComponent(input.clientId)}/daily-plan?tab=overview`

  const push = (item: ManualItem) => {
    const key = `${item.kind}:${item.client_id}:${item.what.slice(0, 80)}`
    if (seen.has(key)) return
    seen.add(key)
    if (out.length >= MAX_ITEMS_PER_CLIENT) return
    out.push(item)
  }

  const storyRows = input.panel.items.filter((r) => r.kind === 'story')
  if (storyRows.length > 0) {
    push({
      kind: 'social_story_readback_unsupported',
      client_id: input.clientId,
      client_name: input.clientName,
      what: `${input.clientName} 最近有 ${storyRows.length} 条 Story 已发出。Story 暂不支持发后 4 小时 / 72 小时的赞评转读数（观看需要洞察权限，目前读不到）。`,
      how: '打开客户社媒日常「本周总览」下的「发后成绩」看 Story 行；这不是读数坏了，是类型暂不支持，不用转开发修读数链。',
      href,
    })
  }

  for (const row of input.panel.items) {
    if (row.kind === 'story') continue

    const action = actions.get(row.id)
    if (action === undefined || row.windows === null) continue
    const payload = action.payload
    const publicTime = publicTimeOfPublish(payload, action.executed_at)
    const receipts = receiptsByAction.get(action.id) ?? []
    const postId = payloadPostId(payload)
    const fbHref = postId ? `https://www.facebook.com/${postId}` : href

    for (const window of row.windows) {
      if (window.status === 'pending') continue
      if (!isPastGapDue(payload, publicTime, window.hours, input.now)) continue

      const receipt = receiptAtWindow(receipts, window.hours)
      const label = `${row.kind_label} · ${row.published_at_display} · ${window.title}`

      if (receipt === null) {
        push({
          kind: 'social_post_readback_missing',
          client_id: input.clientId,
          client_name: input.clientName,
          what: `${input.clientName}：${label} 已过测量点，但系统还没有读数回执。不要当成 0。`,
          how: `① 打开链接确认内容还在线；② 若是公开的，把这条待办转给开发查读数链，附上动作编号 ${row.id}。`,
          href: fbHref,
        })
        continue
      }

      if (receipt.status === 'retries_exhausted') {
        push({
          kind: 'social_post_readback_retries_exhausted',
          client_id: input.clientId,
          client_name: input.clientName,
          what: `${input.clientName}：${label} 读数重试已用尽，成绩可能一直缺着。`,
          how: `打开「发后成绩」看详情；若帖子仍公开，转给开发查 Inngest 读数任务与回执表。动作编号 ${row.id}。`,
          href: fbHref,
        })
        continue
      }

      const hasValue = (['likes', 'comments', 'shares'] as const).some(
        (m) => readingFromReceipt(receipt, m).kind === 'value',
      )
      if (!hasValue || receipt.status === 'unmeasurable') {
        const detail = unreadableReason(receipt)
        push({
          kind: 'social_post_readback_unreadable',
          client_id: input.clientId,
          client_name: input.clientName,
          what: `${input.clientName}：${label} 有回执但读不到完整互动数（${detail}）。`,
          how: '打开客户「发后成绩」核对；若是权限或平台问题，转给开发，不要自己改 Meta 授权。',
          href: fbHref,
        })
      }
    }
  }

  return out
}

export async function pushSocialPostReadbackGapItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  clientIds: readonly string[],
): Promise<void> {
  const window = defaultReadbackWindow(now)
  for (const clientId of clientIds) {
    const bundle = await loadSocialReadbackBundle(supabase, {
      clientId,
      since: window.since,
      until: window.until,
      limit: 200,
      now,
    })
    const clientName = nameOf(clientId)
    const gaps = buildGapItemsForClient({
      clientId,
      clientName,
      now,
      panel: bundle.panel,
      actions: bundle.actions,
      receipts: bundle.receipts,
    })
    items.push(...gaps)
  }
}
