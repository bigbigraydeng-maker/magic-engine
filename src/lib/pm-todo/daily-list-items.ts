/**
 * 今日待办「Reel 每日清单等你放行」：开了社媒 Agent 的客户，今天到后天有排了日子、还没授权、没被剔除的 Reel。
 *
 * 只读，一行写库都没有。不批 = 不发；过了日子会在第二天的每日排期里退回内容池。
 *
 * 只出要人动手的：今天到后天排了日子、还在等放行的 Reel（按客户合并成一条）；
 * 以及昨天没批、日子已过、已经退回内容池的（提醒一句，不用再动手）。
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { readGrant } from '@/lib/factory/publish/promote/scheduled-grant'
import { isExcludedByCard } from '@/lib/factory/publish/promote/scheduled-authorize-list'
import { readPublishOn } from '@/lib/social/week-pack/manifest'
import { listWindow } from '@/lib/social/daily-list/list'

export const DAILY_LIST_TODO_KIND = 'reel_daily_list_pending' as const

/** 已经处理过的授权状态：这些不再算「等你放行」。 */
const ACTIVE = new Set(['armed', 'claimed', 'consumed', 'consumed_manual', 'unknown'])

const HOW =
  '打开客户社媒页的「今天到后天要发的 Reel」：看完正文和首评点「放行」；不想发的单条点「剔除」并写原因（剔除后不会再自动排）。'

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function hrefOf(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}`
}

/** Turns work orders + grant status + yesterday's expiry counts into to-do items (pure). */
export function buildDailyListItems(input: {
  orders: ReadonlyArray<{ id: string; client_id: string; brief: unknown }>
  grantStatus: ReadonlyMap<string, string | null>
  expiredYesterday: ReadonlyMap<string, number>
  nameOf: (id: string) => string
  from: string
  to: string
}): ManualItem[] {
  const { orders, grantStatus, expiredYesterday, nameOf, from, to } = input

  // client_id -> 最早发布日 + 条数
  const pending = new Map<string, { count: number; earliest: string }>()
  for (const order of orders) {
    const publishOn = readPublishOn(order.brief)
    if (typeof publishOn !== 'string' || publishOn === 'invalid') continue
    if (publishOn < from || publishOn > to) continue
    if (isExcludedByCard(order.brief)) continue
    const status = grantStatus.get(order.id)
    if (status !== undefined && status !== null && ACTIVE.has(status)) continue
    const prev = pending.get(order.client_id)
    if (prev) {
      prev.count += 1
      if (publishOn < prev.earliest) prev.earliest = publishOn
    } else {
      pending.set(order.client_id, { count: 1, earliest: publishOn })
    }
  }

  const clientIds = new Set<string>([...pending.keys(), ...expiredYesterday.keys()])
  const out: ManualItem[] = []
  for (const clientId of [...clientIds].sort()) {
    const group = pending.get(clientId)
    const expired = expiredYesterday.get(clientId) ?? 0
    if (group) {
      let what = `今天到后天有 ${group.count} 条 Reel 排了日子、还在等你放行（最早 ${group.earliest}）。不放行就不会发；过了日子会退回内容池。`
      if (expired > 0) what += `另有 ${expired} 条之前没批、日子已过，已经退回内容池。`
      out.push({
        kind: DAILY_LIST_TODO_KIND,
        client_id: clientId,
        client_name: nameOf(clientId),
        what,
        how: HOW,
        href: hrefOf(clientId),
      })
    } else if (expired > 0) {
      out.push({
        kind: DAILY_LIST_TODO_KIND,
        client_id: clientId,
        client_name: nameOf(clientId),
        what: `有 ${expired} 条 Reel 之前没批、日子已过，已经退回内容池。今天到后天没有等你放行的。`,
        how: HOW,
        href: hrefOf(clientId),
      })
    }
  }
  return out
}

export async function pushDailyListItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date,
): Promise<void> {
  try {
    const clientsRes = await supabase
      .from('clients')
      .select('id')
      .eq('publishing_calendar_config->social_agent->>enabled', 'true')
    if (clientsRes.error) throw new Error(clientsRes.error.message)
    const clientIds = (clientsRes.data ?? [])
      .map((r) => asRecord(r).id)
      .filter((id): id is string => typeof id === 'string')
    if (clientIds.length === 0) return

    const { from, to } = listWindow(now)

    const ordersRes = await supabase
      .from('content_work_orders')
      .select('id, client_id, brief')
      .in('client_id', clientIds)
      .gte('brief->weekly_pack->>publish_on', from)
      .lte('brief->weekly_pack->>publish_on', to)
      .limit(300)
    if (ordersRes.error) throw new Error(ordersRes.error.message)
    const orders = (ordersRes.data ?? [])
      .map((r) => asRecord(r))
      .filter(
        (r): r is Record<string, unknown> & { id: string; client_id: string } =>
          typeof r.id === 'string' && typeof r.client_id === 'string',
      )
      .map((r) => ({ id: r.id, client_id: r.client_id, brief: r.brief }))

    const grantStatus = new Map<string, string | null>()
    if (orders.length > 0) {
      const grantsRes = await supabase
        .from('flywheel_actions')
        .select('payload')
        .eq('action_type', 'factory_reel_publish')
        .in('payload->>work_order_id', orders.map((o) => o.id))
        .limit(600)
      if (grantsRes.error) throw new Error(grantsRes.error.message)
      for (const row of grantsRes.data ?? []) {
        const payload = asRecord(asRecord(row).payload)
        const workOrderId = payload.work_order_id
        if (typeof workOrderId !== 'string') continue
        grantStatus.set(workOrderId, readGrant(payload)?.status ?? null)
      }
    }

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const expiredRes = await supabase
      .from('cron_run_logs')
      .select('summary')
      .eq('job_name', 'social-weekly-draft')
      .gte('started_at', since)
      .limit(200)
    if (expiredRes.error) throw new Error(expiredRes.error.message)
    const expiredYesterday = new Map<string, number>()
    for (const row of expiredRes.data ?? []) {
      const summary = asRecord(asRecord(row).summary)
      if (summary.mode !== 'write' || summary.cadence !== 'daily') continue
      const clientId = summary.client_id
      if (typeof clientId !== 'string') continue
      if (!Array.isArray(summary.expired_unapproved)) continue
      const count = summary.expired_unapproved.length
      const prev = expiredYesterday.get(clientId) ?? 0
      if (count > prev) expiredYesterday.set(clientId, count)
    }

    items.push(...buildDailyListItems({ orders, grantStatus, expiredYesterday, nameOf, from, to }))
  } catch {
    items.push({
      kind: DAILY_LIST_TODO_KIND,
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: 'Reel 每日清单今天没读出来，这一栏可能不全。',
      how: '这条不用你动手，是我们这边的欠账。',
      href: 'https://app.inngest.com',
    })
  }
}
