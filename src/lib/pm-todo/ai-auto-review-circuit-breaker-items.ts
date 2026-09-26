/**
 * 今日待办里的「AI 全自动审核被异常刹车暂停了」（PM 拍板 2026-09-15）。
 *
 * 拉模式，跟 `conversion-review-items.ts` 同一个原则：直接查
 * `clients.ai_auto_review_paused_reason` 是否非空——只要非空，说明这个客户是被
 * `ai-auto-review-circuit-breaker.ts` **自动**关掉的，不是 PM 自己手动关的
 * （人工手动关开关时，代码里约定会把这一列清空，见 `ai-auto-review-run.ts` 头部说明）。
 * 事件丢了、进程崩了，这条待办照样出得来——不依赖任何通知送达。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'

type PausedClientRow = {
  id: string
  name: string
  ai_auto_review_paused_reason: string | null
}

export async function pushAiAutoReviewCircuitBreakerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
): Promise<void> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, ai_auto_review_paused_reason')
    .not('ai_auto_review_paused_reason', 'is', null)

  if (error) throw new Error(`AI 自动审核熔断状态查询失败: ${error.message}`)

  for (const row of (data ?? []) as PausedClientRow[]) {
    items.push({
      kind: 'ai_auto_review_circuit_breaker',
      client_name: row.name,
      client_id: row.id,
      what:
        `${row.name} 的成交自动审核（AI 判断+自动发给广告平台）因为发现异常，已经自动暂停——` +
        `原因：${row.ai_auto_review_paused_reason}。暂停期间这个客户的记录不会再自动发送。`,
      how: '打开成交审核页面看一眼最近几条记录对不对，确认没问题后在客户设置里重新打开这个开关；' +
        '如果看着不对，先别急着打开，等搞清楚原因再说。',
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${row.id}`,
    })
  }
}
