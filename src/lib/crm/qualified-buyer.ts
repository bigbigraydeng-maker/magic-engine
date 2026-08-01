/**
 * 「谁算真买家」—— 地产投放唯一有意义的分母。
 *
 * 整条地产线的优化目标是「每个**真买家**多少钱」，不是「每个咨询多少钱」。
 * 在此之前这件事卡在人工标注上（只有中介本人知道谁是真的），所以分母一直是空的，
 * 广告花的每一块钱都归不到结果上。PM 2026-08-01 给了可自动判定的定义，卡点解开。
 *
 * 本文件只放**判定**，不碰数据库、不读环境变量 —— 判定必须能被单元测试直接打，
 * 因为它写错不会报错，只会安静地把分母算脏（一个被错标的看客会让「每个真买家
 * 多少钱」显得比真实便宜，这正是 PM 最在意的那个方向）。
 * 落库那一半在 qualified-buyer-autotag.ts。
 */

// ── 规则一 · 什么算真买家（PM 2026-08-01 拍板）─────────────────────────────

/**
 * 客户**自己发的**消息达到这个条数 = 真买家。
 *
 * PM 2026-08-01 拍板 3 条，并且明确选了「只数客户发的（inbound）」这个数法，
 * 而不是「一段对话里的消息总数 ≥ 3」。理由是后者方向是反的：我们自己多回两句
 * 就能把一个人「变成」真买家，分母被我们自己的动作抬高，「每个真买家多少钱」
 * 于是算得比真实便宜。所以这里数的永远只有 inbound —— 这不是实现细节，
 * 是这条规则的全部意义所在，改数法等于把规则改成它的反面。
 */
export const QUALIFIED_MIN_INBOUND_MESSAGES = 3

/**
 * 「表达了想预约线下看房」的说法清单（PM 2026-08-01 拍板的第二条命中条件）。
 *
 * 为什么是词表而不是再调一次 AI：每小时的私信简报（conversation_briefs）已经
 * 是一次模型调用，为了一个布尔值再调一次是纯增本，而简报里本来就有一个字段
 * 写着「客户到底想要什么」（customer_needs）。所以这里对两类文本做匹配：
 * 客户自己发的原话 + 简报的 customer_needs。
 *
 * 英文一律小写（匹配前会把待查文本转小写）；中文不受大小写影响。
 */
export const VIEWING_REQUEST_PHRASES: readonly string[] = [
  // 中文
  '看房',
  '约看',
  '预约看',
  '带看',
  '开放日',
  '实地看',
  '现场看',
  '亲自看',
  '去看看房子',
  // 英文
  'open home',
  'openhome',
  'private viewing',
  'a viewing',
  'book a viewing',
  'arrange a viewing',
  'view the property',
  'view the house',
  'see the property',
  'see the house',
  'see it in person',
  'come and see',
  'come see',
  'have a look at the property',
  'have a look at the house',
  'walk through',
  'inspection',
  'inspect the property',
]

/** 命中了哪一条规则。审计里逐条记下来 —— 以后要能分开算两条规则各自的准确率。 */
export type QualifiedBuyerRule = 'inbound_messages' | 'viewing_requested'

/** 一条对话消息（只取判定要用的两个字段）。 */
export interface QualifiedBuyerMessage {
  direction: 'inbound' | 'outbound'
  body: string | null
}

/** AI 简报里本判定会用到的部分。 */
export interface QualifiedBuyerBrief {
  /**
   * conversation_briefs.customer_needs —— schema 的定义就是「客户到底想要什么」。
   *
   * **刻意只取这一个字段**：summary 混着「对话进行到哪一步」（我们这边的事），
   * next_action / promises_made / draft_reply 干脆全是我们要说的话。拿我们自己
   * 写的字去证明「客户想看房」，跟「我们自己多发几条就把人变成真买家」是同一个
   * 方向错误 —— PM 已经明确否掉过一次，这里不能从后门放回来。
   */
  customerNeeds: readonly string[]
}

export interface QualifiedBuyerVerdict {
  qualified: boolean
  /** 命中的规则，按 QualifiedBuyerRule 的顺序。没命中就是空数组。 */
  rules: QualifiedBuyerRule[]
  /** 客户自己发了几条（无论是否达标都给，审计里要看得到）。 */
  inboundCount: number
  /** 中文一句，直接写进审计 note —— 以后要能回答「凭什么标的」。 */
  evidence: string | null
}

/** 一次看房意向命中：命中的说法 + 出自哪句原话。 */
export interface ViewingRequestHit {
  phrase: string
  excerpt: string
}

const EXCERPT_MAX_CHARS = 80

/**
 * 否定词。命中看房说法之前的一小段窗口里出现这些，就不算意向。
 *
 * 为什么必须有这一层：纯子串匹配下，「我**不想看房**」「not interested in **a viewing**」
 * 会照样命中，把明确拒绝的人标成真买家 —— 而真买家数正是判断这套房跑得成不成功的
 * 那个指标，标错方向是往上虚报。复审实测：6 句否定全部被误判。
 */
const NEGATION_MARKERS: readonly string[] = [
  // 中文（含单字「不 / 没 / 别」，宁可误伤也不放过）
  '不', '没', '别', '无需', '暂不', '免',
  // 英文
  'not', 'no ', "n't", 'never', 'cannot', 'without',
]

/**
 * 分句符。否定只在**同一个子句内**生效 —— 固定长度的窗口两头不讨好：
 * 英文「not interested in a viewing」隔了 15 个字符，窗口小了漏；
 * 中文「这周不想看房，下周想约看房」窗口大了又会让前半句的「不」
 * 把后半句真实的意向也一起否掉。
 */
const CLAUSE_BREAKS = /[，,。.；;！!？?\n、]/

/** 命中点所在的那个子句里有没有否定词。 */
function isNegated(haystack: string, hitIndex: number): boolean {
  const before = haystack.slice(0, hitIndex)
  // 往前找最近的分句符，只看它之后那一段。
  let start = 0
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLAUSE_BREAKS.test(before[i])) {
      start = i + 1
      break
    }
  }
  const clause = before.slice(start)
  return NEGATION_MARKERS.some((marker) => clause.includes(marker))
}

/**
 * 这堆文本里有没有人说「想去看房」。返回第一个命中，附上原话（审计要有出处）。
 *
 * 只做子串匹配，故意不做词形还原 / 模糊匹配：宁可漏标（这个人下次多说两句就会
 * 被规则一捞到），也不要把「我们给他发了开放日时间」这种我们自己的话算成他的意向。
 *
 * 同一句里可能出现多次同一说法（「不想看房，改天再看房」），所以每个位置都查一遍，
 * 只要有一处没被否定就算命中。
 */
export function detectViewingRequest(texts: readonly string[]): ViewingRequestHit | null {
  for (const raw of texts) {
    const text = (raw ?? '').trim()
    if (!text) continue

    const haystack = text.toLowerCase()
    for (const phrase of VIEWING_REQUEST_PHRASES) {
      let at = haystack.indexOf(phrase)
      while (at !== -1) {
        if (!isNegated(haystack, at)) {
          const excerpt =
            text.length > EXCERPT_MAX_CHARS ? `${text.slice(0, EXCERPT_MAX_CHARS)}…` : text
          return { phrase, excerpt }
        }
        at = haystack.indexOf(phrase, at + phrase.length)
      }
    }
  }
  return null
}

/**
 * 这个人算不算真买家。满足**任一**条规则即算（PM 拍板：A 或 B，不是 A 且 B）。
 *
 * 纯函数：同样的输入永远给同样的结论，不看时间、不查库。
 */
export function judgeQualifiedBuyer(input: {
  messages: readonly QualifiedBuyerMessage[]
  brief?: QualifiedBuyerBrief | null
}): QualifiedBuyerVerdict {
  // 只数客户发的。这一行就是规则一的全部 —— 见 QUALIFIED_MIN_INBOUND_MESSAGES 的注释。
  const inbound = input.messages.filter((m) => m.direction === 'inbound')
  const inboundCount = inbound.length

  const rules: QualifiedBuyerRule[] = []
  const reasons: string[] = []

  if (inboundCount >= QUALIFIED_MIN_INBOUND_MESSAGES) {
    rules.push('inbound_messages')
    reasons.push(
      `客户自己发了 ${inboundCount} 条消息（门槛 ${QUALIFIED_MIN_INBOUND_MESSAGES} 条，不含我们回的）`,
    )
  }

  const hit = detectViewingRequest([
    ...inbound.map((m) => m.body ?? ''),
    ...(input.brief?.customerNeeds ?? []),
  ])
  if (hit) {
    rules.push('viewing_requested')
    reasons.push(`他提到想线下看房：「${hit.excerpt}」`)
  }

  return {
    qualified: rules.length > 0,
    rules,
    inboundCount,
    evidence: reasons.length > 0 ? reasons.join('；') : null,
  }
}

// ── 自动打标的三道闸 ──────────────────────────────────────────────────────────

/** 自动升级只会升到这一档，永远不写别的值。 */
export const AUTO_UPGRADE_TARGET_STAGE = 'qualified'

/**
 * 只有停在这些档（或**从没被标过**）的人才允许自动升级。
 *
 * 🔴 绝不覆盖人工判断：人一旦手工往后推过（约了看房 / 到场了 / 出价了 / 成交），
 * 或者手工推进了出口档（不感兴趣 / 无下文），这个人就**一律不动**。
 * 这个白名单同时也是「只升不降」那道闸 —— 目标档固定是 qualified，而放行的
 * 三种来源（没标过 / new / contacted）在地产漏斗里全都排在 qualified 前面，
 * 所以结构上不可能发生降级。加新值前先确认它在 qualified 之前。
 *
 * NULL 也放行：contacts.stage 可空且没有默认值，真实数据里绝大多数人是 NULL
 * （= 没有任何人做过判断），这正是这道闸要放行的情形，不是要拦的情形。
 */
export const AUTO_UPGRADE_SOURCE_STAGES = ['new', 'contacted'] as const

/**
 * 审计里的操作者标记。人工改阶段写的是操作者邮箱（见 stage PATCH 路由），
 * 自动打标写这个常量 —— 两者永远分得开，以后才答得出「AI 标错了多少」。
 */
export const AUTO_TAG_ACTOR = 'system:qualified-buyer'

/** 当前这一档允不允许被自动升级。 */
export function canAutoUpgradeStage(currentStage: string | null | undefined): boolean {
  const stage = (currentStage ?? '').trim()
  if (stage === '') return true
  return (AUTO_UPGRADE_SOURCE_STAGES as readonly string[]).includes(stage)
}

/** 一个人的全部判定材料（他名下所有对话合并后的结果）。 */
export interface ContactEvidence {
  clientId: string
  contactId: string
  /** contacts.stage 现值。null = 从没有人标过。 */
  currentStage: string | null
  /** 这个人名下**所有**对话的消息合起来 —— 阶段挂在人身上，不是挂在某一段对话上。 */
  messages: QualifiedBuyerMessage[]
  /** 这个人名下所有对话的简报 customer_needs 合起来。 */
  customerNeeds: string[]
}

export interface AutoTagDecision {
  clientId: string
  contactId: string
  fromStage: string | null
  toStage: typeof AUTO_UPGRADE_TARGET_STAGE
  verdict: QualifiedBuyerVerdict
}

/**
 * 一批人里谁该被自动升级到「真买家」。
 *
 * 三道闸全部收在这个纯函数里，落库那一层只负责执行它的结论 —— 判定逻辑只有
 * 一份、可以被测试直接打，不会出现「API 那条路绕过了闸」这种旁路。
 */
export function decideAutoTags(evidence: readonly ContactEvidence[]): AutoTagDecision[] {
  const decisions: AutoTagDecision[] = []

  for (const person of evidence) {
    // 闸 1：人已经做过判断（推到 qualified 之后的档，或推进了出口档）→ 一律不动。
    if (!canAutoUpgradeStage(person.currentStage)) continue

    // 闸 2：已经在目标档上了 → 不重复写，也不重复留审计。
    if (person.currentStage === AUTO_UPGRADE_TARGET_STAGE) continue

    const verdict = judgeQualifiedBuyer({
      messages: person.messages,
      brief: { customerNeeds: person.customerNeeds },
    })
    // 闸 3：两条规则一条都没命中 → 不标。
    if (!verdict.qualified) continue

    decisions.push({
      clientId: person.clientId,
      contactId: person.contactId,
      fromStage: person.currentStage,
      toStage: AUTO_UPGRADE_TARGET_STAGE,
      verdict,
    })
  }

  return decisions
}
