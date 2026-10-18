/**
 * Reel 转公开的生产 store —— 薄封装 supabaseAdmin。
 *
 * 单独成文件的原因:主流程只依赖 PromoteStore 接口,测试里注入内存实现;
 * 这里是唯一碰数据库的地方。supabaseAdmin 只在函数体内引用,不在模块加载时触发副作用。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { TRAFFIC_ACTION_TYPE } from './types'
import type { PromoteOrder, PromoteStore, TrafficRow } from './types'

/** 把 unknown 收窄成普通对象（非数组、非 null）。 */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 从数据库行构造工单；非对象 jsonb 字段一律退化为 {}。 */
function rowToOrder(row: Record<string, unknown>): PromoteOrder {
  const masterBriefId = row.master_brief_id
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    status: String(row.status),
    master_brief_id: typeof masterBriefId === 'string' ? masterBriefId : null,
    brief: asPlainObject(row.brief) ?? {},
    output: asPlainObject(row.output) ?? {},
    review_ref: asPlainObject(row.review_ref) ?? {},
    published_ref: asPlainObject(row.published_ref) ?? {},
    updated_at: String(row.updated_at),
  }
}

/** 从数据库行构造流量记录；payload 非对象时退化为 {}。 */
function rowToTraffic(row: Record<string, unknown>): TrafficRow {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    payload: asPlainObject(row.payload) ?? {},
  }
}

/** 把查询结果里的 data 收窄成行数组（非数组一律当空）。 */
function asRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return []
  const rows: Record<string, unknown>[] = []
  for (const item of data) {
    const r = asPlainObject(item)
    if (r !== null) rows.push(r)
  }
  return rows
}

async function loadOrder(id: string): Promise<PromoteOrder | null> {
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select(
      'id, client_id, status, master_brief_id, brief, output, review_ref, published_ref, updated_at',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  const row = asPlainObject(data)
  if (row === null) return null
  return rowToOrder(row)
}

async function loadTrafficRows(orderId: string, clientId: string): Promise<TrafficRow[]> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('client_id', clientId)
    .eq('action_type', TRAFFIC_ACTION_TYPE)
    .eq('payload->>work_order_id', orderId)
  if (error) throw error
  return asRows(data).map(rowToTraffic)
}

async function loadTrafficRow(id: string, clientId: string): Promise<TrafficRow | null> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  const row = asPlainObject(data)
  if (row === null) return null
  return rowToTraffic(row)
}

async function casPayload(
  id: string,
  clientId: string,
  expectedRev: string | null,
  nextPayload: Record<string, unknown>,
): Promise<boolean> {
  // promote_rev 版本号就是乐观锁:任何其他写这一行 payload 的代码如果不带 promote_rev,
  // 就会绕过这把锁 —— 所以所有写 payload 的路径都必须维护 promote_rev。
  const base = supabaseAdmin
    .from('flywheel_actions')
    .update({ payload: nextPayload })
    .eq('id', id)
    .eq('client_id', clientId)
  const guarded =
    expectedRev === null
      ? base.is('payload->>promote_rev', null)
      : base.eq('payload->>promote_rev', expectedRev)
  const { data, error } = await guarded.select('id')
  if (error) throw error
  return asRows(data).length === 1
}

async function writeOrderPublishedRef(
  id: string,
  expectedUpdatedAt: string,
  nextRef: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .update({ published_ref: nextRef, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .eq('status', 'published')
    .select('id')
  if (error) throw error
  return asRows(data).length === 1
}

/**
 * 生产 store：薄封装 supabaseAdmin。supabaseAdmin 只在函数体内引用，
 * 避免在模块导入时触发副作用。
 */
export function createSupabasePromoteStore(): PromoteStore {
  return {
    loadOrder,
    loadTrafficRows,
    loadTrafficRow,
    casPayload,
    writeOrderPublishedRef,
  }
}
