/**
 * 客户提交、还没被内部员工处理的外部账户绑定请求（读 client_binding_audit）。
 *
 * 单独成文件、Supabase 客户端由调用方传入：每日待办（pm-todo/manual-items.ts）
 * 用自己拿到的客户端跑，不能在 import 时顺带初始化 `@/lib/supabase`
 * （那个模块缺环境变量会直接抛错，把整份待办拖垮）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { BindingAuditOutcome, BindingKind } from './binding-audit'

export interface PendingBindingRequest {
  id: string
  client_id: string
  requested_value: string
  actor_email: string
  created_at: string
}

/**
 * 客户提交之后，内部员工对这个客户做过其中任何一个动作，就算「已处理」。
 * 只认「保存了一个号」或「忽略」—— 清空绑定不代表看过客户交的号（魏征实施审）。
 */
const RESOLVING_OUTCOMES: BindingAuditOutcome[] = ['applied', 'request_dismissed']
const isResolving = (r: { outcome: BindingAuditOutcome; action: string }) =>
  r.outcome === 'request_dismissed' || (r.outcome === 'applied' && r.action === 'bind')

/** 只看最近这么多天的请求 —— 更老的没人理，多半已线下处理，过期不再提醒。 */
export const PENDING_REQUEST_WINDOW_DAYS = 30

/**
 * 每个客户只看时间上最新的一行：最新是客户提交 → 待处理；最新是「保存了一个号」/
 * 忽略 → 已处理。clientIds 省略 = 所有客户。查询出错抛出。
 */
export async function listPendingBindingRequests(
  supabase: SupabaseClient,
  kind: BindingKind,
  now: Date,
  clientIds?: string[],
): Promise<PendingBindingRequest[]> {
  const since = new Date(now.getTime() - PENDING_REQUEST_WINDOW_DAYS * 86_400_000).toISOString()
  // 全量分页读，不设总条数上限：按条数截断时，某个客户刷的行会把别的客户的待办挤掉。
  const rows = await fetchAll<PendingBindingRequest & { outcome: BindingAuditOutcome; action: string }>((from, to) => {
    let query = supabase
      .from('client_binding_audit')
      .select('id, client_id, requested_value, actor_email, created_at, outcome, action')
      .eq('binding_kind', kind)
      .in('outcome', ['requested_by_client', ...RESOLVING_OUTCOMES])
      .gte('created_at', since)
    if (clientIds) query = query.in('client_id', clientIds)
    return query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  })

  const seen = new Set<string>()
  const pending: PendingBindingRequest[] = []
  for (const r of rows) {
    if (seen.has(r.client_id)) continue
    if (r.outcome !== 'requested_by_client' && !isResolving(r)) continue // e.g. an applied clear
    seen.add(r.client_id)
    if (r.outcome === 'requested_by_client' && r.requested_value) {
      pending.push({
        id: r.id,
        client_id: r.client_id,
        requested_value: r.requested_value,
        actor_email: r.actor_email,
        created_at: r.created_at,
      })
    }
  }
  return pending
}
