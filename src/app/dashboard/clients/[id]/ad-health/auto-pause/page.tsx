/**
 * 旧网址 → 广告门「等你点头」标签的跳转。
 *
 * 内容已搬进 `clients/[id]/ads-health` 的 `?tab=approvals` 标签
 * （设计稿 `docs/specs/2026-10-18-ads-door-merge-design-v0.1.md` §5 步 2）。
 *
 * 🔴 **这个文件必须留着**，不能直接删：
 *   ① 已经发出去的今日待办邮件里写着这个网址，删了那些链接就死了；
 *   ② `kernel/dedicated-approval-entries.ts` 的守卫测试会检查登记的入口有真实页面文件存在。
 *
 * 写法照同仓库的 `clients/[id]/crm/page.tsx`（同步 `params` + 透传 query），不自创。
 */

import { redirect } from 'next/navigation'

export default function AdsAutoPauseRedirectPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  // 旧网址上带的 query 原样透传，只把标签钉成 approvals。
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') qs.set(key, value)
  }
  qs.set('tab', 'approvals')
  redirect(`/dashboard/clients/${params.id}/ads-health?${qs.toString()}`)
}
