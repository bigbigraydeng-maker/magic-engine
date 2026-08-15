/**
 * ME2 Product Map v1 —— 幂等 reconciliation 核心（Issue #974「GitHub 动态同步」一节）。
 *
 * 🔴 纯函数，不落库、不发请求。这里只回答一个问题：「给定已有状态和新拿到的一份
 *    GitHub 快照，下一份状态应该是什么」——同样的输入必须得到同样的输出，
 *    这样 webhook 增量、周期 reconciliation、管理员手动 refresh 三条触发路径
 *    才能安全地互相重叠（Issue #974 明确要求这三条都要有，且要幂等）。
 *
 * PR2 会把这层接到真实存储（webhook 收到事件 / cron 定时跑 / admin 按按钮，
 * 三者都调同一个 `mergeSyncSnapshot` + `shouldProcessDelivery`）。
 */

export interface ComponentSyncSnapshot {
  readonly componentId: string
  readonly mainSha: string
  readonly issues: readonly { readonly number: number; readonly state: 'open' | 'closed' }[]
  readonly pullRequests: readonly { readonly number: number; readonly state: string }[]
  /** ISO 时间戳，调用方传入（不在这层调用 `Date.now()`，保持纯函数可测试）。 */
  readonly syncedAt: string
}

export type SyncOutcome =
  | { readonly ok: true; readonly snapshot: ComponentSyncSnapshot }
  | { readonly ok: false; readonly componentId: string; readonly reason: string; readonly failedAt: string }

/**
 * 用新快照覆盖旧快照，但只在新快照不比旧的旧时才覆盖。
 *
 * 这就是幂等的全部含义：webhook 重复投递、cron 与手动 refresh 前后脚触发，
 * 只要各自带着自己实际抓取到的时间戳调用这个函数，乱序到达也不会让状态倒退。
 */
export function mergeSyncSnapshot(
  previous: ComponentSyncSnapshot | null,
  next: ComponentSyncSnapshot,
): ComponentSyncSnapshot {
  if (!previous) return next
  if (previous.componentId !== next.componentId) {
    throw new Error(
      `mergeSyncSnapshot componentId 不一致：previous=${previous.componentId} next=${next.componentId}`,
    )
  }
  return Date.parse(next.syncedAt) >= Date.parse(previous.syncedAt) ? next : previous
}

/**
 * webhook 投递去重。GitHub 的 `X-GitHub-Delivery` header 是每次投递唯一的 ID，
 * 同一个事件重试时会带同一个 ID —— 见过就不再处理第二遍。
 */
export function shouldProcessDelivery(deliveryId: string, seenDeliveryIds: ReadonlySet<string>): boolean {
  return !seenDeliveryIds.has(deliveryId)
}

/**
 * 把一次可能失败的抓取包成 `SyncOutcome`，失败必须显式落一条失败记录，
 * 不能吞掉——Issue #974「失败可观察」的字面要求。
 */
export async function runSyncStep(
  componentId: string,
  fetchSnapshot: () => Promise<ComponentSyncSnapshot>,
  nowIso: () => string,
): Promise<SyncOutcome> {
  try {
    const snapshot = await fetchSnapshot()
    return { ok: true, snapshot }
  } catch (error) {
    return {
      ok: false,
      componentId,
      reason: error instanceof Error ? error.message : String(error),
      failedAt: nowIso(),
    }
  }
}
