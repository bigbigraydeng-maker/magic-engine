/**
 * 卡片上的跟进标记 —— 「早上打开这一页，我昨天跟到哪了」。
 *
 * 2026-08-02 PM：「需要对正在跟进中的卡片有一些标记，便于每日上班来查看和跟进」。
 *
 * 早上第一件事，销售要在一眼之内回答三个问题：
 *   1. 这个人今天我动过了吗？   → 动过的当场变浅，不用靠记
 *   2. 昨天是谁跟的？是我吗？   → 两个销售同时跟一个客人，比谁都不跟更糟
 *   3. 上次聊到哪了？           → 拿起电话前必须想起上下文
 *
 * 还有一个**弱信号**要单独说清楚：**打开了邮件**。
 * 它不能进任何一个桶（Apple 隐私保护会替用户自动打开邮件，2026-08-02 那次
 * P0 就是把「打开」当成「客户回话了」，最高优先桶从 15 涨到 200）。但它足够
 * 当一条提示 —— 拿起电话时多一句「看到您看了我们的邮件」是有用的。
 * **所以：打开只做标记，绝不进桶，也绝不参与排序。**
 */

export interface TouchLike {
  direction: 'inbound' | 'outbound'
  occurredAt: string
  summary?: string | null
  /** 行为信号：打开 / 点击。真人消息是 null。 */
  engagement?: 'open' | 'click' | null
  /** 这一笔是谁记的（登录邮箱）。历史数据和自动写入没有。 */
  loggedBy?: string | null
  /**
   * 这一笔是机器做的，不是人做的。
   *
   * 必须分开，否则**一封 Mailchimp 群发会把整块看板标成「今天已经跟过」**——
   * 群发是 outbound、又不带打开/点击标记，跟销售亲手打的一通电话在数据上
   * 长得一模一样。销售第二天早上打开，看到几百张卡都是灰的，会以为活都做完了。
   */
  automated?: boolean
}

export interface FollowUpMarks {
  /** 今天已经有人联系过他了。做完的当场看得见，名单才不会越看越像干不完。 */
  doneToday: boolean
  /** 上次是谁跟的（邮箱 @ 前面那截）。不知道就是 null —— 不假装。 */
  lastBy: string | null
  /** 上次聊了什么。拿起电话前要想起上下文。 */
  lastNote: string | null
  /**
   * 他多少天前打开过我们的邮件，且**那之后没有任何真人联系过他**。
   * 只做提示，不排序、不进桶（打开可能是 Apple 替他开的）。
   */
  openedDaysAgo: number | null
}

const DAY_MS = 86_400_000

/**
 * 客户所在地的「今天是几号」。
 *
 * **必须按客户的时区算，不能用服务器的**。服务器跑在 UTC，销售在新西兰
 * （UTC+12/+13）：他上午 9 点打的电话，在 UTC 里还落在昨天；等纽西兰时间到了
 * 中午，UTC 跨日，他一早做完的事会**突然全部变成「昨天做的」**。名单上的
 * 「今天已经跟过」会在午饭时间集体消失，销售会以为系统把他的活弄丢了。
 */
export function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    // 时区字符串坏了也不能炸掉整页 —— 退回 UTC 的日期，
    // 最坏结果是「今天已跟」偶尔算错，而不是名单打不开。
    return new Date(iso).toISOString().slice(0, 10)
  }
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 邮箱只留 @ 前面那截 —— 卡片一行放不下整个地址，而同事之间叫的就是那截。 */
export function shortActor(email: string | null | undefined): string | null {
  const e = (email ?? '').trim()
  if (!e) return null
  return e.split('@')[0] || null
}

/**
 * 算出这张卡上该显示哪些跟进标记。纯函数，不碰数据库。
 *
 * @param touchpoints 这个人的全部触点（顺序不限）。
 * @param now 现在。显式传入，让「今天」可测。
 * @param timeZone 客户所在地的 IANA 时区（NZ 客户传 Pacific/Auckland）。
 */
export function followUpMarks(
  touchpoints: TouchLike[],
  now: Date,
  timeZone = 'Pacific/Auckland',
): FollowUpMarks {
  const nowMs = now.getTime()

  // 「今天」按客户所在地的自然日算，不是「24 小时内」—— 销售问的是
  // 「我今天动过他没有」，昨天下午 5 点打的那通不该让今天的卡看起来已经做完。
  const today = localDay(now.toISOString(), timeZone)

  // 真人消息 = 不带行为信号的那些。打开/点击既不算「我跟过他」，
  // 也不算「他找过我」。
  const human = touchpoints.filter((t) => !t.engagement)
  // 「我们跟过他」必须是**人**做的动作：群发邮件是系统按名单发的，
  // 不代表有人真的跟这个客人打过交道。
  const ours = human.filter((t) => t.direction === 'outbound' && !t.automated)

  const doneToday = ours.some((t) => localDay(t.occurredAt, timeZone) === today)

  // 最近一次我们做的动作 —— 「谁跟的」和「聊了什么」都从它来。
  const lastOurs = ours.slice().sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0] ?? null
  // 我们还没联系过的人（新线索），上下文就是他自己说的那句。
  const lastAny = human.slice().sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0] ?? null
  const contextFrom = lastOurs ?? lastAny

  const lastOutboundMs = lastOurs ? ts(lastOurs.occurredAt) : 0
  const lastOpenMs = Math.max(
    0,
    ...touchpoints.filter((t) => t.engagement === 'open').map((t) => ts(t.occurredAt)),
  )
  // 我们在他打开之后已经联系过了 → 这条提示没用了，别再挂着。
  const openPending = lastOpenMs > 0 && lastOutboundMs < lastOpenMs

  return {
    doneToday,
    lastBy: shortActor(lastOurs?.loggedBy),
    lastNote: (contextFrom?.summary ?? '').trim() || null,
    openedDaysAgo: openPending ? Math.max(0, Math.floor((nowMs - lastOpenMs) / DAY_MS)) : null,
  }
}
