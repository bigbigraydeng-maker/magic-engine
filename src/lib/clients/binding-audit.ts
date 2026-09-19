/**
 * 客户外部账户绑定审计（表 client_binding_audit，见 20260913120000 迁移）。
 *
 * 两类用途：
 *   1. 内部员工改绑定 —— 先插 `authorized`（插不进去 = 调用方拒绝写入），
 *      写完再把 outcome 改成 `applied` / `write_failed`。
 *   2. 客户在自助向导里提交、等 FDE 核实的值（`requested_by_client`）——
 *      每日「需要你动手」待办从这里读（pm-todo/binding-request-items.ts）。
 *
 * 通用于各种 binding_kind：'meta_ad_account'（AD-SEC-3）、'facebook_page'（AD-SEC-4）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { MetaTokenSource } from '@/lib/meta/token-manager'

export type BindingKind = 'meta_ad_account' | 'facebook_page'

/** 核实用的令牌来源；client_oauth = 客户「连接 Meta」授权后存下的主页令牌。 */
export type BindingTokenSource = MetaTokenSource | 'client_oauth'

export type BindingAuditOutcome =
  | 'authorized'
  | 'applied'
  | 'write_failed'
  | 'requested_by_client'
  | 'request_dismissed'
  | 'rejected_graph'
  | 'rejected_no_token'
  | 'rejected_duplicate'

export interface BindingAuditInsert {
  client_id: string
  binding_kind: BindingKind
  actor_email: string
  action: 'bind' | 'clear' | 'request' | 'dismiss_request'
  outcome: BindingAuditOutcome
  previous_value?: string | null
  requested_value?: string | null
  token_source?: BindingTokenSource | null
  graph_account?: Record<string, unknown> | null
  shared_with_client_ids?: string[] | null
  override_reason?: string | null
  detail?: string | null
}

const clip = (s: string | null | undefined, max: number) => (s == null ? null : s.slice(0, max))

/** 插一行，返回 id。失败返回 error —— 调用方决定是否 fail closed。 */
export async function insertBindingAudit(
  row: BindingAuditInsert,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('client_binding_audit')
    .insert({
      ...row,
      actor_email: row.actor_email.slice(0, 320),
      previous_value: clip(row.previous_value, 64),
      requested_value: clip(row.requested_value, 64),
      override_reason: clip(row.override_reason, 500),
      detail: clip(row.detail, 500),
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'no row returned' }
  return { id: (data as { id: string }).id }
}

/**
 * 把 authorized 行改成最终结果。结果已经发生，补记失败不能回头撤销 ——
 * 返回 false 让调用方在响应里如实说「审计没补记完」（行会停在 authorized）。
 */
export async function finishBindingAudit(
  id: string,
  outcome: 'applied' | 'write_failed',
  detail?: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('client_binding_audit')
    .update({ outcome, detail: clip(detail, 500), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[binding-audit] failed to finish audit row', id, error.message)
  return !error
}

/** 拒绝类结果：尽力记一笔，写失败不改变拒绝结论。 */
export async function recordRejectedBinding(row: BindingAuditInsert): Promise<void> {
  const res = await insertBindingAudit(row)
  if ('error' in res) console.error('[binding-audit] failed to record rejection:', res.error)
}

/** 客户每 24 小时最多记这么多条提交 —— 防轮换号码刷行（魏征实施审）。 */
export const CLIENT_REQUESTS_PER_DAY = 5

/**
 * 这个客户最近 24 小时内的提交值。读失败返回 null，调用方按「不记」处理
 * （客户那边会退回「上门时处理」，不会丢）。
 */
export async function recentClientRequestValues(
  clientId: string,
  kind: BindingKind,
  now: Date = new Date(),
): Promise<string[] | null> {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('client_binding_audit')
    .select('requested_value')
    .eq('client_id', clientId)
    .eq('binding_kind', kind)
    .eq('outcome', 'requested_by_client')
    .gte('created_at', since)
  if (error) return null
  return ((data ?? []) as Array<{ requested_value: string | null }>).map(r => r.requested_value ?? '')
}
