/**
 * 加日预算两张卡：① 确认卡后等 PM 在 kernel 批；② PM 批完后提醒回卡再点确认。
 * 只生成今日待办文案，不改执行路径。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listBudgetRaiseTodos, todoCopyForRaise } from '@/lib/ads-budget-card/raise-approval-present'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type BudgetRaiseApprovalKind = 'budget_raise_awaiting_pm' | 'budget_raise_awaiting_confirm'

export async function pushBudgetRaiseApprovalItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientIds: readonly string[],
  nameOf: (id: string) => string,
): Promise<void> {
  let drafts: Awaited<ReturnType<typeof listBudgetRaiseTodos>>
  try {
    drafts = await listBudgetRaiseTodos(supabase, clientIds)
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 160)
    items.push({
      kind: 'budget_raise_awaiting_pm',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「加预算两步待办」今天读不出来（${message}）—— 可能有卡在等批或等二次确认，但这里看不到。`,
      how: '这条不用你动手 —— 回我一句「加预算待办读不出来」，我去查台账和内核状态。',
      href: '',
    })
    return
  }
  for (const draft of drafts) {
    const copy = todoCopyForRaise(draft, APP_BASE)
    items.push({
      kind: draft.phase === 'awaiting_pm' ? 'budget_raise_awaiting_pm' : 'budget_raise_awaiting_confirm',
      client_id: draft.clientId,
      client_name: nameOf(draft.clientId),
      what: copy.what,
      how: copy.how,
      href: copy.href,
    })
  }
}
