/**
 * 今天这份名单，一天之内不许在人眼皮底下变。
 *
 * ## 为什么单独一个文件
 *
 * PM 2026-08-05：**「每次点卡片，做了动作后回到目录页，我如何知道哪个已经
 * 联系了？当前的设计无法做成工作流水线。」**
 *
 * 查下来症结不在显示 —— 灰卡和「今天已联系 N 人」8/2 就做好了。症结在**分桶
 * 是实时算的**：你一记录「联系过了」，`lastOutbound` 从 0 变成非 0，这个人
 * 当场就不属于「新客人，还没打过」那一批了。于是他不是变灰，是**换了位置
 * 或者干脆从名单上消失**。那张灰卡根本没机会留在原地给你看。
 *
 * 对一条流水线来说这是最致命的一条：**你脚下的地面在动。**
 * 处理完一个人列表就重排，你得重新找自己推到哪了；而一个人凭空不见，
 * 你连「刚才那一下到底记上没有」都确认不了。
 *
 * ## 规则：只冻结「我们做的动作」，不冻结「客人做的动作」
 *
 * 这是整件事的关键，两边都必须成立：
 *
 *   · **我们今天做的动作，绝不移动任何人。**
 *     打了电话、发了邮件、标了不买、推迟了 —— 卡片就地变灰打勾，位置不动。
 *
 *   · **客人今天做的动作，照常实时进来。**
 *     今天新进线的客人当场出现在名单上（那是最热的线索，等到明天就凉了）；
 *     今天回话的人当场升到最前面。
 *
 * 一句话：**只增不减、不重排。** 一个人可以在一天之内变得更紧急，
 * 但绝不会因为你动了手就消失或跳位。
 *
 * ## 「已处理」为什么不新建一个状态列
 *
 * 这套系统里最贵的教训就是手工状态列：CTS 那份 128 行的手工 CRM，
 * 「阶段」那一列 **0 个填了**。而且多存一列就多一个会跟事实说反话的地方。
 *
 * 所以「今天处理过了没有」全部从**已经存在的事实**推：
 *   · 今天有一笔我们发出的、非机器的联系  → 处理过了
 *   · 或者实时状态已经说他不该在名单上了（标了不买 / 推迟了 / 成交了）→ 也是
 *
 * 第二条尤其要紧：**推迟和「他不买了」不写触点**（推迟改的是 `snooze_until`，
 * 「分错了」写的是反馈表）。它们以前靠「这个人从名单上消失」当反馈；名单
 * 一冻结，他们会留在原地**并且看起来没被处理过** —— 那比改之前更糟。
 */

import type { ContactLike, SegmentResult, TouchpointLike } from './segments'
import { compareForWorklist, segmentContact } from './segments'

/** 一个人今天在名单上的样子，外加「今天动过他没有」。 */
export interface DayRow {
  /** 今天该把他放在哪一批、写什么理由。 */
  seg: SegmentResult
  /** 今天已经动过他了 —— 卡片变灰打勾。 */
  handled: boolean
  /**
   * 已处理的话，是怎么处理的。
   *
   * 光一个灰色只说明「动过」，说不清「我到底做了什么」，
   * 而 PM 问的正是「我如何确认真的记上了」。
   */
  handledWhy: string | null
}

export interface DayRowOptions {
  /**
   * 今天从哪一刻开始（毫秒）。**必须按客户所在地的时间算**，不能用服务器时间。
   *
   * 服务器跑在世界标准时间，比新西兰晚 12 小时 —— 直接用的话
   * **每天中午名单就翻篇了**，上午做完的一批会突然全部变回「没处理」。
   */
  dayStartMs: number
  /** 今天有没有一笔我们发出的、真人做的联系（调用方按触点算好传进来）。 */
  touchedToday: boolean
}

/**
 * 一个人今天在名单上的稳定样子。
 *
 * 算两遍：
 *   · **冻结版** —— 假装我们今天什么都没做（摘掉今天的出站动作）
 *   · **实时版** —— 什么都算
 *
 * 取**更紧急的那一个**。这就是「只增不减」：实时版更热（客人今天回了话）
 * 就跟着升上去；实时版更冷（因为我们刚联系过他）就按冻结版留在原地。
 */
export function dayRow(contact: ContactLike, now: Date, opts: DayRowOptions): DayRow {
  const frozen = segmentContact(withoutOurActionsSince(contact, opts.dayStartMs), now)
  const live = segmentContact(contact, now)

  // priority 越小越紧急。实时版更紧急就用实时版 —— 客人今天回了话，
  // 那是必须当场看见的，压在「新客人」那一批里等到明天就凉了。
  const seg = live.priority < frozen.priority ? live : frozen

  // 实时状态说他已经下名单了（标了不买 / 推迟了 / 成交了）—— 那也是「处理过了」。
  // 这一类不写触点，靠 touchedToday 抓不到。
  const droppedOff = live.temperature === 'off'

  return {
    seg,
    handled: opts.touchedToday || droppedOff,
    handledWhy: opts.touchedToday ? '今天联系过了' : droppedOff ? live.reason : null,
  }
}

/**
 * 把「今天我们做的动作」从这个人的历史里摘掉。
 *
 * **只摘出站的真人动作**，别的一律原样留着：
 *   · 客人今天来的信 / 今天进的线 —— 留着，否则今天最热的线索进不了名单
 *   · 今天的打开 / 点击 —— 留着，那是客人做的，不是我们做的
 */
export function withoutOurActionsSince(contact: ContactLike, sinceMs: number): ContactLike {
  return {
    ...contact,
    touchpoints: contact.touchpoints.filter((t: TouchpointLike) => {
      if (t.direction !== 'outbound') return true
      // 行为信号（打开 / 点击）是客人做的 —— 不摘。
      if (t.engagement) return true
      const at = new Date(t.occurredAt).getTime()
      // 时间读不出来的不敢摘 —— 摘错会让一个已经跟过的人重新冒出来当新客人。
      if (Number.isNaN(at)) return true
      return at < sinceMs
    }),
  }
}

/**
 * 今天这份名单。
 *
 * 跟 `todayWorklist` 的差别只有一条：**它按「今天开工那一刻」分批**，
 * 于是你今天做的动作不会把任何人挪走。排序共用同一个比较函数 ——
 * 两边各写一套的话，同一个人在两处会排在不同位置，而位置正是销售用来
 * 记「我推到哪了」的东西。
 *
 * 已处理的**照样留在名单里**（页面把它们收起来），不在这里筛掉：
 * 筛掉就等于又回到「做完就消失」，那正是要修的毛病。
 */
export function dayWorklist(
  contacts: ContactLike[],
  now: Date,
  opts: { dayStartMs: number; touchedToday: (contactId: string) => boolean },
): Array<ContactLike & DayRow> {
  return contacts
    .map((c) => ({
      ...c,
      ...dayRow(c, now, { dayStartMs: opts.dayStartMs, touchedToday: opts.touchedToday(c.id) }),
    }))
    .filter((c) => c.seg.temperature === 'hot' || c.seg.temperature === 'warm')
    .sort((a, b) => compareForWorklist(a.seg, b.seg))
}

/**
 * 客户所在地的「今天从几点开始」，换算成毫秒。
 *
 * **必须按客户所在地算。** 服务器跑在世界标准时间，比新西兰晚 12 小时 ——
 * 直接用服务器的日子，每天中午名单就翻篇了，上午做完的一批会突然全部
 * 变回「没处理」。这套系统在「今天已跟过」那个数字上已经踩过一次同样的坑。
 */
export function localDayStartMs(now: Date, timeZone: string): number {
  try {
    // en-CA 给的是 YYYY-MM-DD；再问一次那个时区当天 00:00 对应的偏移量。
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    // 先当成 UTC 的零点，再减去该时区的偏移量。
    const asUtc = new Date(`${day}T00:00:00.000Z`).getTime()
    const offsetMs = tzOffsetMs(new Date(asUtc), timeZone)
    return asUtc - offsetMs
  } catch {
    // 时区字符串坏了也不能炸掉整页 —— 退回 UTC 当天零点。最坏结果是
    // 名单在某几个小时里按错的「今天」算，而不是这一页打不开。
    return Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
  }
}

/** 某一刻，某个时区比 UTC 快多少毫秒。 */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  // Intl 在午夜会给出 24，Date.UTC 认得，但为了不依赖那个行为先归零。
  const hour = get('hour') % 24
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asIfUtc - at.getTime()
}

/** 顶上那条进度。 */
export interface DayProgress {
  total: number
  done: number
  left: number
}

/**
 * 「还剩 22」比「已联系 8」有用 —— 销售关心的是还有多远到头。两个都给。
 *
 * `left` 是数出来的，不是 `total - done` 减出来的：将来 handled 变成三态时，
 * 减法会静默算错，而两个数一起数，对不上就看得见。
 */
export function dayProgress(rows: ReadonlyArray<{ handled: boolean }>): DayProgress {
  return {
    total: rows.length,
    done: rows.filter((r) => r.handled).length,
    left: rows.filter((r) => !r.handled).length,
  }
}
