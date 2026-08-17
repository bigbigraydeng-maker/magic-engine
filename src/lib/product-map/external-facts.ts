/**
 * 外部动态事实的注入模型 —— 成熟度推导需要的 GitHub 状态从这里进来。
 *
 * 🔴 设计约束（子牙设计审的阻塞项）：登记册（registry/）只存 PR **身份**；
 *    「merged 与否」这类会变的事实**绝不落静态数据**，而是作为参数注入
 *    `deriveMaturity(component, facts)`。PR 1 用本文件的手工快照充当 provider，
 *    PR 2 把它换成 GitHub 同步的持久化快照 —— 推导函数的签名不变。
 */

export const PR_FACT_STATE = ['open', 'merged', 'closed'] as const
export type PrFactState = (typeof PR_FACT_STATE)[number]

export interface PullRequestFact {
  readonly number: number
  readonly state: PrFactState
  readonly isDraft: boolean
  /** 这份事实是哪天观察到的（YYYY-MM-DD）。 */
  readonly observedAt: string
  /**
   * - `manual_snapshot`：人工核对 GitHub 后手写（PR 1 的全部来源）——控制台必须明示。
   * - `github_sync`：GitHub 同步器写入（PR 2 起）。
   */
  readonly source: 'manual_snapshot' | 'github_sync'
  /**
   * PR 的目标分支（github_sync 事实必带；manual_snapshot 快照可缺省）。
   * 🔴 codeInMain 判 yes 的硬前提：merged 只有在 `baseRef==='main'` 时才证明代码进了 main。
   *    合并到 staging / 功能分支的 PR 不能宣称「代码已进入 main」；缺失 → fail-safe 不判 yes。
   */
  readonly baseRef?: string
}

export interface ExternalFacts {
  /** 按 PR 号索引。查不到的 PR 号 = 无事实，推导时不得当作 merged。 */
  readonly pullRequests: Readonly<Record<number, PullRequestFact>>
}

/** 空事实：任何 PR 都查无状态。测试与降级路径用。 */
export const EMPTY_EXTERNAL_FACTS: ExternalFacts = Object.freeze({
  pullRequests: Object.freeze({}),
})

/**
 * PR 1 阶段的手工快照 —— 2026-08-15 逐个在 GitHub 上核对（gh pr view）。
 * 只登记登记册里引用到的 PR。PR 2 上线后这份常量废弃，事实改由同步器提供。
 */
export const MANUAL_FACTS_SNAPSHOT: ExternalFacts = Object.freeze({
  pullRequests: Object.freeze({
    863: { number: 863, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    890: { number: 890, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    894: { number: 894, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    895: { number: 895, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    897: { number: 897, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    898: { number: 898, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    907: { number: 907, state: 'open', isDraft: true, observedAt: '2026-08-15', source: 'manual_snapshot' },
    914: { number: 914, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    922: { number: 922, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    956: { number: 956, state: 'merged', isDraft: false, observedAt: '2026-08-15', source: 'manual_snapshot' },
    962: { number: 962, state: 'open', isDraft: true, observedAt: '2026-08-15', source: 'manual_snapshot' },
    973: { number: 973, state: 'open', isDraft: true, observedAt: '2026-08-15', source: 'manual_snapshot' },
  } satisfies Record<number, PullRequestFact>),
})
