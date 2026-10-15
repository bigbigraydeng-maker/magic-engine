/**
 * 「推广计划每日检查」的结果 → 下发到「需要你动手」。
 *
 * 照 ads-circuit-items.ts 的写法：只读、只生成待办，一行写库都没有。
 * 检查本身在 promo/daily-watch-run.ts 里跑，这里只负责把回执翻译成
 * 大白话的待办条目。
 *
 * 🔴 三种来源各出一条：
 *    - 整轮读不到计划列表（read_failed）→ 一条「检查没跑成」的欠账待办；
 *    - 每份计划里的每条 finding → 一条待办（what/how 直接用 finding 的文案）；
 *    - 单份计划算失败（failure）→ 一条「这份计划没跑成」的待办。
 * 🔴 今天没有报警不等于计划都正常：读不到 / 算不出都要说出来，不能安静。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { runPromoPlanWatch } from '@/lib/marketing-plan/promo/daily-watch-run'

/** 错误文案截断长度，避免待办里塞一整段堆栈。 */
const ERROR_MAX = 120

/** 把错误文案截到 ERROR_MAX 字，超出补省略号。 */
function shortError(message: string): string {
  if (message.length <= ERROR_MAX) return message
  return `${message.slice(0, ERROR_MAX)}…`
}

function promoPlanHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/promo-plan`
}

export async function pushPromoPlanWatchItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { receipt, sources, failures } = await runPromoPlanWatch(supabase)

  // 整轮读不到计划列表：一条欠账待办，不用 PM 动手。
  if (receipt.status === 'read_failed') {
    const reason = shortError(receipt.error ?? '未知原因')
    items.push({
      kind: 'promo_plan_watch',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `推广计划每日检查没跑成（读不到计划列表：${reason}）——今天没有报警不等于计划都正常。`,
      how: '这条不用你动手，是我们这边的欠账。告诉我一句「修推广计划每日检查」我就去修。',
      href: '',
    })
    return
  }

  // 每条 finding 一条待办。
  for (const source of sources) {
    items.push({
      kind: 'promo_plan_watch',
      client_id: source.client_id,
      client_name: nameOf(source.client_id),
      what: source.finding.what,
      how: source.finding.how,
      href: promoPlanHref(source.client_id),
    })
  }

  // 单份计划算失败：一条「这份计划没跑成」的待办。
  for (const failure of failures) {
    const reason = shortError(failure.error)
    items.push({
      kind: 'promo_plan_watch',
      client_id: failure.client_id,
      client_name: nameOf(failure.client_id),
      what: `推广计划《${failure.title}》的每日检查没跑成：${reason}——今天没有报警不等于这份计划正常。`,
      how: '稍后再看；连续几天都这样就告诉开发。',
      href: promoPlanHref(failure.client_id),
    })
  }
}
