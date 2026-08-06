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
 * 「他不买了 / 号码是坏的」走第二条：结论写在**今天的一笔出站触点**上，
 * 冻结版看不见它，所以人留在原桶 —— 必须靠实时版把他标成已处理，
 * 并且**把他排出群发地址**（route 里那一层），否则一个今天亲口说不买的人
 * 当天会收到一封面向他的群发信。
 *
 * ## ⚠️ 已知缺口：「推迟」和「推到成交」目前仍然是点完就消失
 *
 * 这两个改的是 contact 上的字段（`snooze_until` / `stage`），而库里
 * **没有记「什么时候改的」**：`snooze_until` 是个未来日期，`updated_at`
 * 又会被任何一笔触点写动 —— 两个都判不出「是不是今天弄下去的」。
 *
 * 所以它们的行为跟改动前一样（点完人就没了），没变坏但也没修好，
 * 而且会让顶上的「今天一共 N 个」在一天之内缩水。真修要加一个
 * 「什么时候被弄下名单的」时间字段，得 PM 批一次改库。
 * `day-list.test.ts` 里有一条用例把这个现状钉住了 —— 字段加上之后它会失败，
 * 提醒改的人回来把这段说明一起更新。
 */

import type { ContactLike, SegmentResult, TouchpointLike } from './segments'
import { compareForWorklist, segmentContact } from './segments'

/** 一个人今天在名单上的样子，外加「今天动过他没有」。 */
export interface DayRow {
  /** 今天该把他放在哪一批、写什么理由。 */
  seg: SegmentResult
  /**
   * 今天该不该出现在这份名单上。
   *
   * **跟「排哪一批」是两件事，必须分开。** 第一版把两者混在一条 priority 序里
   * （「取更紧急的那一个」），结果同一个假设裂出两道缝，两道都伤客户：
   *
   *   · 今天点了「他不买了」的人，结论写在**今天的出站触点**上，冻结版看不见，
   *     于是冻结版还是 warm、实时版才是「已排除」—— 而「已排除」优先级更低，
   *     取不到 → 人留在原桶，**邮箱还留在群发按钮里**。一个今天亲口说不买的人
   *     当天收到一封面向他的群发信，CRM 里还记一笔我们发过。
   *   · 推迟 / 成交的人两个版本双双是「已排除」，被名单的冷热过滤整个筛掉 ——
   *     **他们照旧凭空消失**，而这个文件的注释和测试都声称修好了。
   *
   * 所以现在三件事各管各的：
   *   `onList`  在不在名单上、排哪    ← 我们今天的动作**不影响**
   *   `handled` 灰不灰、写什么         ← 我们今天的动作**只影响这个**
   *   升级       客人今天让他更紧急了   ← 只在还该在名单上时才允许
   */
  onList: boolean
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

  // 今天开工那一刻他该不该在名单上。**只看冻结版** —— 我们今天做了什么，
  // 不能决定他今天出不出现，否则就又回到「做完就消失」。
  const onList = frozen.temperature === 'hot' || frozen.temperature === 'warm'

  // 实时状态说他已经下名单了（标了不买 / 推迟了 / 成交了）。
  // 这一类不写触点，靠 touchedToday 抓不到。
  const droppedOff = live.temperature === 'off'

  /**
   * 排哪一批。允许**升级**（客人今天回了话，压在「新客人」里等到明天就凉了）。
   *
   * `!droppedOff` 是一道**防御闸，目前触发不到**：所有「已排除」的
   * priority（9）都比任何 hot/warm 大，所以升级判断本来就不会选中它们。
   * 留着是为了将来万一加进一个优先级很高的「off」段 —— 那时候没有这道闸，
   * 一个今天说了不买的人会被当成「更紧急」拉回热桶。
   * **写清楚它测不到，免得下一个人花时间去构造用例。**
   */
  const seg = !droppedOff && live.priority < frozen.priority ? live : frozen

  return {
    seg,
    onList,
    handled: opts.touchedToday || droppedOff,
    // 具体动作优先于泛泛的「联系过了」：「聊过了，明确没兴趣」比
    // 「今天联系过了」信息量大得多，而这个字段存在的全部理由就是说清做了什么。
    handledWhy: droppedOff ? live.reason : opts.touchedToday ? '今天联系过了' : null,
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
    // **按 onList 筛，不按 seg.temperature 筛。**
    // 用 temperature 的话，今天被推迟 / 标不买 / 推成交的人两个版本双双是
    // 「已排除」，会被整个筛掉 —— 他们照旧凭空消失，而这正是要修的毛病。
    .filter((c) => c.onList)
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

/** 「还剩 22」比「已联系 8」有用 —— 销售关心的是还有多远到头。两个都给。 */
export function dayProgress(rows: ReadonlyArray<{ handled: boolean }>): DayProgress {
  return {
    total: rows.length,
    done: rows.filter((r) => r.handled).length,
    left: rows.filter((r) => !r.handled).length,
  }
}
