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
 * 这两个改的是 contact 上的字段（`snooze_until` / `stage`），冻结副本原样
 * 带过去，于是两个版本双双「已排除」，被 `dayWorklist` 的 `onList` 过滤掉。
 *
 * **不是数据不够 —— 两个出口的时间证据一直都在库里，只是没人读**
 * （子牙 2026-08-06 复审纠正了这里原先的错误说法）：
 *
 *   · 改阶段 → `contacts.stage_updated_at`，**已有的列**
 *     （20260728000001 建的，`contacts/[cid]/stage/route.ts` 每次都在写），
 *     只是 `today/route.ts` 的 SELECT 没把它选出来
 *   · 推迟   → snooze 路由已经写了一笔**今天的、`me_manual` 的出站触点**
 *     （`contacts/[cid]/snooze/route.ts` 调 `recordManualTouchpoint`），
 *     也就是说 `touchedToday` 对今天被推迟的人本来就已经是 true 了。
 *     要认出「这一笔是推迟」，在 metadata（jsonb）里加个键即可 —— **不是加列**
 *
 * 所以真修**不需要改库、不需要占用 PM 一次决策**：把这两条读进来，
 * 让 `withoutOurActionsSince` 在「今天弄下去的」时清掉冻结副本上的
 * `snoozeUntil` / `stageSuppressed`，行为就是本文件承诺的那个。
 *
 * 没在 PR #855 里做，见 `docs/ROADMAP.md` M2.7a。`day-list.test.ts` 里有一条
 * 用例把现状钉住了 —— 修好之后它会失败，提醒回来把这段说明一起更新。
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
  /**
   * 动过的那一下，**是「还要继续跟」还是「这条线断了」**。
   *
   * 板桥 2026-08-06（销售视角复审）：折叠按钮上那个「今天处理了 8 人」
   * 把两件性质完全不同的事盖在同一个数字里 ——
   *
   *   · 打了电话 / 回了邮件 → 活还在，明天继续
   *   · 标了不买 / 号码不通 → 这条线断了
   *
   * 他的原话：「一个不该当业绩看的数字，长得太像业绩了。」
   * 混着数还有个更别扭的后果 —— **清空今天名单最快的办法变成把人全标死**。
   * 所以数字必须拆开：`跟进 5 人 · 关掉 3 人`。
   */
  handledKind: 'followed' | 'closed' | null
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
 * 然后三件事各管各的，**不许混成一条 priority 序**（第一版就是混的，
 * 裂出两道都伤客户的缝，见 `DayRow.onList` 的注释）：
 *
 *   `onList`   在不在名单上   ← 只看冻结版。我们今天做了什么，不能决定他出不出现
 *   `escalated` 客人今天又动了 ← 实时版更紧急 = 我们碰过他之后他又做了什么
 *   `handled`  灰不灰         ← 我们碰过他 **且** 他没回过头来找我们
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
   * **客人今天让他重新变紧急了。**
   *
   * 「实时版比冻结版更紧急」这件事只可能由客人造成 —— 我们自己的动作已经
   * 从冻结版里摘掉了。所以它精确等于「我们碰过他之后，他又做了什么」。
   *
   * `!droppedOff` 是一道**防御闸，目前触发不到**：所有「已排除」的
   * priority（9）都比任何 hot/warm 大，升级判断本来就不会选中它们。
   * 留着是防将来加进一个优先级很高的「off」段。
   * **写清楚它测不到，免得下一个人花时间去构造用例。**
   */
  const escalated = !droppedOff && live.priority < frozen.priority

  // 「他还欠我一次动作吗」—— 这一条决定灰不灰，**不能拿 escalated 代替**。
  const stillNeedsMe = needsMeAgain(contact, live, now, opts.dayStartMs)

  return {
    /**
     * 位置按冻结版排，**但「约好几点回电」取实时那个**。
     *
     * 这两半各修一个真问题，而且必须分开修：
     *
     *   · 位置按冻结版 —— 否则销售在通话备注里随手提一句时间
     *     （`note-parser` 会把它解析成回电约定），这个人当场换桶；
     *     写「客人说明年三月走，下周再打给他」的话，`travelWindow` 一并生效，
     *     **人从名单上彻底消失**。而这正是本文件要修的毛病本身。
     *   · 时间取实时 —— 否则今晨刚约好的「今天 14:00」被冻结版丢掉，
     *     卡片翻出身上那个过期旧约「之前约好这个时间回电 · 2 天前」，
     *     销售拿起电话第一句就说错。
     *
     * 上一版把整条带 `callbackAt` 的触点从冻结里豁免出去，等于让这通电话的
     * 方向、时间、通话结果、出行意向**全部**对冻结版可见 —— 冻结当场失效。
     * 真正需要逃出冻结的只有 `dueAt` 这一个显示值。
     */
    seg: escalated ? live : { ...frozen, dueAt: live.dueAt ?? frozen.dueAt },
    onList,
    /**
     * 🔴 **升级过的人绝不能算「已处理」。**
     *
     * `touchedToday` 只问「我们今天碰过他没有」，不问碰过之后客人又做了什么。
     * 而这一版把已处理的人整批收进折叠区 —— 两者相乘就出事：
     *
     *   早上发了邮件、客人下午回了话 → 我们「碰过」他 → 收进「✓ 今天处理了 N 人」
     *   上午打电话、约好下午两点回电 → 到点了 → 同样被收起来
     *
     * 这两个人都在等我们，却被折叠按钮盖住，进度条还把他们算进「已完成」，
     * 甚至可能弹出「今天全推完了 🎉」。这跟 PM 那句「我如何知道哪个已经联系了」
     * 是同一类伤害，只是方向反过来：不是做完的看不见，是**没做完的被当成做完了**。
     *
     * ⚠️ 第一版拿 `escalated`（实时版比冻结版更紧急）当这件事的代理，**不够**：
     * 它只在客人的动作把人**推去了另一个桶**时成立。客人在**同一个桶**里
     * 再动一次，两边 priority 相等，代理当场失效。实测漏掉的：
     *
     *   · 一天之内来回两轮邮件（接了 info@ 之后 CTS 的日常）——
     *     卡片自己写着「客户来消息了，已经等了不到 1 小时」，还是被折叠掉
     *   · 身上挂着一个过期旧约的人，今晨又约了今天下午 —— 同桶，照旧被埋
     *
     * 所以这里直说那件事本身：**我们今天最后一次出手之后，他又动了没有。**
     */
    handled: !stillNeedsMe && (opts.touchedToday || droppedOff),
    /**
     * 具体动作优先于泛泛的「联系过了」——「聊过了，明确没兴趣」信息量大得多。
     *
     * 两处措辞是板桥定的（销售视角）：
     *   · 「标了：」这三个字说清**这是你刚才做的动作**，不是系统对这个人的评价。
     *     没有它，卡片上一个绿勾加一句「号码是坏的」，读起来像「✓ 打不通」是个成就
     *   · 「他还没回」补上后半句 —— 销售真正想知道的是他回了没有。
     *     这句是**算出来的事实**：`handled` 只在 `!stillNeedsMe` 时为真，
     *     也就是我们出手之后他确实没再动过
     */
    handledWhy: stillNeedsMe
      ? null
      : droppedOff
        ? `标了：${live.reason}`
        : opts.touchedToday
          ? '今天联系过了，他还没回'
          : null,
    handledKind: stillNeedsMe ? null : droppedOff ? 'closed' : opts.touchedToday ? 'followed' : null,
  }
}

/** 时间读不出来就当没有 —— 不猜。 */
function tsOf(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 我们今天出手之后，又冒出来「需要我再动一次手」的新事实。
 *
 * 这是「灰不灰」的真正判据。**不能用「实时版比冻结版更紧急」当代理** ——
 * 那个只在客人的动作把人推去了另一个桶时成立；客人在同一个桶里再动一次，
 * 两边 priority 相等，代理失效，人照旧被折叠进「今天已处理」。
 *
 * 两种「新事实」，都是**客人侧**的：
 *   · 他开了口，或者点了我们发的链接
 *     （**打开不算** —— Apple 的隐私保护会替用户自动打开邮件，
 *      这套系统 2026-08-02 已经因为把「打开」当成「回话了」出过一次 P0）
 *   · 今天约好的回电到点了 —— 这个人今天还欠一通电话
 *
 * 判据锚在**我们今天最后一次出手**上，不是锚在「今天零点」：
 * 早上他来过信、我们中午回了 —— 那笔来信在我们出手之前，不该再算他在等。
 */
export function needsMeAgain(
  contact: ContactLike,
  live: SegmentResult,
  now: Date,
  dayStartMs: number,
): boolean {
  const ourLast = Math.max(
    0,
    ...contact.touchpoints
      .filter((t) => t.direction === 'outbound' && !t.engagement && tsOf(t.occurredAt) >= dayStartMs)
      .map((t) => tsOf(t.occurredAt)),
  )
  // 今天还没出过手 —— 那就谈不上「出手之后」，这个人本来就没被标成已处理。
  if (ourLast === 0) return false

  const customerActed = contact.touchpoints.some(
    (t) =>
      ((t.direction === 'inbound' && !t.engagement) || t.engagement === 'click') &&
      tsOf(t.occurredAt) > ourLast,
  )

  // 今天约好的回电到点了。约定时间要在我们最后一次出手**之后**——
  // 否则一个早就过期的旧约会让这个人永远灰不了。
  const callbackCameDue =
    live.dueAt !== null && tsOf(live.dueAt) > ourLast && tsOf(live.dueAt) <= now.getTime()

  return customerActed || callbackCameDue
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
