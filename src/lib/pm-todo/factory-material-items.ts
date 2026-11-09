/**
 * Material-only factory follow-ups for today's list.
 * Overdue review asks the reviewer. Dead letters that will not be rerun ask OPC.
 * Nothing here approves, publishes, or sends an external message.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isHeldWorkOrder,
  planDeadLetter,
  type DeadLetterRow,
  type RerunAction,
} from '@/lib/factory/dead-letter-rerun'
import { reviewAge } from '@/lib/factory/review-nudge'
import type { ManualItem } from './manual-item-types'

const FACTORY_HREF = 'https://app.magicengine.com.au/dashboard/factory'
const UNREADABLE = '读不到'

interface ReviewRow {
  id: string
  client_id: string
  updated_at: string | null
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function nameOf(clientNames: Map<string, { name: string }>, clientId: string): string {
  return clientNames.get(clientId)?.name ?? '未知客户'
}

function checkFailedItem(what: string): ManualItem {
  return {
    kind: 'factory_material_check_failed',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what,
    how: '这条不用你动手。回我一句「素材催办检查没跑成」，我去查。没列出来不等于没有。',
    href: FACTORY_HREF,
  }
}

function reviewItem(row: ReviewRow, clientName: string, age: 'nudge' | 'unreadable'): ManualItem {
  const who = `【${clientName}】`
  const label = shortId(row.id)
  return {
    kind: 'factory_review_overdue',
    client_id: row.client_id,
    client_name: clientName,
    what: age === 'nudge'
      ? `${who}素材工单 ${label} 停在待审超过 24 小时。要审核的人看一眼。这条不批准，也不发布。`
      : `${who}素材工单 ${label} 还在待审，进审时间${UNREADABLE}，不能当成还没超时。`,
    how: '打开工厂工单看这张片子。审核的人（工单上的那位，或马良 / 苏东坡）自己决定。不要找做片的人，也不要找渲染工人。这条不会自动批准。',
    href: FACTORY_HREF,
  }
}

function deadLetterItem(plan: Extract<RerunAction, { action: 'escalate' | 'unread' }>, clientName: string): ManualItem {
  const label = shortId(plan.id)
  const stuck = plan.action === 'unread'
    ? `失败原因${UNREADABLE}，不能当成已经重跑成功。`
    : `卡在：${plan.reason}。已经自动重跑 ${plan.reruns} 次。`
  return {
    kind: 'factory_dead_letter_stuck',
    client_id: plan.clientId,
    client_name: clientName,
    what: `【${clientName}】死信工单 ${label}。${stuck}这是上报，不是批准，也不是再渲一次。`,
    how: '打开工厂工单看这张。文件太大的要等成片体积补丁，不要在这里手动当成功。其余的由人决定要不要重做。',
    href: FACTORY_HREF,
  }
}

async function pushReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, updated_at')
    .eq('status', 'in_review')
    .limit(100)
  if (error) {
    items.push(checkFailedItem(`待审清单${UNREADABLE}（${error.message || UNREADABLE}）。不能当成没有超时的片子。`))
    return
  }
  for (const row of (data ?? []) as ReviewRow[]) {
    if (isHeldWorkOrder(row.id)) continue
    const age = reviewAge(row.updated_at, now)
    if (age === 'wait') continue
    items.push(reviewItem(row, nameOf(clientNames, row.client_id), age))
  }
}

async function pushDeadLetterItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, reject_reason, review_ref, brief, reclaim_count')
    .eq('status', 'dead_letter')
    .limit(100)
  if (error) {
    items.push(checkFailedItem(`死信清单${UNREADABLE}（${error.message || UNREADABLE}）。不能当成没有卡住的工单。`))
    return
  }
  for (const row of (data ?? []) as DeadLetterRow[]) {
    const plan = planDeadLetter(row)
    if (plan.action !== 'escalate' && plan.action !== 'unread') continue
    items.push(deadLetterItem(plan, nameOf(clientNames, plan.clientId)))
  }
}

export async function pushFactoryMaterialItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  await pushReviewItems(supabase, items, now, clientNames)
  await pushDeadLetterItems(supabase, items, clientNames)
}
