/**
 * 没有 OAuth 连接行可标的坏主页令牌（暂停表）→ 今日待办。
 *
 * `unverified_shared_token` 不在这里重复：主页绑定待办已经会下发同一件事。
 * 有连接行的走平台授权待办（status=error），也不在这里。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isKernelNotProvisioned } from '@/lib/kernel-approval/errors'
import type { BrokenPageTokenKind } from '@/lib/meta/broken-page-token'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

const REASON_TEXT: Record<Exclude<BrokenPageTokenKind, 'unverified_shared_token'>, string> = {
  graph_190: '令牌失效（Graph 190）',
  missing_page_role: '这个令牌在主页上没有被批准的角色（403 / #200）',
}

function panelHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`
}

interface HoldRow {
  client_id: string
  page_id: string
  reason: string
}

export async function pushBrokenPageHoldItems(
  supabase: SupabaseClient,
  items: ManualItem[],
): Promise<void> {
  const { data, error } = await supabase
    .from('meta_page_sync_holds')
    .select('client_id, page_id, reason')
    .limit(200)

  if (error) {
    if (isKernelNotProvisioned(error)) return
    throw new Error(`meta_page_sync_holds query failed: ${error.message}`)
  }

  const holds = ((data ?? []) as HoldRow[]).filter((row) => row.reason in REASON_TEXT)
  if (holds.length === 0) return

  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', Array.from(new Set(holds.map((row) => row.client_id))))
  if (clientError) throw new Error(`clients query failed: ${clientError.message}`)

  const names = new Map(
    ((clients ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name ?? '未知客户']),
  )

  for (const hold of holds) {
    const why = REASON_TEXT[hold.reason as keyof typeof REASON_TEXT]
    items.push({
      kind: 'platform_connection_broken',
      client_id: hold.client_id,
      client_name: names.get(hold.client_id) ?? '未知客户',
      what:
        `Facebook 主页 ${hold.page_id} 的授权已经坏了（${why}）。` +
        '私信、留资和主页数据不再每小时重试；不重新连接的话，这些数据不会自己回来',
      how:
        '点链接打开这个客户的设置抽屉，在「Facebook 主页」卡片里点「连接 Meta」，' +
        '要用在这个主页上有管理员身份的账号。连上之后系统会自己恢复同步。',
      href: panelHref(hold.client_id),
    })
  }
}
