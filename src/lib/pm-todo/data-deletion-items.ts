/**
 * Facebook 删除数据请求处理失败 → 下发到「需要你动手」。
 *
 * Meta 的 data deletion callback 打进来、我们这边处理失败时，`recordDeletionFailure`
 * 会往 `meta_data_deletion_requests` 写一行 status='failed'。那行如果没人看，
 * 就等于「用户在 Facebook 里要求删数据，我们答应了却没做到」这件事只活在日志里
 * （CLAUDE.md 铁律 3）。这里把它捞出来。
 *
 * 只读：只读 `meta_data_deletion_requests`，不重试、不改状态 —— 修好之后
 * Facebook 会提示用户重试，新的请求会自己走通。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

/** 回看多少天内的失败 —— 更早的失败要么已经修好，要么用户已经重试成功。 */
export const DATA_DELETION_FAILURE_LOOKBACK_DAYS = 7

/** 一行 `meta_data_deletion_requests`（只声明这条待办用得到的列）。 */
export interface DataDeletionRequestRow {
  app_user_hash: string
  issued_at: string
  status: string
}

/**
 * 纯函数：数出「没有对应成功记录」的失败请求。
 *
 * 同一个 (app_user_hash, issued_at) 上如果已经有 completed / no_data 的行，
 * 说明那次请求最终处理成功了（用户重试或我们补跑），失败那行不再算数。
 */
export function countUnresolvedFailures(rows: readonly DataDeletionRequestRow[]): number {
  const settled = new Set<string>()
  for (const row of rows) {
    if (row.status === 'completed' || row.status === 'no_data') {
      settled.add(`${row.app_user_hash}|${row.issued_at}`)
    }
  }
  let count = 0
  for (const row of rows) {
    if (row.status !== 'failed') continue
    if (settled.has(`${row.app_user_hash}|${row.issued_at}`)) continue
    count += 1
  }
  return count
}

/** IO：读最近 7 天的删除请求记录，有未解决的失败就下发一条。DB 出错就抛（调用方 .catch）。 */
export async function pushDataDeletionFailureItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - DATA_DELETION_FAILURE_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('meta_data_deletion_requests')
    .select('app_user_hash, issued_at, status')
    .gte('received_at', since)
  if (error) throw new Error(`meta_data_deletion_requests 读取失败：${error.message}`)

  const failures = countUnresolvedFailures((data ?? []) as DataDeletionRequestRow[])
  if (failures === 0) return

  items.push({
    kind: 'meta_data_deletion_failure',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `Facebook 删除数据请求处理失败 ${failures} 次（最近 7 天）：用户在 Facebook 里要求删除数据，我们这边没处理成功`,
    how: '1. 先看数据库里「删除数据」那张表和函数是否已上线（migration 20260927150000_meta_data_deletion_requests）；2. 让开发窗口查 /api/meta/data-deletion 最近的报错日志；3. Facebook 会提示用户重试，修好后新的请求会自动处理。',
    href: 'https://app.magicengine.com.au/data-deletion',
  })
}
