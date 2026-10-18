/**
 * 广告门的标签定义 —— 单独一个文件，不放在 `page.tsx` 里。
 *
 * 🔴 为什么要单独一个文件（2026-10-18 类型检查抓出来的）：
 *    Next 不允许页面文件导出除约定项之外的东西（`export const PAGE_TABS` 会让
 *    `.next/types/.../page.ts` 的约束检查报 TS2344）。而登记表的守卫测试要校验
 *    「登记路径里的 `?tab=` 必须是这一页真有的标签」，就得能读到这份清单。
 *    所以清单放这里，页面和守卫各自 import。
 */

export type PageTab = 'today' | 'ads' | 'approvals' | 'settings'

export const PAGE_TABS: ReadonlyArray<{ key: PageTab; label: string; hint: string }> = [
  { key: 'today', label: '今天看这里', hint: '三句话：池子、频率、今天调什么' },
  { key: 'ads', label: '每条广告', hint: '逐条体检' },
  { key: 'approvals', label: '等你点头', hint: '这个客户等人点头的广告动作' },
  { key: 'settings', label: '目标与设置', hint: '每天预算上限、自动化、可投视频' },
]

/** 网址里 `?tab=` 认的值；认不出的一律落回「今天看这里」，不报错。 */
export function tabFromQuery(raw: string | null): PageTab {
  return PAGE_TABS.some((t) => t.key === raw) ? (raw as PageTab) : 'today'
}
