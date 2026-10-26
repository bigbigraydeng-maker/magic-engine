/**
 * 「有专属审批入口的动作」登记表 —— 全仓**唯一**一张。
 *
 * 🔴 为什么要有它：同一条等人点头的 run，早先会同时出现在
 *    ① 通用 handoff 待办（「审批入口还没上线，回我一句」，链接为空）和
 *    ② 动作自己的专属待办（链接直达专属批准页）里 —— 两条互相矛盾。
 *    通用审批页（`kernel-approval/`）还能对它点「同意」，但那里**只签不执行**，
 *    批完广告不会停，专属页那条随后反而批不了。
 *
 *    登记在这里 = 声明「这个动作的批准只走它自己的入口」。消费方：
 *      · `handoff.ts`         —— 等批准的这类 run 不再发通用待办（查询层就排除）；
 *      · `kernel-approval/`   —— 通用审批面对这类 run 服务端拒绝批准，界面给专属页链接；
 *      · 动作自己的待办生成器 —— 链接从这里取，不另写一份路径。
 *
 * 🔴 新增一行的前提（守卫测试盯着）：
 *      · `actionKey` 必须在 `ACTION_REGISTRY` 里；
 *      · `path()` 指向的页面文件必须真实存在；
 *      · 那个专属待办必须从 `action_runs` 读真相（不能只读自己的账表），
 *        否则通用待办一跳过，账表漏记的 run 就从所有待办里消失了。
 *
 * 纯数据 + 纯函数、零 import：服务端和客户端组件都能安全引用。
 */

export interface DedicatedApprovalEntry {
  readonly actionKey: string
  /** 给人看的入口名，出现在待办和通用审批页的链接文案里。 */
  readonly label: string
  /** 站内路径（不含域名）。入参只有 clientId。 */
  readonly path: (clientId: string) => string
}

export const DEDICATED_APPROVAL_ENTRIES: readonly DedicatedApprovalEntry[] = [
  {
    actionKey: 'ads.auto_pause_on_d3',
    label: '广告门 ·「等你点头」',
    /**
     * 2026-10-18：内容从 `ad-health/auto-pause` 整段搬进广告门的标签
     * （设计稿 `2026-10-18-ads-door-merge-design-v0.1.md` §5 步 2）。
     * 改这一行，待办里的链接和页面里的链接会一起跟着走 —— 这就是把路径收在一张表里的用处。
     * 旧网址保留为跳转，已经发出去的待办邮件不会失效。
     */
    path: (clientId) => `/dashboard/clients/${encodeURIComponent(clientId)}/ads-health?tab=approvals`,
  },
]

export function dedicatedApprovalEntryFor(actionKey: string): DedicatedApprovalEntry | null {
  return DEDICATED_APPROVAL_ENTRIES.find((e) => e.actionKey === actionKey) ?? null
}

export function dedicatedApprovalActionKeys(): string[] {
  return DEDICATED_APPROVAL_ENTRIES.map((e) => e.actionKey)
}
