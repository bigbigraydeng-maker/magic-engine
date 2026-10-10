/**
 * 「下一步做什么」—— 把今天并排挂着的三个状态（pipeline 阶段、系统分段、
 * AI 意向等级）合成**一个**概念，只给销售两张名单：今天要联系 / 先放着。
 *
 * 意向只能**往上抬**，永远不许往下压（2026-08-02 的教训：分段少配一列，
 * 33 个点过链接的客人在页面上凭空消失，没有任何报错 —— 任何「把人往下挪」的
 * 规则都可能重演它）。所以唯一的抬升是「聊过一轮就断了」+ 高意向 → 进今天
 * 要联系；medium / low / unknown / 没有 brief 一律不动，位置跟今天一样。
 *
 * hot / cold 对应旧的两层：hot = 原来「在等我们 / 今天动过」那一层，
 * cold = 原来「排队中 / 已排除」那一层。名字换了，人一个没少。
 */

import { compareForWorklist, type Segment, type SegmentResult } from './segments'

/** 对应 conversation_briefs.intent_level。null = 这个人根本没有 AI 简报。 */
export type IntentLevel = 'high' | 'medium' | 'low' | 'unknown'
export const INTENT_LEVELS: readonly IntentLevel[] = ['high', 'medium', 'low', 'unknown']

export type NextActionList = 'hot' | 'cold'
export type NextActionVerb = 'reply' | 'call' | 'system_watching' | 'hold' | 'do_not_contact'

export interface NextAction {
  list: NextActionList
  verb: NextActionVerb
  /** 给销售看的中文动词，例如「打给他」。 */
  verbLabel: string
  /** 名单上那一行：`${verbLabel} —— ${reason}`。 */
  line: string
  /** 「为什么」那半句（`seg.reason`，高意向抬升时带后缀）。页面别自己切 `line`，直接用它。 */
  reason: string
  /** conversation_briefs.next_action，去掉首尾空白；没有就是 null。只在抽屉里显示。 */
  aiSuggestion: string | null
  /** 只有「聊过一轮就断了」因为高意向被抬进 hot 时才为 true。 */
  intentBoost: boolean
}

export const LIST_META: Record<NextActionList, { title: string; hint: string }> = {
  hot: { title: '今天要联系', hint: '按紧急程度排好了，从上往下打。' },
  cold: { title: '先放着', hint: '系统盯着，他一开口会自己跳上去。以后才走 / 已成交 / 别再联系的人也在这里。' },
}

export const VERB_LABEL: Record<NextActionVerb, string> = {
  reply: '回他',
  call: '打给他',
  system_watching: '系统盯着',
  hold: '先别打',
  do_not_contact: '不联系',
}

/** 每个分段在**考虑意向之前**落在哪张名单。必须覆盖全部 Segment（穷尽 Record）。 */
export const BASE_LIST_OF_SEGMENT: Record<Segment, NextActionList> = {
  replied: 'hot',
  callback_due: 'hot',
  clicked_link: 'hot',
  new_untouched: 'hot',
  retry_channel: 'hot',
  stale_conversation: 'cold',
  handoff_sop: 'cold',
  nurture_future: 'cold',
  excluded: 'cold',
}

export const INTENT_BOOST_SUFFIX = '，AI 读完对话判他意向高'

/**
 * 这个人进哪张名单。
 *
 * 意向只能抬、不能压：唯一的抬升是「聊过一轮就断了」+ 高意向 → hot。
 * medium / low / unknown / null 一律返回基础名单 —— 一个 AI 判低意向
 * 不许把正在等我们回话的人从名单上抹掉。
 */
export function listOf(segment: Segment, intent: IntentLevel | null): NextActionList {
  if (segment === 'stale_conversation' && intent === 'high') return 'hot'
  return BASE_LIST_OF_SEGMENT[segment]
}

/**
 * 这个人该做什么动作。
 *
 * 先按分段判「结构性」的动作（不联系 / 先别打 / 系统盯着），剩下的才是
 * 真人出手：能打电话就打，否则回消息。
 */
export function verbOf(
  segment: Segment,
  channel: SegmentResult['suggestedChannel'],
  list: NextActionList,
): NextActionVerb {
  if (segment === 'excluded') return 'do_not_contact'
  if (segment === 'nurture_future') return 'hold'
  if (segment === 'handoff_sop') return 'system_watching'
  if (segment === 'stale_conversation' && list === 'cold') return 'system_watching'
  if (channel === 'phone' || channel === 'sms') return 'call'
  return 'reply'
}

/** 把分段 + 意向 + AI 建议合成一条「下一步做什么」。 */
export function nextActionFor(input: {
  seg: SegmentResult
  intent: IntentLevel | null
  aiNextAction: string | null | undefined
}): NextAction {
  const { seg, intent, aiNextAction } = input
  const list = listOf(seg.segment, intent)
  const intentBoost = seg.segment === 'stale_conversation' && list === 'hot'
  const verb = verbOf(seg.segment, seg.suggestedChannel, list)
  const verbLabel = VERB_LABEL[verb]
  const reason = intentBoost ? `${seg.reason}${INTENT_BOOST_SUFFIX}` : seg.reason
  const trimmed = typeof aiNextAction === 'string' ? aiNextAction.trim() : ''
  return {
    list,
    verb,
    verbLabel,
    line: `${verbLabel} —— ${reason}`,
    reason,
    aiSuggestion: trimmed.length > 0 ? trimmed : null,
    intentBoost,
  }
}

/**
 * 名单里谁排前面。
 *
 * 先按分段排（跟今天名单同一套 `compareForWorklist`，两处排序不许漂移）；
 * 分段完全相同时，高意向排前面。medium / low 之间不再分高下 —— 没有依据。
 */
export function compareNextAction(
  a: { seg: SegmentResult; intent: IntentLevel | null },
  b: { seg: SegmentResult; intent: IntentLevel | null },
): number {
  // 被高意向抬进 hot 的「聊过一轮断了」：**最近的排前面**（PM 2026-10-10 看了本地页：
  // 37 天没动静的排在 1 天没动静的前面，不对）。引擎里 stale 原本是「等得最久的排前面」，
  // 那是给 cold 回捞用的；进了今天要联系，就跟新线索一样 —— 线索会凉，越近的越该先打。
  const aLifted = a.seg.segment === 'stale_conversation' && listOf(a.seg.segment, a.intent) === 'hot'
  const bLifted = b.seg.segment === 'stale_conversation' && listOf(b.seg.segment, b.intent) === 'hot'
  if (aLifted && bLifted) {
    const byRecent = Date.parse(b.seg.lastTouchAt ?? '') - Date.parse(a.seg.lastTouchAt ?? '')
    if (!Number.isNaN(byRecent) && byRecent !== 0) return byRecent
  }
  const bySeg = compareForWorklist(a.seg, b.seg)
  if (bySeg !== 0) return bySeg
  const aHigh = a.intent === 'high'
  const bHigh = b.intent === 'high'
  if (aHigh === bHigh) return 0
  return aHigh ? -1 : 1
}
