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
  | 'travel_due'       // 他说的出行时间快到了，该跟进定行程
  | 'new_untouched'    // 进线了，没人联系过
  | 'retry_channel'    // 打过一次没人接
  | 'stale_conversation' // 聊过一轮就断了，没约下次
  | 'nurture_future'   // 说了以后才走，时候还没到
  | 'excluded'         // 别再联系 / 号码是坏的 / 明确没兴趣

import { resolveTravelDate, isDueToWake } from './travel-date'

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
  travel_due: {
    label: '快出行了，该定了',
    howTo: '他说过这段时间走，现在该跟进定行程了 —— 再晚位子和机票都紧张。',
    batch: 'call_one_by_one',
  },
  new_untouched: {
    label: '新客人，还没打过',
    howTo: '刚留下资料，人还热着。越早打通越容易成 —— 先打里面最新的。',
    batch: 'call_one_by_one',
  },
  // 名字和文案都不能说「打不通」:后台判据只是「打了一次没人接」。
  // 中午没接的人晚上会接 —— 系统斩钉截铁说一件销售凭经验知道是假的事,
  // 他会连带不信这一页其他三桶。而这是最大的一桶(CTS 108 人 / 58%)。
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
  outcome?: string | null
  travelWindow?: string | null
  callbackAt?: string | null
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
}

export interface SegmentResult {
  segment: Segment
  temperature: Temperature
  /** 排序用，越小越靠前。 */
  priority: number
  /** 一句人话，告诉销售为什么这个人在今天的名单上。 */
  reason: string
  /** 建议用哪个渠道 —— 打过没人接的，再打一次多半还是没人接。 */
  suggestedChannel: 'phone' | 'sms' | 'email' | 'none'
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

const SEGMENT_META: Record<Segment, { temperature: Temperature; priority: number }> = {
  replied:            { temperature: 'hot',  priority: 1 },
  callback_due:       { temperature: 'hot',  priority: 2 },
  // 客人自己说的出行时间快到了 —— 购买意图最明确的一批,排在新 lead 之前。
  travel_due:         { temperature: 'hot',  priority: 3 },
  new_untouched:      { temperature: 'warm', priority: 4 },
  retry_channel:      { temperature: 'warm', priority: 5 },
  // 温的:聊过一轮、人是热的,只是断了没人跟。排最后但必须进名单。
  stale_conversation: { temperature: 'warm', priority: 6 },
  nurture_future:     { temperature: 'cold', priority: 7 },
  excluded:           { temperature: 'off',  priority: 9 },
}

/** 结论性的通话结果 —— 这些人不该出现在今天的名单上。 */
const DEAD_OUTCOMES = new Set(['bad_number', 'not_interested', 'do_not_contact'])

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 一个人属于哪一段。
 *
 * `now` 必须显式传进来，段位才可测 —— 「约的时间到没到」完全取决于它。
 */
export function segmentContact(contact: ContactLike, now: Date): SegmentResult {
  const tps = contact.touchpoints
  const nowMs = now.getTime()

  const lastInbound = Math.max(0, ...tps.filter((t) => t.direction === 'inbound').map((t) => ts(t.occurredAt)))
  const lastOutbound = Math.max(0, ...tps.filter((t) => t.direction === 'outbound').map((t) => ts(t.occurredAt)))
  const outcomes = tps.map((t) => t.outcome).filter(Boolean) as string[]
  const latestOutcome = tps
    .filter((t) => t.outcome)
    .sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))[0]?.outcome ?? null

  // 最后一次有来往(任意方向)。同桶排序 + 卡片上「等了几天」都用它。
  const lastAny = Math.max(lastInbound, lastOutbound)
  const lastTouchAt = lastAny > 0 ? new Date(lastAny).toISOString() : null

  const make = (segment: Segment, reason: string, ch: SegmentResult['suggestedChannel'], dueAt: string | null = null) => ({
    segment,
    ...SEGMENT_META[segment],
    reason,
    suggestedChannel: ch,
    dueAt,
    lastTouchAt,
  })

  // 1) 客户说过别再联系，或结局已定 —— 最先判，避免被后面任何规则捞回名单
  if (contact.doNotContact) {
    return make('excluded', '客户明确说过别再联系', 'none')
  }
  // 员工已经把他推进到结论性阶段（成交 / 转售后 / 停止营销）—— 名单里不该再有他。
  if (contact.stageSuppressed) {
    const label = contact.stageLabel?.trim()
    return make('excluded', label ? `已经是「${label}」了` : '已推进到不再联系的阶段', 'none')
  }
  if (outcomes.some((o) => DEAD_OUTCOMES.has(o))) {
    const why = latestOutcome === 'bad_number' ? '号码是坏的，打不通也发不了短信'
      : latestOutcome === 'not_interested' ? '聊过了，明确没兴趣'
      : '结局已定'
    return make('excluded', why, 'none')
  }

  // 2) 客户回了话，还没人接。三个条件缺一不可：
  //    · 我们确实先联系过（lastOutbound > 0）—— 否则从没人碰过的新 lead
  //      会因为 inbound > 0 被判成「客户在等我们」，全部涌进最高优先段
  //    · 客户的消息严格晚于我们最后一次外呼（相等不算：导入的历史数据里
  //      表单和通话共用同一个时间戳）
  if (lastOutbound > 0 && lastInbound > lastOutbound) {
    const hours = Math.floor((nowMs - lastInbound) / 3_600_000)
    return make('replied', `客户来消息了，已经等了 ${hours} 小时`, 'phone')
  }

  // 3) 约好的时间到了
  const dueCallback = tps
    .map((t) => t.callbackAt)
    .filter((c): c is string => !!c && ts(c) <= nowMs)
    .sort((a, b) => ts(a) - ts(b))[0]
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
    if (isDueToWake(travelAt, now)) {
      return make('travel_due', `客户说 ${spoken.travelWindow} 走，该跟进定行程了`, 'phone', travelAt)
    }
    return make('nurture_future', `客户说 ${spoken.travelWindow} 才走，现在打是打扰`, 'email')
  }

  // 5) 进线了但从没人联系过
  if (lastOutbound === 0) {
    const hours = lastInbound > 0 ? Math.floor((nowMs - lastInbound) / 3_600_000) : 0
    return make('new_untouched', `进线 ${hours} 小时还没人联系`, 'phone')
  }

  // 6) 打过一次没人接。
  //    注意措辞:这里只知道「打了、没接」,不知道「打不通」。中午没接的人
  //    晚上会接 —— 系统不能对销售说一件他凭经验知道是假的事。
  if (latestOutcome === 'no_answer') {
    const days = lastOutbound > 0 ? Math.floor((nowMs - lastOutbound) / 86_400_000) : 0
    const when = days <= 0 ? '今天' : `${days} 天前`
    return make('retry_channel', `${when}打过，没人接`, 'sms')
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
    .sort(
      (a, b) =>
        a.seg.priority - b.seg.priority ||
        // 约好的时间越早越该先打
        (a.seg.dueAt && b.seg.dueAt ? ts(a.seg.dueAt) - ts(b.seg.dueAt) : 0) ||
        // 其余按最久没动静的排前面（0 = 从没来往过，也排前面）
        ts(a.seg.lastTouchAt) - ts(b.seg.lastTouchAt),
    )
}

/** 各段人数，给页面顶部的统计条。 */
export function segmentCounts(contacts: ContactLike[], now: Date): Record<Segment, number> {
  const out: Record<Segment, number> = {
    replied: 0, callback_due: 0, travel_due: 0, new_untouched: 0,
    retry_channel: 0, stale_conversation: 0, nurture_future: 0, excluded: 0,
  }
  for (const c of contacts) out[segmentContact(c, now).segment]++
  return out
}
