/**
 * 今日待办里的「AI 客服回复」三档提醒(issue #1589)：
 *   · 待批准草稿 —— AI 写好了，等人处理
 *   · 已批但发送失败 —— 人已经点头了，但客户没收到（P0，H16）
 *   · 超时升级 —— 4 小时没人批，不能拖到明天再看（next-day escalation）
 *
 * 三档共用同一张表 `conversation_reply_drafts`，一次查询按 `verifier_status`
 * 分桶（合法取值见
 * `supabase/migrations/20260913095601_conversation_reply_drafts.sql`）。
 * 用 `fetchAll` 分页读全——`.limit(2000)` 撞上 PostgREST 单次 1000 行硬顶会
 * 静默截断且不报错（见 `src/lib/supabase-paginate.ts` 头注的真实事故），这里
 * 又没有天然的时间下界（`timed_out` 行会随运行时间只增不减），越晚越容易
 * 撞到这个坑。
 *
 * 拉模式：直接查表，不依赖任何事件送达——Inngest 事件丢了、进程崩了，
 * 待办照样出得来。`superseded_by_draft_id is null` 排除已经被新草稿取代的
 * 旧行，避免同一次对话被算两遍。只处理仍在服务的客户（`clients` 只含
 * active 客户）——已下线客户的旧记录不该重新变成 PM 的待办噪音（Codex
 * 复审 2026-09-15：之前遇到不在 `clients` 里的 client_id 会显示成「未知
 * 客户」而不是跳过）。
 *
 * 🔴 门户目前**没有**能展示或处理 `conversation_reply_drafts` 具体内容的
 *    页面（issue #1588 待建）——现有的「客户消息」页读的是另一张更早的
 *    `conversation_briefs.draft_reply`（AI 摘要 + 建议回复），完全不知道
 *    Governed Reply Agent 写的这些行（Codex 复审 2026-09-15 指出：href 原本
 *    指向那个页面，但 FDE 在那看不到这里说的"草稿"，how 字段等于承诺了一
 *    件做不到的事）。所以这里的 how 不再叫人去"审草稿"，而是如实说"有客
 *    户在等真人回复，AI 那份还看不到，先直接开对话手动回"——门户已有的
 *    对话列表 + 手动回复框（`ReplyBox.tsx`）今天就能完成这件事，不依赖
 *    #1588。#1588 上线后要把这里的 how/href 换成直达草稿卡片。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import type { ClientRow } from './client-roster'
import { fetchAll } from '@/lib/supabase-paginate'

const APP_BASE = 'https://app.magicengine.com.au'

const TRACKED_STATUSES = ['pending', 'send_failed', 'timed_out'] as const
type TrackedStatus = (typeof TRACKED_STATUSES)[number]

type DraftRow = {
  client_id: string
  verifier_status: string
  created_at: string
}

type Bucket = { count: number; oldestIso: string }

function hoursAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3_600_000))
}

function hrefFor(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${clientId}/messenger`
}

export async function pushMessengerDraftItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clients: Map<string, ClientRow>,
  now: Date,
): Promise<void> {
  const rows = await fetchAll<DraftRow>((from, to) =>
    supabase
      .from('conversation_reply_drafts')
      .select('client_id, verifier_status, created_at')
      .in('verifier_status', [...TRACKED_STATUSES])
      .is('superseded_by_draft_id', null)
      .order('created_at', { ascending: true })
      .range(from, to),
  )

  const buckets: Record<TrackedStatus, Map<string, Bucket>> = {
    pending: new Map(),
    send_failed: new Map(),
    timed_out: new Map(),
  }

  for (const row of rows) {
    // 已下线的客户不再进今日待办——见文件头注，这不是「未知客户」的兜底，
    // 是刻意跳过。
    if (!clients.has(row.client_id)) continue
    const bucket = buckets[row.verifier_status as TrackedStatus]
    if (!bucket) continue
    const cur = bucket.get(row.client_id)
    if (!cur || row.created_at < cur.oldestIso) {
      bucket.set(row.client_id, { count: (cur?.count ?? 0) + 1, oldestIso: row.created_at })
    } else {
      cur.count += 1
    }
  }

  const nameOf = (clientId: string) => clients.get(clientId)?.name ?? '未知客户'

  for (const [clientId, agg] of Array.from(buckets.pending.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_pending_approval',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 位客户在等 AI 客服的回复，最早一位已经等了 ${hoursAgo(agg.oldestIso, now)} 小时`,
      how: 'AI 写好的那份回复目前还没有专门的审核页面（在建），先打开客户消息页，直接看这段对话、人工回一条过去，不用等 AI 那份',
      href: hrefFor(clientId),
    })
  }

  for (const [clientId, agg] of Array.from(buckets.send_failed.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_send_failed',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 条 AI 客服回复已经批准，但发送失败了——客户没收到回复，这条最优先处理`,
      how: '打开客户消息页看看这段对话卡在哪（可能是连接掉线，或者客户拉黑了我们），需要人工把回复发出去',
      href: hrefFor(clientId),
    })
  }

  for (const [clientId, agg] of Array.from(buckets.timed_out.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_escalation',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 位客户等回复超过 4 小时了，不能拖到明天`,
      how: '今天之内打开客户消息页，把这些对话人工回完',
      href: hrefFor(clientId),
    })
  }
}
