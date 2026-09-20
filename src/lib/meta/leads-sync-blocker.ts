/**
 * 「这个客户取不到线索，是**授权缺口**还是**故障**」——meta-leads-sync 判整体
 * 成败、判要不要下发人工待办，都从这里分岔。
 *
 * WHY
 * ---
 * 2026-09-18~09-20 实测（生产库 glbdnayojixmexgofbsd）：这个每 2 小时一跑的任务
 * 在 26 小时里跑了 13 次，**13 次全是 failed**，每次都是同一句
 * 「3/5 个客户取不到线索」。三家的病因是 Magic Lab Class / New Asian Logistics
 * 的主页令牌被 Meta 拒了（Graph #190），NZCPE 2026 的主页绑定没核实 —— 三件事
 * 都只有人动手才会好，重跑一万次也一样。
 *
 * 后果不是「多了一条红记录」，而是**这条任务永远是红的**：CTS Tours NZ（5 家里
 * 正常的 2 家之一）哪天真的断供，日检和任何按 status 报警的东西都看不出区别 ——
 * 红色里再多一个红色。这正是 PITFALLS 里「监控自己瞎掉」那一类。
 *
 * 所以分岔的判据是**「重跑会不会好」**，不是「严不严重」：
 *   · 会好（限流 / 5xx / 网络断 / 翻页截断）→ 故障，算进 failed_count；
 *   · 不会好（令牌被拒 / 缺权限 / 绑定没核实）→ 授权缺口，不染红整个任务，
 *     改为给这个客户单独下发一条今日待办（铁律 3 下半：管道不许断头）。
 *
 * 认 code 不认文案：Meta 随时会改 message 的措辞，而正则失效的方向恰好是
 * 「授权缺口被当成故障」—— 也就是又变回天天红。认不出的 code 一律算故障
 * （宁可多红一次，不可把一个只有人能修的缺口悄悄吞掉）。
 */

import type { GraphErrorDetail } from './lead-forms'

/**
 * 只有人动手才会好的三种卡点。
 *
 * `page_binding_unverified` 由 ME 自己的同步闸拦下（AD-SEC-4，见
 * page-sync-authorization.ts），另外两种是 Meta 拒绝我们。
 */
export type LeadsSyncBlocker =
  /** 主页绑定没通过核实，同步已暂停 —— ME 自己拦的，不是 Meta 拒的。 */
  | 'page_binding_unverified'
  /** Graph #190：令牌过期 / 被撤销 / 授权人在这个主页上没角色了。 */
  | 'token_rejected'
  /** Graph #10 / #200 / #3：令牌还活着，但缺这个主页 / 这个接口要的权限。 */
  | 'missing_permission'

/**
 * Graph 报错 → 授权缺口种类。认不出来（含 detail 为 null）返回 null =「按故障处理」。
 *
 * 收哪几个 code：
 *   #190 OAuthException —— 令牌本身被拒。2026-09-20 生产上 Magic Lab Class /
 *        New Asian Logistics 报的就是它（"permission(s) must be granted before
 *        impersonating a user's page"），两家的 OAuth 授权记录都还是 active、
 *        scopes 也齐 —— 存下来的令牌已经不作数了，只有重点一次「连接 Meta」能好。
 *   #10 / #200 —— 权限不足。2026-08-30 那次是
 *        "(#200) Requires pages_manage_ads permission"。
 *   #3 —— 应用没有调这个接口的能力（App Review 没过）。同样只有人能办。
 * 限流（#4 / #17 / #32）、#1 / #2 临时故障、5xx 都**不收**：它们下一轮就可能好，
 * 当成授权缺口会把真故障藏进「等人处理」里。
 */
export function classifyLeadsSyncBlocker(
  detail: GraphErrorDetail | null | undefined,
): LeadsSyncBlocker | null {
  if (!detail) return null
  if (detail.code === 190) return 'token_rejected'
  if (detail.code === 10 || detail.code === 200 || detail.code === 3) return 'missing_permission'
  return null
}

/**
 * 一个客户这一轮攒下的多条报错 → 一个卡点结论。
 *
 * 取**第一个**认得出来的：同一把令牌被拒时每个表单都会报同一句，后面的没有新信息。
 */
export function firstLeadsSyncBlocker(
  details: readonly (GraphErrorDetail | null | undefined)[],
): LeadsSyncBlocker | null {
  for (const d of details) {
    const blocker = classifyLeadsSyncBlocker(d)
    if (blocker) return blocker
  }
  return null
}
