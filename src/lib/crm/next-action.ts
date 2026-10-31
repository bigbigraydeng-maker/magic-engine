/**
 * 「下一步做什么」—— 把今天并排挂着的三个状态（pipeline 阶段、系统分段、
 * AI 意向等级）合成**一个**概念，只给销售两张名单：今天要联系 / 先放着。
 *
 * hot / cold 对应旧的两层：hot = 原来「在等我们 / 今天动过」那一层，
 * cold = 原来「排队中 / 已排除」那一层。名字换了，人一个没少。
 *
 * 🔴 **意向不动人、也不排序**（PM 2026-10-10 抽查后定）。
 *
 * 产生意向等级的那个 prompt 没有写下来的判据，抽查几个人就判错 —— 一个没校准
 * 的信号不许决定谁进名单、谁排前面，更不许在名单上写「AI 读完对话判他意向高」
 * 这种替 AI 背书的话。它现在只被带到这里，供抽屉里显示一行小字
 * 「AI 初判（未校准）」。要重新让它影响名单，先做
 * `docs/specs/2026-10-10-crm-intent-calibration-plan.md` 里的校准。
 *
 * 2026-08-02 的教训仍然成立：分段少配一列，33 个点过链接的客人在页面上凭空
 * 消失，没有任何报错 —— 每个 Segment 必须恰好落进一张名单（见
 * `BASE_LIST_OF_SEGMENT` 的穷尽 Record）。
 */

import { compareForWorklist, type Segment, type SegmentResult } from './segments'

/** 对应 conversation_briefs.intent_level。null = 这个人根本没有 AI 简报。 */
export type IntentLevel = 'high' | 'medium' | 'low' | 'unknown'
export const INTENT_LEVELS: readonly IntentLevel[] = ['high', 'medium', 'low', 'unknown']

export type NextActionList = 'hot' | 'cold'
export type NextActionVerb = 'reply' | 'call' | 'follow_up' | 'system_watching' | 'hold' | 'do_not_contact'

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
  /**
   * 恒为 false —— 意向未校准前不抬人（PM 2026-10-10）。
   * 保留字段是为了校准通过后恢复时不改响应形状。
   */
  intentBoost: boolean
}

/**
 * 销售一天打得完的人数（PM 2026-10-10 定：每天 20 个）。
 *
 * 只是**显示上的分界线**：「今天要联系」里不管有多少人都照常列出来（2026-08-02 的教训：
 * 人不能因为一个上限就从页面上消失），只是第 20 个之后画一条线，写明「以下是后面排队的」。
 */
export const DAILY_QUOTA = 20

export const LIST_META: Record<NextActionList, { title: string; hint: string }> = {
  hot: { title: '今天要联系', hint: `先打前 ${DAILY_QUOTA} 个，按紧急程度从上往下；后面的排队等着，打完前面的自然往上顶。` },
  cold: { title: '先放着', hint: '系统盯着，他一开口会自己跳上去。以后才走 / 已成交 / 别再联系的人也在这里。' },
}

export const VERB_LABEL: Record<NextActionVerb, string> = {
  reply: '回他',
  call: '打给他',
  follow_up: '记下一步',
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
  // 看发件地址就不像客人来咨询 —— 只从「今天要联系」挪到「先放着」，
  // 人还在名单里看得到，不删不藏（PM 2026-10-21：不许凭空消失）。
  not_enquiry_suspect: 'cold',
}

/**
 * 这个人进哪张名单。
 *
 * 只看分段 —— 意向**不参与**（PM 2026-10-10：意向未校准，不许决定谁进名单）。
 * 第二个参数保留是因为调用方都在传，但它被忽略；等校准通过后要恢复抬升，
 * 见 `docs/specs/2026-10-10-crm-intent-calibration-plan.md`。
 */
export function listOf(segment: Segment, _intent: IntentLevel | null = null): NextActionList {
  void _intent
  return BASE_LIST_OF_SEGMENT[segment]
}

/** 抽屉里那行小字。只在有明确判断时显示；unknown / 没摘要 → null（不显示）。 */
export function intentNote(intent: IntentLevel | null): string | null {
  if (intent === 'high') return 'AI 初判（未校准）：意向高'
  if (intent === 'medium') return 'AI 初判（未校准）：意向中'
  if (intent === 'low') return 'AI 初判（未校准）：意向低'
  return null
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
  afterCall = false,
): NextActionVerb {
  if (segment === 'excluded') return 'do_not_contact'
  // 刚打通聊上了 —— 再写「打给他」是让人再打一遍（PM 2026-10-29）。
  if (afterCall) return 'follow_up'
  // 没有这一行会落到最后的 `return 'reply'`，名单上就会出现自相矛盾的
  // 「回他 —— 看着不是客人来咨询（供应商系统通知）」（子牙复审 P1-1）。
  if (segment === 'not_enquiry_suspect') return 'do_not_contact'
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
  const verb = verbOf(seg.segment, seg.suggestedChannel, list, seg.afterCall === true)
  const verbLabel = VERB_LABEL[verb]
  const reason = seg.reason
  const trimmed = typeof aiNextAction === 'string' ? aiNextAction.trim() : ''
  return {
    list,
    verb,
    verbLabel,
    line: `${verbLabel} —— ${reason}`,
    reason,
    aiSuggestion: trimmed.length > 0 ? trimmed : null,
    intentBoost: false,
  }
}

/**
 * 今天已经动过他了 —— 「该做什么」那一格改成「先别打 —— 今天做了什么」。
 *
 * 否则同一张卡一边灰着打勾写「今天联系过了」，一边还写「记下一步 / 打给他」，
 * 自相矛盾（魏征复审 PR #3417 P2-b）。只换动词和理由，名单（hot / cold）不动 —— 位置不变是 day-list 的承诺。
 */
export function handledNextAction(na: NextAction, why: string): NextAction {
  return {
    ...na,
    verb: 'hold',
    verbLabel: VERB_LABEL.hold,
    reason: why,
    line: `${VERB_LABEL.hold} —— ${why}`,
  }
}

/** 排序用的时间戳。没有触点（null / 空 / 解析不出）当成「刚刚」—— 新人排最前。 */
function recency(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/**
 * 「今天要联系」里，这个人落在哪一档（越小越靠前）。PM 2026-10-30 定，CTS 团队次日正式上线前的一次排序更新。
 *
 *   0 约好的回电时间到了（真约定，不是刚打完电话的提醒）—— 我们答应过的时间，最该先打。
 *   1 刚通完电话 3 小时内、只差记一笔 —— 员工要马上回来记，放前面好找（PM 2026-10-30：Esther 被沉到最底找不到）。
 *   2 在等我们回（replied / 回头客）和今天刚进线的新客人 —— 都是今天就得联系的，按最新动静排。
 *   3 点过我们邮件链接 / 打过没接要再试 —— 中间这一大段维持原来「最近有动静排前面」。
 *   4 刚通完电话超过 3 小时还没记 —— 已不紧迫，放最后。
 *
 * 只把最该在最前的（约定 / 在等我们）和最该在最后的（只差记一笔）挪开，中间一大段仍按
 * 最近动静排 —— 避免 PM 2026-10-10 指出的「最近联系那一列来回跳、看不出顺序」。
 * 意向**完全不参与排序**（未校准，见文件头）。
 */
/** 刚打完电话多久内，算「刚聊过」排前面。 */
const JUST_CALLED_MS = 3 * 60 * 60 * 1000

function hotTier(seg: SegmentResult): 0 | 1 | 2 | 3 | 4 {
  if (seg.segment === 'callback_due') {
    if (seg.afterCall !== true) return 0
    // 刚打完电话 3 小时内：员工马上要回来记一笔，排在真约定之后、其余之前，好找（PM 2026-10-30，Esther 被沉到最底找不到）。
    // 超过 3 小时还没记：已不紧迫，沉到最后。
    const at = seg.lastTouchAt ? Date.parse(seg.lastTouchAt) : NaN
    return Number.isFinite(at) && Date.now() - at <= JUST_CALLED_MS ? 1 : 4
  }
  // 在等我们回的（replied / 回头客）和今天刚进线的新客人并列最前，按最新动静排 ——
  // 新线索凉得快，不能埋在回头客后面（PM 2026-10-30）。
  if (seg.segment === 'replied' || seg.segment === 'new_untouched') return 2
  return 3
}

/**
 * 名单里谁排前面。
 *
 * hot 名单：先按上面四档分先后；同一档内维持一条规则 —— 最近有动静的排前面，
 * 没有任何触点的新人当成「刚刚」。cold 名单沿用引擎原排序（`compareForWorklist`）。
 */
export function compareNextAction(
  a: { seg: SegmentResult; intent: IntentLevel | null },
  b: { seg: SegmentResult; intent: IntentLevel | null },
): number {
  const aHot = BASE_LIST_OF_SEGMENT[a.seg.segment] === 'hot'
  const bHot = BASE_LIST_OF_SEGMENT[b.seg.segment] === 'hot'
  if (aHot && bHot) {
    const at = hotTier(a.seg)
    const bt = hotTier(b.seg)
    if (at !== bt) return at - bt
    const aAt = recency(a.seg.lastTouchAt)
    const bAt = recency(b.seg.lastTouchAt)
    if (Number.isFinite(aAt) || Number.isFinite(bAt)) {
      const byRecent = bAt - aAt
      if (byRecent !== 0) return byRecent
    }
  }
  return compareForWorklist(a.seg, b.seg)
}
