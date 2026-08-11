/**
 * 活跃客户名单 —— 从 manual-items.ts 抽出来的。
 *
 * 那个文件在 main 上就是 990 行、已经超过铁律七的 800 行上限；本 PR 往里加东西
 * 只会把老违规撑得更大，所以新增的都放这里。（Codex P1, round 32 on PR #862）
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ManualItem } from './manual-items'

export type ClientRosterItemKind = 'client_list_unreadable'

const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'

export interface ClientRow {
  id: string
  name: string
  domain: string | null
}

/**
 * 客户名单查挂了 ≠ 一个客户都没有。
 *
 * 原来两者走同一条路：`error` 被解构丢掉、`clientRows` 是 null，于是当成「零个
 * 活跃客户」直接返回，后面所有按客户查的待办一条都不跑，而清单照样干干净净地
 * 生成 —— 连「归因检查挂了」那张兜底网本身都在返回的下游，一起被跳过。
 * （Codex P1, round 15 on PR #862）
 */
export function clientListUnreadableItem(message: string): ManualItem {
  return {
    kind: 'client_list_unreadable',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      `今天没读出客户名单 —— ${message}。` +
      '所以「按客户逐个查」的那半边待办(串台、草稿、归因黑洞、客资口径……)' +
      '今天全都没跑。这份清单不是「今天没事」,是只查了一半',
    how:
      '这条不用你动手 —— 是我们这边读客户表失败了。回我一句「名单读不出来」' +
      '我去修。修好之前,今天这份清单只当作系统级检查,别当作客户侧没问题',
    href: RENDER_DASHBOARD_URL,
  }
}

/**
 * 活跃客户名单，分页读全。
 *
 * PostgREST 单次最多返回 1000 行，而且不报错（见 supabase-paginate.ts）。这里
 * 截断不只是少列几个客户 —— 名单是后面所有「按客户查」的输入，包括归因黑洞和
 * 孤儿数据两项审计。它们内部各自分页也补不回来：被上游漏掉的客户，审计根本不
 * 知道要去查。排序要唯一，否则翻页会重复或漏行。（Codex P2, round 23）
 *
 * 查挂了和「一个活跃客户都没有」分开返回：合并成同一条路的话，清单会干干净净
 * 地生成，而后面半边根本没跑。
 */
export async function loadActiveClients(
  supabase: SupabaseClient,
): Promise<{ clients: Map<string, ClientRow>; error: { message: string } | null }> {
  try {
    const rows = await fetchAll<ClientRow>((from, to) =>
      supabase
        .from('clients')
        .select('id, name, domain')
        .eq('client_status', 'active')
        .order('id', { ascending: true })
        .range(from, to),
    )
    return { clients: new Map(rows.map((c) => [c.id, c])), error: null }
  } catch (e) {
    return {
      clients: new Map(),
      error: { message: e instanceof Error ? e.message : String(e) },
    }
  }
}

