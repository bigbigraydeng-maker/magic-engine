/**
 * 诸葛亮写出了系统不认识的动作类型。
 *
 * 那些行是 skipped + manual_review，不会进待办看板的「待做」。
 * 不在这里露出来，就只活在库里，没人知道有一条建议被拦住了。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import {
  MANUAL_REVIEW_ACTION_TYPE,
  MANUAL_REVIEW_DISPOSITION,
} from '@/lib/zhuge/action-vocabulary'

const boardHref = (clientId: string) =>
  `https://app.magicengine.com.au/dashboard/clients/${clientId}/execution`

interface ReviewRow {
  client_id: string
  steps_json: Record<string, unknown> | null
}

export async function pushZhugeUnknownActionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('execution_items')
    .select('client_id, steps_json')
    .eq('status', 'skipped')
    .eq('action_type', MANUAL_REVIEW_ACTION_TYPE)
    .limit(200)
  if (error) {
    console.warn('[zhuge-manual-review] 查询失败:', error.message)
    return
  }

  const byClient = new Map<string, number>()
  for (const row of (data ?? []) as ReviewRow[]) {
    if (row.steps_json?.disposition !== MANUAL_REVIEW_DISPOSITION) continue
    byClient.set(row.client_id, (byClient.get(row.client_id) ?? 0) + 1)
  }

  for (const [clientId, count] of Array.from(byClient.entries())) {
    items.push({
      kind: 'zhuge_unknown_action',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `有 ${count} 条方案动作用了系统不认识的类型，没有排进待办。` +
        '不看的话，这些建议就停在这里，不会有人去做',
      how: '打开执行看板，看标题以「要人工看」开头的条目。能对上已有动作就改成那个类型再排进待办；对不上就划掉',
      href: boardHref(clientId),
    })
  }
}
