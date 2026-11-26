/**
 * 今日待办里的「Reel 按日公开」栏：周卡批过、但到日没能公开的 Reel。
 *
 * 只读流量记录里的授权状态（scheduled_go_public），不读回执、不现算：状态改了（撤回 / 重批 / 已发）这条就自己消失。
 * 只出要人动手的：批后内容或日子变了（stale）、错过了发布日（missed）、发失败（failed）、执行到一半结果不明（unknown）、
 * 过了发布日还停在「已授权 / 正在发」（定时任务没跑到它，例如那天出错或客户关了每周闭环）、已公开但首评没发上。
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import {
  FIRST_COMMENT_FAILED, nzToday, readGrant, type ScheduledGrant, type ScheduledGrantStatus,
} from '@/lib/factory/publish/promote/scheduled-grant'

export const REEL_SCHEDULED_TODO_KIND = 'reel_scheduled_needs_human' as const
const NEEDS_PERSON: readonly ScheduledGrantStatus[] = ['stale', 'missed', 'failed', 'unknown']
const WAITING: readonly ScheduledGrantStatus[] = ['armed', 'claimed']

const WHAT: Record<string, string> = {
  stale: '周卡上批过的这条 Reel，批完之后内容、发布日或团目录变了，按日公开没有发出去。',
  missed: '周卡上批过的这条 Reel 错过了发布日，没有补发。',
  failed: '这条 Reel 到日转公开失败了，仍是 Facebook 草稿。',
  unknown: '这条 Reel 到日转公开时程序中断或记账失败，不确定 Facebook 上是否已公开。',
  overdue: '周卡上批过的这条 Reel 过了发布日还没发出去，定时任务没处理到它。',
  comment: '这条 Reel 已经按日公开了，但第一条评论（订团链接）没发上，客人看不到报名入口。',
}

const HOW: Record<string, string> = {
  stale: '打开客户社媒页的周卡区，在「已授权、还没公开」里看原因：内容对的就重新预览再授权，不对就撤回并改片。',
  missed: '打开客户社媒页的周卡区把这条撤回；要再发，等下一张周卡排新日子后再批。',
  overdue: '先到 Facebook 主页看这条有没有公开；没公开就在客户社媒页的周卡区把它撤回（显示「正在发」的等 10 分钟后定时任务会自己接手），等下一张周卡重排。',
  comment: '打开视频工厂找到这条 Reel，点「补发首评」（只补评论，不会再发一次）；补发成功后这条待办自己消失。',
  failed: '打开客户社媒页的周卡区看失败原因；改好后重新预览再授权。',
  unknown: '先到 Facebook 主页看这条有没有公开：公开了就在周卡区重新预览（会只同步记录）；没公开就撤回再授权。',
}

/** Which to-do (if any) a grant needs. Waiting past its day means no run reached it. */
function needsPerson(grant: ScheduledGrant, today: string, commentStillFailed: boolean): string | null {
  if (NEEDS_PERSON.includes(grant.status)) return grant.status
  if (WAITING.includes(grant.status) && grant.publish_on < today) return 'overdue'
  // Reads the live first-comment status, so a successful 补发首评 clears this to-do.
  if (grant.status === 'consumed' && grant.reason === FIRST_COMMENT_FAILED && commentStillFailed) return 'comment'
  return null
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Turns traffic-row payloads into to-do items (pure). */
export function buildReelScheduledItems(
  rows: ReadonlyArray<{ client_id: string; payload: unknown }>,
  nameOf: (id: string) => string,
  today: string,
): ManualItem[] {
  const out: ManualItem[] = []
  for (const row of rows) {
    const grant = readGrant(asRecord(row.payload))
    const auth = asRecord(asRecord(row.payload).promote_authorization)
    const which = grant ? needsPerson(grant, today, auth.first_comment_status === 'failed') : null
    if (!grant || !which) continue
    out.push({
      kind: REEL_SCHEDULED_TODO_KIND,
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `${WHAT[which]}（原定 ${grant.publish_on}）`,
      how: HOW[which],
      href: which === 'comment' ? `${APP_BASE}/dashboard/factory` : `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.client_id)}`,
    })
  }
  return out
}

export async function pushReelScheduledItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  try {
    const today = nzToday(new Date())
    const base = () => supabase.from('flywheel_actions').select('client_id, payload').eq('action_type', 'factory_reel_publish')
    const [open, overdue, commented] = await Promise.all([
      base().in('payload->scheduled_go_public->>status', [...NEEDS_PERSON]).limit(200),
      // Waiting grants only matter once their day has passed; future ones must not crowd the limit.
      base().in('payload->scheduled_go_public->>status', [...WAITING]).lt('payload->scheduled_go_public->>publish_on', today).limit(200),
      base().eq('payload->scheduled_go_public->>status', 'consumed').eq('payload->scheduled_go_public->>reason', FIRST_COMMENT_FAILED)
        .eq('payload->promote_authorization->>first_comment_status', 'failed').limit(50),
    ])
    if (open.error) throw new Error(open.error.message)
    if (overdue.error) throw new Error(overdue.error.message)
    if (commented.error) throw new Error(commented.error.message)
    const data = [...(open.data ?? []), ...(overdue.data ?? []), ...(commented.data ?? [])]
    const rows = data.filter(
      (r): r is { client_id: string; payload: unknown } => typeof asRecord(r).client_id === 'string',
    )
    items.push(...buildReelScheduledItems(rows, nameOf, today))
  } catch {
    items.push({
      kind: REEL_SCHEDULED_TODO_KIND,
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: 'Reel 按日公开的授权状态今天没读出来，这一栏可能不全。',
      how: '这条不用你动手，是我们这边的欠账。',
      href: 'https://app.inngest.com',
    })
  }
}
