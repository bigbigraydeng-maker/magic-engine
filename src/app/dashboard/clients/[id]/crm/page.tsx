/**
 * 「今天要联系」旧网址 —— 跳到「全部客人」。
 *
 * 2026-09-28（CRM 重整 WP-B6）：这一页原本是系统排好的「今天该打谁」看板（六批人
 * 并排成列，点一个人从右侧滑出抽屉）。它的每一样独有功能都已经搬进「全部客人」：
 *   - 私信 / 邮件 / WhatsApp 回复、一键动作、置顶备注 —— B2（PersonDrawer 换成
 *     同一份组件）
 *   - 同行 / 终端客户筛选 + 批量发邮件 —— B3
 *   - 四段分组（等你回 / 已回 / 排队 / 名单外）—— WP3 R7 早就在「按『先联系谁』
 *     分段」这个开关里
 *   - 「今天进度」—— B5（分段视图段头旁）
 * 页面本身因此整个删掉，改成一条跳转，不做成 404——旧书签、今日待办邮件里
 * 万一还留着老链接（已核实 `manual-crm-items.ts` 现在都指向 `/crm/all`，
 * 这里只是给背了旧网址的人兜底）。
 *
 * `?contact=<id>` 原样带过去——「全部客人」的直达链接机制读的是同一个参数。
 */

import { redirect } from 'next/navigation'

export default function CrmTodayRedirectPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') qs.set(key, value)
  }
  const suffix = qs.toString()
  redirect(`/dashboard/clients/${params.id}/crm/all${suffix ? `?${suffix}` : ''}`)
}
