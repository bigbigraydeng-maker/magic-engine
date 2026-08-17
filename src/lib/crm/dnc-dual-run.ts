/**
 * 双跑对比：把「能不能联系他」这个判断**现在的算法**和**只看事实的算法**
 * 各跑一遍，把差异列出来 —— **只看，不改任何数据**。
 *
 * ## 为什么这是第一步（方案 §8，2026-08-17）
 *
 * 「事实优先」重设计的第一刀是把拒联判断改成**只从事实算**，不再读
 * `contacts.do_not_contact` 那一列。但直接切是在赌，因为：
 *
 * 现在的判据是 `列 || 任何一条触点说过`（见 `lib/crm/dnc` 的 `isDoNotContact`）。
 * 改成只看触点之后，新判据是旧判据的**子集** —— 唯一可能的差异是
 * **「只有那一列说他被停了，触点里一条证据都没有」** 的人。
 *
 * 这批人切换后会**重新开始收到我们的消息**。如果他们当初真的说过「别再联系」，
 * 只是触点那一步写失败了，那就是**直接违反客户红线**。
 *
 * 所以顺序只能是：先把这批人一个个看过，再决定切不切。**没有这个名单，
 * 切换那一刻就是在赌。**
 *
 * ## 这个文件一行写操作都没有
 *
 * 它的全部产出是一份名单。改不改、怎么改，是看完名单之后的决定。
 */

import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'

export interface DualRunContact {
  id: string
  displayName: string | null
  /** `contacts.do_not_contact` 那一列。 */
  flag: boolean
  touches: DncTouch[]
}

export interface DualRunDiff {
  contactId: string
  displayName: string | null
  /** 这个人一共有多少条触点 —— 0 条说明档案薄，人工复核时要格外小心。 */
  touchCount: number
  /** 最后一条触点什么时候（没有触点就是 null）。 */
  lastTouchAt: string | null
}

export interface DualRunResult {
  /** 看了多少人。 */
  examined: number
  /** 现在的算法判成「不能联系」的人数。 */
  blockedNow: number
  /** 只看事实的算法判成「不能联系」的人数。 */
  blockedFactsOnly: number
  /**
   * 🔴 切换之后**会重新开始被联系**的人 —— 这份名单是这个工具的全部意义。
   *
   * 每一个都得人看过：他当初到底有没有说过「别再联系」？
   * 说过 → 触点那一步写失败了，切换前必须先把这条事实补回去。
   * 没说过 → 那一列本来就不该是 true，切换正好把他放回名单。
   */
  wouldUnblock: DualRunDiff[]
  /**
   * 反方向的差异 —— **正常情况下应该恒为 0**。
   *
   * 现在的判据是「列 || 触点」，只看事实是「触点」，后者是前者的子集，
   * 所以不该出现「只有新算法说停」的人。真出现了说明我对现有判据的理解有错，
   * **必须停下来查清楚再往下走**，不能当成噪音忽略。
   */
  unexpectedNewBlocks: DualRunDiff[]
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function toDiff(c: DualRunContact): DualRunDiff {
  const last = c.touches.reduce<string | null>(
    (acc, t) => (ts(t.occurredAt) > ts(acc) ? t.occurredAt : acc),
    null,
  )
  return {
    contactId: c.id,
    displayName: c.displayName,
    touchCount: c.touches.length,
    lastTouchAt: last,
  }
}

/**
 * 纯对比 —— 两套判据各跑一遍，把差异分成两堆。
 *
 * 新判据**故意不复用** `isDoNotContact`，而是显式写成 `isDoNotContact(false, touches)`：
 * 判据只有一份（还是那个函数），变的只是**喂不喂那一列**。这样对比的是
 * 「输入变了」而不是「换了个函数」—— 否则差异里会混进函数本身的差别，
 * 说不清是哪一边造成的。
 */
export function compareDncVerdicts(contacts: DualRunContact[]): DualRunResult {
  const result: DualRunResult = {
    examined: contacts.length,
    blockedNow: 0,
    blockedFactsOnly: 0,
    wouldUnblock: [],
    unexpectedNewBlocks: [],
  }

  for (const c of contacts) {
    const now = isDoNotContact(c.flag, c.touches)
    // 只看事实 = 那一列当成没填过
    const factsOnly = isDoNotContact(false, c.touches)

    if (now) result.blockedNow++
    if (factsOnly) result.blockedFactsOnly++

    if (now && !factsOnly) result.wouldUnblock.push(toDiff(c))
    if (!now && factsOnly) result.unexpectedNewBlocks.push(toDiff(c))
  }

  // 名单按「触点越少越靠前」排 —— 档案最薄的人最难判、最需要人先看。
  result.wouldUnblock.sort((a, b) => a.touchCount - b.touchCount)
  return result
}
