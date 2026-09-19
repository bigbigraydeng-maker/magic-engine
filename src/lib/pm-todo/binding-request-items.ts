/**
 * 「客户提交了广告账户号，等 FDE 核实」→ 下发到「需要你动手」。
 *
 * AD-SEC-3（2026-09-13）之后，客户自己（自助向导 / 客户员工账号）不能再直接
 * 绑定 Meta 广告账户 —— 绑定决定了广告写操作的归属校验放行谁。客户填的号
 * 记成 client_binding_audit 里的 requested_by_client；不下发到这里，就等于
 * 客户以为「交上去了」而没有任何人知道（铁律 3 下半：管道不许断头）。
 *
 * 这个文件一行写操作都没有。处理办法（采用 / 忽略）都在客户设置页里点。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listPendingBindingRequests } from '@/lib/clients/binding-requests'
import type { ManualItem } from './manual-items'

export type BindingRequestItemKind = 'ad_account_binding_requested'

/** 后台入口（登录后可见）。🔴 必须绝对网址，相对路径会被链接闸整条丢掉。 */
export const APP_BASE = 'https://app.magicengine.com.au'

function settingsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/settings`
}

export async function pushBindingRequestItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const pending = await listPendingBindingRequests(supabase, 'meta_ad_account', now, ids)
  for (const p of pending) {
    items.push({
      kind: 'ad_account_binding_requested',
      client_id: p.client_id,
      client_name: nameOf(p.client_id),
      what:
        `客户（${p.actor_email}）交了一个 Meta 广告账户号 ${p.requested_value}，还没接上 —— ` +
        '接上之前这个客户的广告数据不会同步，健康检查页也停不了/调不了他的广告',
      how:
        '点链接进客户设置页的「Meta 广告账户」卡片，卡片顶上会显示这个号。' +
        '先点「核实」看 Meta 返回的账户名和所属商户是不是这个客户的：' +
        '是 → 点「保存」接上；不是（填错 / 是别家的号）→ 点「忽略这个请求」，并跟客户说一声要正确的号。' +
        '如果提示「已登记在别的客户名下」，不要勾共用，先弄清楚到底是谁的账户',
      href: settingsHref(p.client_id),
    })
  }
}
