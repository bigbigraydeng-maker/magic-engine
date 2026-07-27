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
  | 'retry_channel'    // 电话打不通，该换条路
  | 'nurture_future'   // 说了以后才走
  | 'excluded'         // 别再联系 / 号码是坏的 / 明确没兴趣

export type Temperature = 'hot' | 'warm' | 'cold' | 'off'

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
}

export interface SegmentResult {
  segment: Segment
  temperature: Temperature
  /** 排序用，越小越靠前。 */
  priority: number
  /** 一句人话，告诉销售为什么这个人在今天的名单上。 */
  reason: string
  /** 建议用哪个渠道 —— 打不通的人再打一次还是打不通。 */
  suggestedChannel: 'phone' | 'sms' | 'email' | 'none'
  /** 约定的回电时间，有就带上。 */
  dueAt: string | null
}

const SEGMENT_META: Record<Segment, { temperature: Temperature; priority: number }> = {
  replied:        { temperature: 'hot',  priority: 1 },
  callback_due:   { temperature: 'hot',  priority: 2 },
  new_untouched:  { temperature: 'warm', priority: 3 },
  retry_channel:  { temperature: 'warm', priority: 4 },
  nurture_future: { temperature: 'cold', priority: 5 },
  excluded:       { temperature: 'off',  priority: 9 },
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

  const make = (segment: Segment, reason: string, ch: SegmentResult['suggestedChannel'], dueAt: string | null = null) => ({
    segment,
    ...SEGMENT_META[segment],
    reason,
    suggestedChannel: ch,
    dueAt,
  })

  // 1) 客户说过别再联系，或结局已定 —— 最先判，避免被后面任何规则捞回名单
  if (contact.doNotContact) {
    return make('excluded', '客户明确说过别再联系', 'none')
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

  // 4) 说了以后才走 —— 排在「新 lead」之前，避免被当成待首联反复打
  const future = tps.map((t) => t.travelWindow).find((w) => !!w)
  if (future) {
    return make('nurture_future', `客户说 ${future} 才走，现在打是打扰`, 'email')
  }

  // 5) 进线了但从没人联系过
  if (lastOutbound === 0) {
    const hours = lastInbound > 0 ? Math.floor((nowMs - lastInbound) / 3_600_000) : 0
    return make('new_untouched', `进线 ${hours} 小时还没人联系`, 'phone')
  }

  // 6) 打过但没接通 —— 再打还是打不通，换条路
  if (latestOutcome === 'no_answer') {
    return make('retry_channel', '电话打不通，改发短信或邮件', 'sms')
  }

  // 7) 聊过了、没约下次 —— 温的，不进今天的名单
  return make('nurture_future', '聊过了但没约下次，先放着', 'email')
}

/** 今天真正要动的人：热的和温的，按优先级排。 */
export function todayWorklist(
  contacts: ContactLike[],
  now: Date,
): Array<ContactLike & { seg: SegmentResult }> {
  return contacts
    .map((c) => ({ ...c, seg: segmentContact(c, now) }))
    .filter((c) => c.seg.temperature === 'hot' || c.seg.temperature === 'warm')
    .sort((a, b) => a.seg.priority - b.seg.priority || ts(b.seg.dueAt) - ts(a.seg.dueAt))
}

/** 各段人数，给页面顶部的统计条。 */
export function segmentCounts(contacts: ContactLike[], now: Date): Record<Segment, number> {
  const out: Record<Segment, number> = {
    replied: 0, callback_due: 0, new_untouched: 0,
    retry_channel: 0, nurture_future: 0, excluded: 0,
  }
  for (const c of contacts) out[segmentContact(c, now).segment]++
  return out
}
