/**
 * 「有人在申请页申请做经销商」→ 今日待办「需要你动手」。
 *
 * 申请只会写成一条「待审核」的经销商，批准 / 拒绝只有人能做（批准后对方就能卖、能拿分润）。
 * 这个文件只读不写：数一数还在等审核的申请，有就下发一条，链到经销商页。
 * 表还没上线（42P01 / PGRST205）或读失败时静默跳过，不拖垮整份待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { APP_BASE } from './tool-lead-items'

export type DistributorApplicationItemKind = 'distributor_application_pending'

const DAY_MS = 86_400_000

export async function pushDistributorApplicationItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('distributors')
    .select('created_at')
    .eq('source', 'application')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200)
  if (error || !data || data.length === 0) return
  const rows = data as Array<{ created_at: string }>
  const waitedDays = Math.max(0, Math.floor((now.getTime() - Date.parse(rows[0].created_at)) / DAY_MS))
  const count = rows.length >= 200 ? '200 多' : String(rows.length)
  items.push({
    kind: 'distributor_application_pending',
    client_id: 'infra',
    client_name: 'Magic Network',
    what: `有 ${count} 个人申请加入 Magic Network（做经销商），等你批准或拒绝（最早一份已经等了 ${waitedDays} 天）。批准后对方就能卖服务、拿分润`,
    how: '打开经销商页，在列表里看他们留的邮箱、电话、城市和留言，合适的点「批准」，不合适的点「拒绝」。批准后再点「登录链接」把链接发给对方',
    href: `${APP_BASE}/dashboard/admin/distributors`,
  })
}
