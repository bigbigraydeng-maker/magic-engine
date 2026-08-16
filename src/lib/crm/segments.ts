/**
 * 「今天该联系谁」—— 冷热分级。
 *
 * 分段直接照搬 PM 在 Google Sheet 第 4 个 tab 里手工维护的那份：
 *   一、客户已回信（最优先，当天回电/回邮）
 *   二、已约回电（按约定时间打）
 *   三、新 lead 待首联（当天必打）
 * 他已经把要什么写清楚了，这里不另发明，只是让系统自己算出来。
 *
 * 加了三段他表里没有、但数据里明明白白存在的：
 *   · 打不通（110 人）—— 继续空打没有意义，该换渠道
 *   · 以后才走（19 人）—— 现在打是打扰，明年二月才是时候
 *   · 别再联系（9 人）—— 任何渠道都不许再发
 *
 * 全部是纯函数：段位从触点算出来，不依赖任何人去某一列填状态。
 * CTS 那份手工 CRM 就是死在这一点上 —— 128 行里「阶段」列 0 个填了，
 * 于是自动提醒退化成 122 条一模一样的红字。
 */

export type Segment =
  | 'replied'          // 客户回了，还没人接话
  | 'callback_due'     // 约好的时间到了
  | 'new_untouched'    // 进线了，没人联系过
  | 'clicked_link'     // 点开了我们邮件里的某个链接，之后没人跟
  | 'handoff_sop'      // 联系不上超过 3 天，交给自动跟进
  | 'retry_channel'    // 打过一次没人接
  | 'stale_conversation' // 聊过一轮就断了，没约下次
  | 'nurture_future'   // 说了以后才走，时候还没到
  | 'excluded'         // 别再联系 / 号码是坏的 / 明确没兴趣

import { resolveTravelDate, isDueToWake } from './travel-date'
// 「别再联系」的判据全仓只有一份 —— 这里要的是「什么时候被人推翻过」。
import { withoutClearedDnc } from './dnc'

export type Temperature = 'hot' | 'warm' | 'cold' | 'off'

/**
 * 每一桶「是什么人 / 该拿他怎么办」。
 *
 * 为什么要有这个:一次把 186 个人铺成一条长河,最烫的 6 个人会被 108 个
 * 打不通的埋掉 —— 销售看到的还是「一大坨」,跟他逃离的 Excel 没区别。
 * 分了桶还不够,每桶必须直说「这批人该怎么办」,否则销售面对 108 个
 * 打不通的人只会继续一个个空打(已经证明打不通了)。
 *
 * API 和页面共用这一份,避免两边各写一套文案、日后漂移。
 */
export interface SegmentActionMeta {
  /** 桶名(销售看的)。 */
  label: string
  /** 这批人该怎么办 —— 一句话,带动作。 */
  howTo: string
  /** 整桶一起做的动作:逐个打电话,还是一次性群发。 */
  batch: 'call_one_by_one' | 'send_email' | 'none'
}

export const SEGMENT_ACTION_META: Record<Segment, SegmentActionMeta> = {
  replied: {
    label: '客户回话了',
    howTo: '客户主动来消息了，今天一定要回 —— 这批最容易成。先打电话，打不通再回邮件。',
    batch: 'call_one_by_one',
  },
  callback_due: {
    label: '该回电了',
    howTo: '之前答应了这个时间给他打，现在到点了。现在就打，拖了显得不上心。',
    batch: 'call_one_by_one',
  },
  // 客人自己说过什么时候走，现在时间快到了。这是最明确的购买窗口 ——
  // 以前这批人被无限期压在「以后才走」里，没有任何东西会把他们叫醒。
  new_untouched: {
    label: '新客人，还没打过',
    howTo: '刚留下资料，人还热着。越早打通越容易成 —— 先打里面最新的。',
    batch: 'call_one_by_one',
  },
  clicked_link: {
    // ⚠️ 措辞刻意保守：Mailchimp 只告诉我们「点了 / 没点」，**不告诉我们点的是
    // 哪个链接**。所以不能说「看了行程」—— 他可能点的是页脚的社媒图标。
    // 说得比知道的多，销售照着开场白问「您看的那条线」，客人一句「我没看啊」，
    // 这一页就开始不被信任。要真说得出是哪条线，得再接 Mailchimp 的按链接明细。
    label: '点了邮件里的链接',
    howTo: '他点开了我们邮件里的链接 —— 人还热着，但那之后没人联系过他。今天打给他，先问问他在看哪条线。',
    batch: 'call_one_by_one',
  },
  // 名字和文案都不能说「打不通」:后台判据只是「打了一次没人接」。
  // 中午没接的人晚上会接 —— 系统斩钉截铁说一件销售凭经验知道是假的事,
  // 他会连带不信这一页其他三桶。而这是最大的一桶(CTS 108 人 / 58%)。
  handoff_sop: {
    label: '交给系统跟',
    // 两种来路都落在这批：打过没接上的、和进线太久一直没人碰的。
    // 每个人卡片下面那行原因会说清楚他是哪一种。
    howTo: '今天不用一个个打了 —— 有的打过没接上，有的进线太久。系统会继续碰，他一开口就跳回最上面。',
    batch: 'send_email',
  },
  retry_channel: {
    label: '打过没人接',
    howTo: '这批打过一次，没人接。别原样再打一遍 —— 换个时段再试（晚上通常好打），或者一次性给他们发封邮件（下面有按钮）。',
    batch: 'send_email',
  },
  // 「聊过一轮就断了」以前被兜底并进「以后才走」,还被贴上「打了是打扰」的标签
  // 埋进折叠区 —— 等于系统亲手弄丢了一批最该回头捞的温线索。单独成桶。
  stale_conversation: {
    label: '聊过了，没下文',
    howTo: '聊过一轮就断了，也没约下次。挑等得最久的回一句，问问定下来没有。',
    batch: 'call_one_by_one',
  },
  nurture_future: {
    label: '以后才走',
    howTo: '他说了以后才走，现在打是打扰。到时间系统会把他捞回名单。',
    batch: 'none',
  },
  excluded: {
    label: '别再联系',
    howTo: '明确拒绝过 / 号码是坏的 / 已经成交。不要联系。',
    batch: 'none',
  },
}

export interface TouchpointLike {
  channel: string
  direction: 'inbound' | 'outbound'
  occurredAt: string
  /**
   * 这条不是「谁说了一句话」，而是**行为信号**：邮件被打开 / 链接被点。
   *
   * 必须跟真人消息分开，否则「打开了邮件」会被下面的规则 2 当成「客户回话了」
   * 塞进最高优先桶。2026-08-02 实测：邮件反应同步打开当天，那个桶从 15 人涨到
   * 200 人，其中 185 人只是打开过邮件、175 人连链接都没点 —— 15 个真的在等
   * 回复的客户被埋掉。而且 Apple 的隐私保护会替用户自动打开邮件，「打开」这个
   * 信号本身就不可信。
   */
  engagement?: 'open' | 'click' | null
  /**
   * 这一笔出站是**机器发的**（群发工具、AI 外呼），不是人做的动作。
   *
   * 判据在 lib/crm/automated-touch。加在这里是因为 `needsMeAgain`（day-list）
   * 要判「我们今天最后一次**真人**出手是几点」—— 拿一封 16:00 的群发当
   * 「我们出手了」，会把 15:00 客人的回信整个盖住，当天最热的线索被折叠掉。
   *
   * ⚠️ **本文件的 `segmentContact` 目前不读它**（ROADMAP M2.7f）—— 一封群发
   * 照样被它当成「我们最后一次出站」，于是「客人回话了」那条规则不成立，
   * 人掉进别的桶。这里写明，是因为**一个只接了一半的概念会坑下一个人**，
   * 而这个字段本身就是为了修那种坑才加的。
   */
  automated?: boolean
  /**
   * 这一笔是销售**按了哪个按钮**，不是聊了什么。
   *
   * · `'snooze'`（推迟）—— `withoutOurActionsSince`（day-list）靠它认出
   *   「今天这个人是被推迟的」，从而在冻结副本上把 `snoozeUntil` 一起清掉；
   *   否则冻结版和实时版双双「已排除」，人点完推迟就从名单上消失了。
   * · `'unsnooze'`（取消推迟）—— **什么都不清**，只表示「这一笔是安排名单，
   *   不是联系了这个人」。两者必须分开：写入是两步且不在一个事务里，
   *   取消推迟若第二步失败，一个 `'snooze'` 标记会去清掉依然有效的旧推迟。
   *
   * 两个值都要被读路径排除在「今天动过谁」之外 —— 客人那头什么都没收到。
   * 写入侧见 `RecordTouchpointInput.action`。
   */
  action?: 'snooze' | 'unsnooze' | null
  /**
   * 这一笔从哪来的（`contact_touchpoints.source`）。
   *
   * 目前只有一个用处，但很要紧：判「电话线通不通」时要分得清
   * **真的打通了** 和 **销售打字打出来的 `spoke`**。见 `phoneLineIsDead`。
   */
  source?: string | null
  outcome?: string | null
  travelWindow?: string | null
  callbackAt?: string | null
}

/**
 * 触点的 metadata → 行为信号类型。两个读模型（今天名单 / 全部客人）共用，
 * 不各写一套 —— 判据漂移会让同一个人在两个页面属于不同的桶。
 */
export function engagementFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): 'open' | 'click' | null {
  if (!metadata) return null
  if (metadata.email_clicked === true) return 'click'
  if (metadata.email_opened === true) return 'open'
  return null
}

export interface ContactLike {
  id: string
  displayName: string | null
  doNotContact: boolean
  touchpoints: TouchpointLike[]
  /**
   * 员工把这个人推进到了「结论性」阶段(成交 / 转售后 / 停止营销 / 终态)。
   *
   * 触点算不出这类状态 —— 「付了定金」不会自己变成一条通话记录。没有这一条,
   * 员工改完阶段人照旧留在明日名单上,「改阶段」就退化成又一个没人看的状态列,
   * 跟 CTS 那份手工 CRM 死法一模一样。判断在 lib/crm/pipeline 里(marketing_action
   * ∈ suppress/postsale/won 或 is_terminal)。
   */
  stageSuppressed?: boolean
  /** 当前阶段的中文名,只用于展示。 */
  stageLabel?: string | null
  /**
   * 销售把这个人推迟到了这个时间（contacts.snooze_until）。
   *
   * 在此之前不进今天的名单，**到点自动回来** —— 不需要任何人记得把他放回去。
   * 这是「推迟」和「手动改分组」的关键区别：它改变的是系统看到的事实，
   * 于是重算的结果跟着变；而手动改分组是把结果按住，那种状态没人会去维护。
   */
  snoozeUntil?: string | null
  /**
   * 今天被推进到一个「不再联系」的阶段，**而且今天早上他本来在名单上**。
   *
   * `segmentContact` 自己不读它 —— 用处只有一个：让 `withoutOurActionsSince`
   * 在冻结副本上把 `stageSuppressed` 清掉，人留在原位变灰，而不是点完就消失。
   *
   * ⚠️ 后半句是关键（Codex 复审 2026-08-15）：光看「今天改过阶段」不够。
   * 一个**本来就不在名单上**的人（已付定金）今天被推到另一个同样不在名单上的
   * 阶段（付清了），光凭「今天改过」就清掉抑制，冻结版会按历史触点把他判成
   * warm、**塞进今天要联系的名单** —— 一个已经付清全款的客人跳出来让人去推销。
   *
   * 所以由读路径按 `contact_stage_events.from_stage` 算好：改之前那个阶段
   * 抑不抑制。改之前就抑制 → 他早上本来就不在名单上 → 不清。
   */
  stageSuppressedToday?: boolean
  /**
   * 这个人**实际能怎么被联系到**。
   *
   * 三个都不传 = 调用方没提供这个信息，此时保持规则原本建议的渠道（向后兼容，
   * 不替老调用方猜）。传了就必须如实 —— 建议一个联系不到的渠道，比不建议更糟。
   */
  hasPhone?: boolean
  hasEmail?: boolean
  hasMessenger?: boolean
}

export interface SegmentResult {
  segment: Segment
  temperature: Temperature
  /** 排序用，越小越靠前。 */
  priority: number
  /** 一句人话，告诉销售为什么这个人在今天的名单上。 */
  reason: string
  /**
   * 建议用哪个渠道 —— 打过没人接的，再打一次多半还是没人接。
   *
   * **它必须落在这个人真的能被联系到的渠道上。** 2026-08-02 PM 反馈：
   * 「新客人，还没打过」桶写着「越早打通越容易成」，但 CTS 名单里 124 人（26%）
   * 根本没有电话号码 —— 其中 106 人只有 Facebook 身份（私信补挂进来的）。
   * 让销售去打一个打不了的人，这一页就会开始不被信任。
   */
  suggestedChannel: 'phone' | 'sms' | 'email' | 'messenger' | 'none'
  /**
   * 库里有号码，但**这个号打不通**（有人点过「号码是坏的」）。
   *
   * 卡片必须靠它区分两种长得一样、说法完全不同的情况：
   *   · 没留电话   → 「没留电话 —— 只能发邮件」
   *   · 号码是坏的 → 「这个号打不通 —— 先用邮件，顺便问他要个新号」
   * 对一个抽屉里明明存着号码的人说「没留电话」，销售一眼就能戳穿，
   * 而这一页最贵的资产就是「它说的话可信」。
   */
  phoneUnusable?: boolean
  /**
   * 这一段**本来**想用哪个渠道 —— 还没按「他能不能被联系到」降级之前的那个。
   *
   * `dayRow` 的冻结合并要用它：号码今天修好了要把电话放回来，如果拿
   * `suggestedChannel`（**已经降级成邮件**的那个）去重解一次，永远爬不回电话。
   * 必须从这一段原本的意图重新解。
   */
  wantedChannel?: SegmentResult['suggestedChannel']
  /** 约定的回电时间，有就带上。销售拿起电话前一定会想「我约的几点」。 */
  dueAt: string | null
  /**
   * 最后一次跟这个人有来往是什么时候（任意方向、任意渠道）。
   *
   * 两个用处：同一桶里「等得最久的排前面」（同桶 priority 相同，没有这个
   * 排序基本随机，销售会问"为什么先打这个"）；卡片上直说「等了 3 天」。
   */
  lastTouchAt: string | null
}

export const SEGMENT_META: Record<Segment, { temperature: Temperature; priority: number }> = {
  replied:            { temperature: 'hot',  priority: 1 },
  callback_due:       { temperature: 'hot',  priority: 2 },
  new_untouched:      { temperature: 'warm', priority: 4 },
  // 点过我们邮件里的链接 —— 比「打过没人接」强得多的再打理由:他自己刚看过。
  // 排在新客人之后:今天刚进线的人比两周前点过链接的更烫。
  clicked_link:       { temperature: 'warm', priority: 5 },
  retry_channel:      { temperature: 'warm', priority: 6 },
  // 联系不上超过 3 天 —— 人不再一个个打，交给自动跟进。仍然是 warm：
  // 他随时可能开口，一开口就跳回最上面那层。
  handoff_sop:        { temperature: 'warm', priority: 7.5 },
  // 温的:聊过一轮、人是热的,只是断了没人跟。排最后但必须进名单。
  stale_conversation: { temperature: 'warm', priority: 7 },
  nurture_future:     { temperature: 'cold', priority: 8 },
  excluded:           { temperature: 'off',  priority: 9 },
}

/**
 * 「先放着，X 回来」里的那个 X。
 *
 * 说「10 月 3 日」而不是「61 天后」—— 销售脑子里记的是日期不是天数，
 * 而且天数每天都在变，看两眼就不信了。今明两天单独说，那是最常用的两档。
 */
function snoozeText(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '以后'
  const days = Math.round((at.getTime() - now.getTime()) / 86_400_000)
  if (days <= 0) return '马上'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日`
}

/** 结论性的通话结果 —— 这些人不该出现在今天的名单上。 */
/**
 * 「这个人到此为止了」—— 判到就整个人退出名单。
 *
 * 🔴 **`bad_number` 故意不在里面**（PM 2026-08-16 从线上截图抓到）。
 *
 * 「号码是坏的」说的是**这条电话线打不通**，不是**这个人不要了**。把它当成
 * 结局，等于让一个渠道故障判了整个人的死刑 —— 而这正是 CTS 线上真实发生的事：
 * 24 个被标了坏号的人里 **23 个后来又来过消息**，15 个一直在跟我们邮件往来。
 * Sue Masson 7 月 6 号被标坏号，此后来了 11 封信、最后一封是**昨天**，
 * 却一直躺在「号码是坏的·补一个对的就能继续跟」那一栏里没人回。
 *
 * 判据分层：**联系方式是渠道属性，成不成是人的状态，两件事不许互相覆盖。**
 * 坏号只把电话这条路关掉（见 `phoneIsDead`），人照旧走下面的规则；
 * 只有当他**真的一条路都没有**时，才回到「联系不上」那一栏。
 */
const DEAD_OUTCOMES = new Set(['not_interested', 'do_not_contact'])

/**
 * 打了没接，几天之后不再让真人一个个重打。
 *
 * PM 2026-08-03 定的：「电话过去 voice message，3 天后挪到先放着的人，靠 SOP 激活」。
 * 三天是个真实的判断 —— 中午没接的人晚上会接、周一没接的周二会接，但打到第四天
 * 还没接上，再打的收益已经很低，那段时间应该还给真的有人在等的那一批。
 */
const HANDOFF_AFTER_DAYS = 3

/**
 * 「进线了但从没人联系过」超过这个天数，就不再算「新客人」。
 *
 * 为什么非有这个界不可（2026-08-03，改「AI 秒回不算我们回过」时暴露的）：
 * 在那之前，Meta 的自动回复被算成「我们联系过」—— 于是 2019 年在主页留过言、
 * 只收到一句自动问候的人，因为 lastOutbound > 0 而进不了「新客人」。那是一层
 * **意外的保护**。把自动回复滤掉之后，这层保护跟着没了：CTS 有 358 个人
 * 只被机器回过，其中 **63 个超过一年没动静**。他们会一股脑冒进「还没搭上话」，
 * 写着「进线 43800 小时还没人联系」—— 荒唐，而且把今天真正的新线索淹掉。
 *
 * 14 天：一条两周前进来、一次都没人碰过的询价，已经不是「新的」，是积压。
 * 它该交给自动跟进，不该占今天的时间。CTS 现实分布：14 天内 37 人（一天能做完），
 * 30 天内 185 人（做不完）。
 */
const FRESH_LEAD_DAYS = 14

/** 逾期超过这个时长的「约定回电」视为解析错误，不再进名单。 */
const STALE_CALLBACK_MS = 14 * 86_400_000

/**
 * 这几桶按「最近的排前面」—— 线索是会凉的，今天进线的今天打最容易接。
 * 其余桶（打过没人接 / 聊过没下文）保持「等得最久的排前面」，
 * 那批人单独成桶的目的就是防止沉底。
 */
const FRESH_FIRST_SEGMENTS = new Set<Segment>(['replied', 'new_untouched'])

/**
 * 把规则想用的渠道，降级到这个人**真的能被联系到**的渠道。
 *
 * 顺序按「能不能当场把事办了」：电话 > 私信 > 邮件。私信排在邮件前面，是因为
 * ME 里能直接回私信，而邮件目前只能批量发。
 *
 * 调用方没提供任何联系方式信息（三个字段都 undefined）→ 原样返回，不替老调用方
 * 猜。这是**向后兼容**，不是默认值：一旦提供了，就以它为准。
 */
export function reachableChannel(
  wanted: SegmentResult['suggestedChannel'],
  reach: Pick<ContactLike, 'hasPhone' | 'hasEmail' | 'hasMessenger'>,
): SegmentResult['suggestedChannel'] {
  const known =
    reach.hasPhone !== undefined ||
    reach.hasEmail !== undefined ||
    reach.hasMessenger !== undefined
  if (!known) return wanted
  if (wanted === 'none') return 'none'

  const can = (ch: SegmentResult['suggestedChannel']): boolean =>
    ch === 'phone' || ch === 'sms' ? reach.hasPhone === true
      : ch === 'messenger' ? reach.hasMessenger === true
      : ch === 'email' ? reach.hasEmail === true
      : false

  if (can(wanted)) return wanted
  // 想要的用不了 —— 按「能当场办事」的顺序找一个能用的。
  for (const fallback of ['phone', 'messenger', 'email'] as const) {
    if (can(fallback)) return fallback
  }
  return 'none'
}

/**
 * 这个人现在该不该被建议「换个渠道联系」—— 号码打不通时那句「改用邮件/私信」。
 *
 * 🔴 **DNC 一票否决，且与坏号相互独立**：客户说过「别再联系」，电话坏了
 * 不能成为绕道去邮件/私信的理由 —— 换渠道就是绕过他的意愿。判据必须由 DNC
 * 驱动，不是靠坏号顺带挡住（坏号+DNC 时是 DNC 关掉建议，不是「反正没渠道」）。
 *
 * 两个入参都是**必填 boolean**：这是一条联系抑制红线函数，缺省方向必须
 * fail-closed。不接受可空 —— 调用方必须先把自己那份「他到底是不是 DNC」
 * 落成确定值（`row.doNotContact === true` / 抽屉里的 `isDnc`）再传进来，
 * 不允许「不知道是不是 DNC」就默认放行去联系。
 *
 * 四象限：坏号+DNC→false（DNC 关）· 坏号+非DNC→true · 好号+DNC→false ·
 * 好号+非DNC→false（没坏号，本就不提示）。
 */
export function suggestsAlternativeChannel(x: {
  doNotContact: boolean
  phoneUnusable: boolean
}): boolean {
  if (x.doNotContact) return false // 闸①：DNC 否决，与坏号无关
  return x.phoneUnusable === true // 闸②：只有坏号才提示换渠道
}

/** off-list（今日名单之外）的人归到哪一组。 */
export type OffListGroup = 'snoozed' | 'fix_number' | 'won' | 'later' | 'stop'

/**
 * off-list 的人归到哪个组。
 *
 * 🔴 **DNC 必须最先判，压过坏号**（子牙 / 狄仁杰复审 2026-08-16）。否则
 * 「坏号 + 别再联系」的人落进 `fix_number`，而那组表头写着「号码是坏的 ·
 * 补一个对的就能继续跟」—— 组级别怂恿去补号继续联系一个说过「别再联系」的
 * 客人，踩客户红线，且绕过所有逐行门控。次序跟 `segmentContact`（DNC 判在
 * 最前）对齐，两处判法必须一致。
 *
 * 抽成纯函数是为了让这道次序能被**单独直测**：坏号+DNC → `stop` 不是
 * `fix_number`（A 级承重断言）。
 */
export function offListGroup(x: {
  doNotContact: boolean
  snoozed: boolean
  phoneLineDead: boolean
  won: boolean
  nurtureFuture: boolean
}): OffListGroup {
  if (x.doNotContact) return 'stop' // DNC 压过一切，包括坏号
  if (x.snoozed) return 'snoozed'
  if (x.phoneLineDead) return 'fix_number'
  if (x.won) return 'won'
  if (x.nurtureFuture) return 'later'
  return 'stop'
}

/**
 * 把毫秒差说成人话。
 *
 * 原先一律用小时，于是名单上出现「进线 835 小时还没人联系」——
 * 835 小时没人能一眼换算成「一个多月」，反而削弱了紧迫感。
 * 两天以内说小时（今天/昨天的事，小时才有意义），更久说天。
 */
function humanGap(ms: number): string {
  if (ms < 3_600_000) return '不到 1 小时'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 48) return `${hours} 小时`
  return `${Math.floor(ms / 86_400_000)} 天`
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 只有这两种结果算「对这条电话线的判决」。
 *
 * `no_answer`（打了没人接）**故意不在里面** —— 没人接不代表号码是坏的，
 * 中午没接的人晚上会接。把它算进来，等于因为一次没接就把电话这条路关掉。
 */
const PHONE_VERDICTS: ReadonlySet<string> = new Set(['bad_number', 'spoke'])

/**
 * 这条通话结果算不算「对电话线的判决」。
 *
 * 导出是为了让**读原始 DB 行**的调用方（today 路由分「号码要修」那一组）
 * 复用同一份判据 —— 两边各写一套，就会出现分段说「打不通」、分组却说
 * 「不要再联系」的裂缝，补号码那件事又一次被藏起来。
 */
/**
 * 这一笔出站**没有真的把人联系上** —— 所以不算「今天跟进过他了」。
 *
 * 🔴 只有「号码是坏的」（Codex 复审 2026-08-16 第五轮）。销售拨过去发现是空号、
 * 顺手标了坏号，这件事**没有到达客人**：他什么都没收到，还在等我们。
 * 算成「今天出手过」的话，卡片当场折进「今天已处理」、进度条算完成、
 * 群发邮件还会把他排除掉 —— 而正确的下一步（改用邮件 / 私信联系他）
 * **一次都还没做**。待办就这么被藏起来了（铁律 3：发现不许死在日志里）。
 *
 * `no_answer`（打了没人接）**不在里面**，这是刻意的：那是一次正常的尝试，
 * 「今天试过了、晚点再试」本来就是销售那一天对这个人做完的事。
 * 坏号不一样 —— 它是「这条路永久关闭了，今天得换一条走」。
 */
export function isFailedReach(outcome: string | null | undefined): boolean {
  return outcome === 'bad_number'
}

/**
 * 「客人自己对这单的结论」—— 只有这几种算数。
 *
 * 🔴 **不能用「最新的任意一条 outcome」**（Codex 复审 2026-08-16）。
 *
 * 一个说了「现在先不考虑」的人会落到「交给系统跟」，而那一桶提供的动作就是
 * **一次性群发邮件**。群发走的是同一条手记通道，备注是系统自己写的
 * 「群发了一封邮件」，`classifyNote` 兜底成 `spoke` —— 第二天最新结果就不再是
 * 软拒绝了，这个人掉回「聊过了没下文」，**又被推回真人逐个打电话的名单**。
 *
 * 也就是说：**系统自己的第一次跟进，就把客人那句「现在先不考虑」抹掉了**，
 * 然后我们打给一个刚说过别现在打的人。
 *
 * 跟 `isPhoneVerdict`、`isFailedReach` 是同一条道理：
 * **一个兜底值不许推翻一个客人明确表达过的结论。**
 *
 * 客人真的回心转意了怎么办 —— 靠前面两条规则，它们都排在这一支之前：
 * 他来一条消息 → 规则 2「客户回话了」；约了回电 → 规则 3「该回电了」。
 * 那两件事都是**他自己做的**，比我们群发一封邮件有力得多。
 */
const INTENT_VERDICTS: ReadonlySet<string> = new Set([
  'not_interested',
  'not_interested_now',
  'do_not_contact',
])

export function latestIntentVerdict(tps: TouchpointLike[]): string | null {
  const latest = tps
    .filter((t) => t.outcome && INTENT_VERDICTS.has(t.outcome))
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0]
  return latest?.outcome ?? null
}

export function isPhoneVerdict(
  outcome: string | null | undefined,
  source?: string | null,
): boolean {
  if (!outcome || !PHONE_VERDICTS.has(outcome)) return false
  // 🔴 手打的笔记里那个 `spoke` **不算打通了电话**（Codex 复审 2026-08-16）。
  //
  // `recordManualTouchpoint` 把每一条手记都写成 `channel: 'phone'`，而
  // `classifyNote` 的**兜底值就是 `spoke`** —— 任何没命中规则的普通备注都会变成它。
  // 于是销售给坏号客人记一句「已经邮件发他了」，电话当场被判成「打通了」，
  // 刷新之后那个明知打不通的号又变回可拨 —— 而这类记录**恰恰是坏号客人的常态**。
  //
  // 一个**兜底值**不许推翻一个**人明确按下的判断**。所以只认非手记来源的
  // `spoke`（语音桥接接通时写的那种）。「号码是坏的」两边都认：它从来不是兜底值，
  // 是有人明说的。
  if (outcome === 'spoke' && source === 'me_manual') return false
  return true
}

/**
 * 这条电话线现在通不通 —— **看最后一次判决，不看历史上有没有出现过坏号**。
 *
 * ⚠️ 不能用「只要出现过 bad_number 就永久判死」（Codex 复审 2026-08-16）：
 * 号码会被改对（FDE 补一个新号）、也可能当初就标错了，之后真的打通过。
 * 语音桥接接通时会写一条 `spoke`，所以「标错之后又打通了」是真实可发生的。
 * 永久判死的话，一个已经打得通的号码会被永远藏起来，销售还会看到一句
 * 「这个号打不通」—— 他手上刚打通过，这一页当场失去可信度。
 */
export function phoneLineIsDead(tps: TouchpointLike[]): boolean {
  const latest = tps
    .filter((t) => isPhoneVerdict(t.outcome, t.source))
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0]
  return latest?.outcome === 'bad_number'
}

/**
 * 一个人属于哪一段。
 *
 * `now` 必须显式传进来，段位才可测 —— 「约的时间到没到」完全取决于它。
 */
export function segmentContact(contact: ContactLike, now: Date): SegmentResult {
  const tps = contact.touchpoints
  const nowMs = now.getTime()

  // 「谁说了一句话」和「邮件被打开」必须分开算。
  //
  // segmentContact 原来只看 direction，不看这条触点是不是真人消息。邮件反应
  // 同步一上线，「打开了邮件」以 inbound 身份进来，规则 2 立刻把它当成
  // 「客户回话了」—— 2026-08-02 实测那个最高优先桶从 15 人涨到 200 人，
  // 15 个真的在等回复的客户被 185 个自动打开埋掉。Apple 隐私保护还会替用户
  // 自动打开邮件，所以「打开」连「他看过」都不能证明。
  //
  // 行为信号不参与 lastInbound / lastOutbound / lastAny：它既不能让人升进
  // 「客户回话了」，也不该把「等了几天」重置成 0。它只在下面的点击规则里用。
  const messages = tps.filter((t) => !t.engagement)
  const lastInbound = Math.max(0, ...messages.filter((t) => t.direction === 'inbound').map((t) => ts(t.occurredAt)))
  const lastOutbound = Math.max(0, ...messages.filter((t) => t.direction === 'outbound').map((t) => ts(t.occurredAt)))

  /**
   * 最近一次「点了链接」，且**那之后没有任何真人联系过他**。
   *
   * 只认点击、不认打开：打开可能是 Apple 自动干的，点击必须有人真的动手。
   * 60 天窗口 —— 意向会凉，但跟团游决策周期长（客人常提前几个月看），
   * 30 天会把还在比较的人过早丢掉。
   */
  const CLICK_WINDOW_MS = 60 * 86_400_000
  const lastClick = Math.max(
    0,
    ...tps.filter((t) => t.engagement === 'click').map((t) => ts(t.occurredAt)),
  )
  const clickPending =
    lastClick > 0 && nowMs - lastClick <= CLICK_WINDOW_MS && lastOutbound < lastClick
  /**
   * 🔴 **被人推翻过的拒联判词不算数**（Codex 复审 2026-08-16）。
   *
   * 有人明确纠正过「这条别再联系判错了」之后，比那次纠正更早的
   * `do_not_contact` 触点就已经作废了。不这么筛的话会出现最坏的一种结局：
   * FDE 点了「放回名单」，黄条消失、人工任务不再冒出来（判据说他不是拒联了），
   * **但他照样不出现在今天该联系的人里** —— 而且再没有按钮可以处理他。
   * 看起来修好了，实际人被彻底埋掉。
   *
   * 只作废 `do_not_contact` 这一种：`not_interested` 是另一个判词，
   * 「别再联系判错了」这句话没资格替客人收回「我不买了」。
   */
  const outcomes = withoutClearedDnc(tps)
    .map((t) => t.outcome)
    .filter(Boolean) as string[]
  const latestOutcome = tps
    .filter((t) => t.outcome)
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0]?.outcome ?? null

  // 最后一次有来往(任意方向、只算真人消息)。同桶排序 + 卡片上「等了几天」都用它。
  const lastAny = Math.max(lastInbound, lastOutbound)
  const lastTouchAt = lastAny > 0 ? new Date(lastAny).toISOString() : null

  /**
   * 这条电话线打不通 —— **只关掉电话，不关掉这个人**（见 `DEAD_OUTCOMES` 头上那段）。
   *
   * 只在调用方**如实给了联系方式**时才生效。三个字段都没给的老调用方保持原样：
   * 这里宁可把人留在名单上，也不凭空判他联系不上 —— 本文件一贯的偏向是
   * 「多一个人是噪音，少一个是丢单」。
   */
  const reachKnown =
    contact.hasPhone !== undefined ||
    contact.hasEmail !== undefined ||
    contact.hasMessenger !== undefined
  const phoneIsDead = phoneLineIsDead(tps)
  const reach = phoneIsDead && reachKnown ? { ...contact, hasPhone: false } : contact

  const make = (segment: Segment, reason: string, ch: SegmentResult['suggestedChannel'], dueAt: string | null = null) => ({
    segment,
    ...SEGMENT_META[segment],
    reason,
    suggestedChannel: reachableChannel(ch, reach),
    wantedChannel: ch,
    // 只有「库里有号码但打不通」才算 —— 压根没号码的人不该说成「号打不通」。
    phoneUnusable: phoneIsDead && contact.hasPhone === true,
    dueAt,
    lastTouchAt,
  })

  // 1) 客户说过别再联系，或结局已定 —— 最先判，避免被后面任何规则捞回名单
  if (contact.doNotContact) {
    return make('excluded', '客户明确说过别再联系', 'none')
  }
  // 销售说了「这人先放一放」。**只在到期之前挡住**，过了那天他自己回名单 ——
  // 这里不写任何「解除推迟」的逻辑，因为根本不需要：分批每次刷新都重算，
  // 时间一过这条判断就不成立了。少一个需要有人记得去点的按钮。
  const snoozedUntil = contact.snoozeUntil ? ts(contact.snoozeUntil) : 0
  if (snoozedUntil > nowMs) {
    return make('excluded', `先放着，${snoozeText(contact.snoozeUntil!, now)}回来`, 'none')
  }

  // 员工已经把他推进到结论性阶段（成交 / 转售后 / 停止营销）—— 名单里不该再有他。
  if (contact.stageSuppressed) {
    const label = contact.stageLabel?.trim()
    return make('excluded', label ? `已经是「${label}」了` : '已推进到不再联系的阶段', 'none')
  }
  if (outcomes.some((o) => DEAD_OUTCOMES.has(o))) {
    // 措辞按销售的说法写（板桥 2026-08-06）：
    //  · 「号码是坏的」不是人说的话（电池是坏的；号码是空号 / 停机）
    //  · 按钮上写「他不买了」，这里原先写「聊过了，明确没兴趣」——
    //    销售得在脑子里翻译一次才能确认「我刚才点的是这个吗」，两处用同一句话
    const why = latestOutcome === 'not_interested' ? '他说不买了' : '结局已定'
    return make('excluded', why, 'none')
  }

  /**
   * 电话打不通，**而且真的没有别的路** —— 这时候才该退出名单。
   *
   * 这一栏原先吞掉的是「电话打不通」的全部人（线上 24 个里 23 个还在跟我们
   * 邮件往来）。现在只留下真正联系不上的那些，文案也照实说清缺什么，
   * 否则 FDE 看到「补一个对的就能继续跟」却不知道补的是号码还是邮箱。
   */
  if (phoneIsDead && reachKnown && contact.hasEmail !== true && contact.hasMessenger !== true) {
    return make('excluded', '号码不通，又没有邮箱和 Messenger —— 补个联系方式才能继续跟', 'none')
  }

  // 2) 客户回了话，还没人接。三个条件缺一不可：
  //    · 我们确实先联系过（lastOutbound > 0）—— 否则从没人碰过的新 lead
  //      会因为 inbound > 0 被判成「客户在等我们」，全部涌进最高优先段
  //    · 客户的消息严格晚于我们最后一次外呼（相等不算：导入的历史数据里
  //      表单和通话共用同一个时间戳）
  if (lastOutbound > 0 && lastInbound > lastOutbound) {
    return make('replied', `客户来消息了，已经等了 ${humanGap(nowMs - lastInbound)}`, 'phone')
  }

  // 3) 约好的时间到了
  //
  // 两处都要防：
  //  · 取「最近的一条」而不是最早的 —— 同一个人可能被改约过几次，
  //    该按最后一次约定打，而不是翻出半年前那次。
  //  · 丢掉早于 14 天的 —— 那种约定几乎必然是留言解析漏了年份。
  //    CTS 线上 23 条 callback_at 全部落在 30 天以前，最早 2023-07-07，
  //    名单上显示成「该回电了 · 1118 天前」。入库侧已经拦了，这里再拦一次，
  //    让存量坏数据不必等清洗就先不出现在名单上。
  const dueCallback = tps
    .map((t) => t.callbackAt)
    .filter((c): c is string => {
      if (!c) return false
      const at = ts(c)
      return at <= nowMs && nowMs - at <= STALE_CALLBACK_MS
    })
    .sort((a, b) => ts(b) - ts(a))[0]
  if (dueCallback) {
    return make('callback_due', '之前约好这个时间回电', 'phone', dueCallback)
  }

  // 4) 客户说过什么时候走。
  //
  //    以前这里只判断「有没有说过」，说过就无限期压进「以后才走」——
  //    于是「明年三月」永远是明年三月，到了三月也没有任何东西把人叫醒。
  //    19 个 CTS 客人卡在这个状态，其中一位说的是「下个月左右」，
  //    那句话是上个月说的。
  //
  //    现在把那句话实时算成出行月份（不落库，历史数据自动生效），
  //    到了跟进窗口就捞回名单。算不出来的（「看情况」「还没定」）
  //    照旧留在培育里 —— 猜一个日期比承认不知道更糟。
  const spoken = tps.find((t) => !!t.travelWindow)
  if (spoken) {
    const travelAt = resolveTravelDate(spoken.travelWindow, new Date(ts(spoken.occurredAt)))
    // 出行时间到了 —— **不再单独成一批**（PM 2026-08-03 拿掉「快出行了，该定了」）。
    // 那一批靠 AI 从通话里解析出的月份来推断「他该定了」，是猜的不是事实；
    // 而这一页现在只认客人真的说过话 / 真的动过手。到点的人落回下面的普通规则，
    // 该打的照打，只是理由老老实实写「聊过一轮就断了」，不假装知道他急不急。
    if (isDueToWake(travelAt, now)) {
      // 落空 —— 往下走普通规则。
    } else if (clickPending) {
    // 他说过「以后才走」，但**刚点开了我们邮件里的链接** —— 一句几周前说的话，
    // 抵不过他现在正在看这件事。不拦下来的话，这个人会被埋进培育桶（cold，
    // 根本不进今天的名单）。
      return make('clicked_link', '他说以后才走，但刚点开了我们邮件里的链接 —— 现在在看了', 'phone')
    } else {
      return make('nurture_future', `客户说 ${spoken.travelWindow} 才走，现在打是打扰`, 'email')
    }
  }

  /**
   * 4.5) 他说的是「**暂时**不考虑」，不是「不要了」。
   *
   * 🔴 PM 2026-08-16 给的实际业务事实：「leads 沟通后会变成暂时不感兴趣、
   * 还需要继续营销的，或者明确表达不感兴趣的。」这两种的下场必须不一样。
   *
   * 在此之前系统只有一个「不感兴趣」，而它是**终结性**的 —— 一句「明年再说」
   * 会让这个人从此不出现在任何名单上，没有任何东西会把他叫醒。
   * 跟「号码是坏的」是同一个病：**一个软信号被当成了最终结论**。
   *
   * 落到「交给系统跟」而不是排除：不用真人一个个打（他刚说了现在不是时候），
   * 但自动跟进照发，而且**他一开口就跳回名单最上面**（规则 2 在这条之前）。
   *
   * 位置刻意排在「客户回话了」「约好的时间到了」「说了什么时候走」之后 ——
   * 那三件事都比一句旧的「再说吧」新鲜、也更硬。
   */
  if (latestIntentVerdict(tps) === 'not_interested_now') {
    return make('handoff_sop', '他说现在先不考虑 —— 系统继续跟着，他一开口就跳回最上面', 'email')
  }

  // 5) 进线了但从没人联系过
  if (lastOutbound === 0) {
    const days = lastInbound > 0 ? Math.floor((nowMs - lastInbound) / 86_400_000) : 0
    // 太久了就不是「新客人」了，是积压 —— 交给自动跟进（理由见 FRESH_LEAD_DAYS）。
    if (days >= FRESH_LEAD_DAYS) {
      return make('handoff_sop', `进线 ${days} 天，一直没人联系过 —— 交给系统跟`, 'email')
    }
    return make('new_untouched', `进线 ${humanGap(nowMs - lastInbound)} 还没人联系`, 'phone')
  }

  // 5.5) 点过我们邮件里的链接，之后没人跟。
  //
  //      排在「打过没人接」之前:两批人常常是同一个人,但「他后来自己点开了
  //      行程」是比盲目再打一次强得多的理由 —— 销售拿起电话时有话可说。
  const clickDays = Math.floor((nowMs - lastClick) / 86_400_000)
  if (clickPending) {
    return make(
      'clicked_link',
      clickDays <= 0 ? '今天点开了我们邮件里的链接' : `${clickDays} 天前点开了我们邮件里的链接，之后没人跟`,
      'phone',
    )
  }

  // 6) 打过一次没人接。
  //    注意措辞:这里只知道「打了、没接」,不知道「打不通」。中午没接的人
  //    晚上会接 —— 系统不能对销售说一件他凭经验知道是假的事。
  if (latestOutcome === 'no_answer') {
    const days = lastOutbound > 0 ? Math.floor((nowMs - lastOutbound) / 86_400_000) : 0
    const when = days <= 0 ? '今天' : `${days} 天前`
    // 三天之内还值得真人再试一次：中午没接的人晚上会接。
    // 超过三天还没接上，再打第四次第五次的收益已经很低 —— 交给自动跟进，
    // 把人的时间还给「客人在等你」那一层。他一开口会自己跳回最上面。
    if (days < HANDOFF_AFTER_DAYS) {
      return make('retry_channel', `${when}打过，没人接`, 'sms')
    }
    return make('handoff_sop', `${when}打过，一直没接上 —— 交给系统跟`, 'email')
  }

  // 7) 聊过一轮就断了、也没约下次 —— 温的，最该回头捞的一批。
  //    以前它被并进「以后才走」还贴上「打了是打扰」的标签埋进折叠区，
  //    等于系统亲手弄丢了这些人。现在单独成桶、进今天的名单。
  const staleDays = lastAny > 0 ? Math.floor((nowMs - lastAny) / 86_400_000) : 0
  return make(
    'stale_conversation',
    staleDays > 0 ? `聊过一轮就断了，${staleDays} 天没动静` : '聊过一轮，还没约下次',
    'phone',
  )
}

/**
 * 今天真正要动的人：热的和温的，按优先级排。
 *
 * 同一桶内按「等得最久的排前面」—— 同桶 priority 相同、dueAt 多半是 null，
 * 没有这一层排序结果基本是随机的，销售会问「为什么先打这个」。
 */
export function todayWorklist(
  contacts: ContactLike[],
  now: Date,
): Array<ContactLike & { seg: SegmentResult }> {
  return contacts
    .map((c) => ({ ...c, seg: segmentContact(c, now) }))
    .filter((c) => c.seg.temperature === 'hot' || c.seg.temperature === 'warm')
    .sort((a, b) => compareForWorklist(a.seg, b.seg))
}

/**
 * 名单里谁排前面。
 *
 * 单独导出是因为「今天的名单一天不变」那条路（lib/crm/day-list）要用同一个
 * 排序 —— 两边各写一套的话，同一个人在两处会排在不同位置，而排序正是
 * 销售用来记「我推到哪了」的东西。
 */
export function compareForWorklist(a: SegmentResult, b: SegmentResult): number {
  return (
        a.priority - b.priority ||
        // 约好的时间越早越该先打
        (a.dueAt && b.dueAt ? ts(a.dueAt) - ts(b.dueAt) : 0) ||
        // 其余按桶的性质决定方向 —— 两种需求是真的冲突，不能一刀切：
        //
        //  · 热线索桶（新客人 / 客户回话了）：最近的排前面。线索会凉，
        //    今天填表的人今天打最容易接；原先「最久没动静排最前」把三个月前
        //    的压在今天进线的前面，跟「新客人」桶自己写的「先打里面最新的」
        //    自相矛盾。
        //  · 回捞桶（打过没人接 / 聊过没下文）：等得最久的排前面。这批人本来
        //    就是要防止沉底才单独成桶的，按最近排等于让老线索永远轮不到。
        (FRESH_FIRST_SEGMENTS.has(a.segment) && FRESH_FIRST_SEGMENTS.has(b.segment)
          ? ts(b.lastTouchAt) - ts(a.lastTouchAt)
          : ts(a.lastTouchAt) - ts(b.lastTouchAt))
  )
}

/** 各段人数，给页面顶部的统计条。 */
export function segmentCounts(contacts: ContactLike[], now: Date): Record<Segment, number> {
  const out: Record<Segment, number> = {
    replied: 0, callback_due: 0, new_untouched: 0, handoff_sop: 0,
    clicked_link: 0, retry_channel: 0, stale_conversation: 0,
    nurture_future: 0, excluded: 0,
  }
  for (const c of contacts) out[segmentContact(c, now).segment]++
  return out
}
