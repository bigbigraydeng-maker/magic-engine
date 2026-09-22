/**
 * NAL（New Asian Logistics，跨境集运物流代理）私信 → 「有效咨询」判定。
 *
 * L4 客户专属实现（`docs/registry/platform-candidates.md` 「私信/WhatsApp 对话
 * 内容判断有效咨询/成交 → 回传 Meta CAPI」候选，2026-09-13 登记）。判断规则只
 * 服务 NAL 这一个客户，不进 shared runtime——换客户/换行业测试都没过：这里的
 * 关键词（尺寸单位、TJJ 仓库码格式、NZ 地址）只对 NAL 的集运业务成立。
 *
 * 🔴 本轮范围只做「有效咨询」（lead），不做「已成交」——见设计评审结论：
 * NAL 184 个联系人的 CRM 阶段字段全是空的（员工从没标过阶段），且集运报价没有
 * 团价表可查金额，`me_sale_outcomes` 的 purchase 类型要求金额非空，现在拼不出
 * 合法记录。等 CRM 工作台的「已成交」阶段被员工真正用起来、有金额来源了再补。
 *
 * 判据来源：2026-09-14 用 21 个真实 NAL 联系人的完整对话人工标注 + 模拟跑规则
 * 验证过（0 假阳性，约 69% 召回——漏判的都是「客户已给细节，NAL 还没回实质
 * 内容」，故意先不算，这轮判定晚一点也不能把闲聊当真商机发给 Meta）。
 *
 * 判定必须**两侧都命中**才算（客户给了具体货物信息 **且** NAL 给了实质回应），
 * 不能用「任一侧」——实测证据：NAL 有一句几乎逐字出现在十个不同联系人对话里的
 * 自动报价模板（"Shipping rates • Under 20 kg: NZD 4/kg..."），只要客户问一句
 * "how much" 就会弹出来，模板本身带 $ 数字。如果拿「NAL 说过 $ 数字」当实质
 * 回应的信号，这十个联系人会全部被误判成真商机——这不是要不要做否定检测的问题，
 * 是「必须过滤掉这句模板」的问题，跟 `qualified-buyer.ts` 的否定窗口是两回事，
 * 两个都要有。
 */

import { isNegated } from '@/lib/crm/negation'

// ── 一、客户「给了具体货物信息」的判据 ──────────────────────────────────────

/** 重量/体积/箱数——真实客户最常给的度量单位。 */
const CARGO_MEASURE_RE = /\b\d+(\.\d+)?\s*(kgs?|cbm|tons?|tonnes?|箱|吨|立方)\b/i

/** 三维尺寸，如「90*42*82 CM」「3.15 × 1.10 × 1.40m」。 */
const CARGO_DIMENSION_RE = /\d+(\.\d+)?\s*[x×*]\s*\d+(\.\d+)?\s*[x×*]\s*\d+(\.\d+)?/i

/**
 * 物流意图词——光有这些词不够，必须配合 {@link CARGO_MEASURE_RE}/
 * {@link CARGO_DIMENSION_RE} 之一，或配合 {@link NZ_ADDRESS_RE}（见
 * hasCargoDetails 的判定逻辑）。单独出现不算，否则「你们做什么业务」这类首次
 * 问候也会命中。
 */
const SHIPPING_INTENT_KEYWORDS: readonly string[] = [
  'quote',
  'freight',
  'shipping',
  'container',
  'pallet',
  'lcl',
  'fcl',
  '20ft',
  '40ft',
  'door to door',
  'cargo',
  'shipment',
  'consolidate',
  '报价',
  '货代',
  '整柜',
  '拼柜',
]

/**
 * 新西兰送货地址——门牌号 + 街道类型词 + 城市/邮编。
 *
 * 弥补「没给重量/CBM，但给了完整地址」这种真实案例（Lance Searancke：没给
 * 度量数字，但给了门牌地址，换来了 NAL 针对性的费率表）。
 */
const NZ_ADDRESS_RE =
  /\d+[a-z]?\s+[a-z][a-z\s]{2,40}(road|street|avenue|drive|place|st\.?)\b.{0,30}(auckland|christchurch|wellington|hamilton|tauranga|dunedin|\b\d{4}\b)/i

/** NAL 私信场景的否定词——在 `qualified-buyer.ts` 的基础上补物流场景常见拒绝语。 */
const NAL_NEGATION_MARKERS: readonly string[] = [
  '不', '没', '别', '无需', '暂不', '免',
  'not interested', 'no need', "don't need", 'cancelled', 'never mind',
  'not', 'no ', "n't", 'never', 'cannot', 'without',
]

export interface CargoDetailHit {
  /** 命中依据的这一条消息 id（写审计时只存这个引用，不摘录原话）。 */
  messageId: string
  /** 命中的规则名，供审计追溯「为什么判定」。 */
  rule: 'measure' | 'dimension' | 'intent_with_address'
  /** 命中的具体度量/尺寸字符串，仅用于批次去重比对，不是完整对话原文。 */
  signalToken: string
}

/**
 * 这一条**客户自己发的**消息，算不算「给了具体货物信息」。
 *
 * 只查单条消息，不跨消息拼接——真实数据里客户常把一件事拆成好几条短消息发
 * （见 Dundee 案例），但把「货物信息」拼接判定放宽到跨消息，会让「你们在哪」+
 * 后面随便一句提到城市名的话也被拼出「地址」，误判率会升高；跨消息拼接目前
 * 只用在 hasCargoDetails 里「意图词 + 地址」这一条判据的兜底路径。
 */
function cargoDetailInMessage(text: string): { rule: CargoDetailHit['rule']; signalToken: string } | null {
  const measureMatch = text.match(CARGO_MEASURE_RE)
  if (measureMatch) return { rule: 'measure', signalToken: measureMatch[0] }
  const dimensionMatch = text.match(CARGO_DIMENSION_RE)
  if (dimensionMatch) return { rule: 'dimension', signalToken: dimensionMatch[0] }
  return null
}

export interface InboundMessage {
  messageId: string
  body: string | null
  sentAt: string
}

export interface OutboundMessage {
  messageId: string
  body: string | null
  sentAt: string
}

/**
 * 扫描客户发的消息，找第一条满足「给了具体货物信息」且没被否定掉的消息。
 *
 * 意图词 + 地址这条判据允许跨消息（地址常常是被问到才补发的下一条消息），
 * 用「这条消息本身 + 往前 3 条」的窗口拼接判断，不做全对话拼接（避免地址
 * 误配到不相关的更早对话）。
 */
export function findCargoDetailHit(messages: readonly InboundMessage[]): CargoDetailHit | null {
  for (let i = 0; i < messages.length; i++) {
    const text = (messages[i].body ?? '').trim()
    if (!text) continue
    // 否定词表混了中英文，英文词是小写字面量——统一转小写再查否定窗口，
    // 不然「Not interested」这种句首大写会因为大小写不match漏检。
    const lower = text.toLowerCase()

    const direct = cargoDetailInMessage(text)
    if (direct) {
      const idx = lower.search(direct.rule === 'measure' ? CARGO_MEASURE_RE : CARGO_DIMENSION_RE)
      if (idx === -1 || !isNegated(lower, idx, NAL_NEGATION_MARKERS)) {
        return { messageId: messages[i].messageId, rule: direct.rule, signalToken: direct.signalToken }
      }
      continue
    }

    // 兜底：意图词 + 地址，允许在最近 4 条客户消息内拼接查找。
    const windowTexts = messages
      .slice(Math.max(0, i - 3), i + 1)
      .map((m) => (m.body ?? '').trim())
      .filter(Boolean)
    const windowJoined = windowTexts.join(' ').toLowerCase()
    const hasIntent = SHIPPING_INTENT_KEYWORDS.some((kw) => windowJoined.includes(kw))
    const addressMatch = text.match(NZ_ADDRESS_RE)
    if (hasIntent && addressMatch) {
      const idx = lower.search(NZ_ADDRESS_RE)
      if (idx === -1 || !isNegated(lower, idx, NAL_NEGATION_MARKERS)) {
        return { messageId: messages[i].messageId, rule: 'intent_with_address', signalToken: addressMatch[0] }
      }
    }
  }
  return null
}

// ── 二、NAL「给了实质回应」的判据 ────────────────────────────────────────────

/**
 * 通用费率播报模板——命中即从「实质回应」候选里剔除。
 *
 * 🔴 见文件头说明：这是本判据设计阶段最大的一个坑。这句话只要客户问一句
 * "how much" 就会自动弹出来，不是针对这一单货的报价，十个不同联系人的对话
 * 里逐字出现过。绝不能把「出现了 $ 数字」直接当成 NAL 已实质回应。
 */
const CANNED_RATE_TEMPLATE_RE = /shipping rates\s*[•\-]?\s*under 20\s*kg[\s\S]*?service fee/i

/**
 * 系统自动生成的消息——Meta/CRM 自己插进 outbound 流的操作日志，不是 NAL
 * 员工说的话。混进关键词匹配会污染判断，先过滤掉。
 */
const SYSTEM_NOISE_RE =
  /回复了(你的自动欢迎消息|一条广告)|把这个对话分配给了|自动标签已添加|你呼叫了|错过了你的通话|通话期限已重置/

/** 针对这一单货的真实报价——具体金额，且不是 {@link CANNED_RATE_TEMPLATE_RE} 那句模板。 */
const REAL_QUOTE_RE = /\b(nzd?\s?\$?|nz\$)\s?\d{2,}(\.\d+)?\b/i

/** 分配了仓库地址/客户码——实测固定格式 "TJJ" + 数字，或中文收件地址话术。 */
const WAREHOUSE_CODE_RE = /TJJ\d+|收件地址|dedicated (warehouse|receiving) address|consolidation warehouse/i

/** 已发出正式报价的确认话术——哪怕具体金额在邮件附件里、聊天文本看不到。 */
const QUOTE_SENT_PHRASES: readonly string[] = [
  'quote sent',
  'sent you the email',
  'quotation to you by email',
  'formal quote',
  'emailed you the quotation',
  'sent you the quotation',
]

export interface NalReplyHit {
  messageId: string
  rule: 'real_quote' | 'warehouse_code' | 'quote_sent_phrase'
  sentAt: string
}

/**
 * 扫描 NAL 发的消息（`after` 之后），找第一条构成「实质回应」的消息。
 * 过滤掉系统噪音消息和通用报价模板后再匹配。
 */
export function findNalReplyHit(messages: readonly OutboundMessage[], after: string): NalReplyHit | null {
  for (const m of messages) {
    if (m.sentAt <= after) continue
    const text = (m.body ?? '').trim()
    if (!text) continue
    if (SYSTEM_NOISE_RE.test(text)) continue
    const withoutTemplate = text.replace(CANNED_RATE_TEMPLATE_RE, '')
    if (REAL_QUOTE_RE.test(withoutTemplate)) return { messageId: m.messageId, rule: 'real_quote', sentAt: m.sentAt }
    if (WAREHOUSE_CODE_RE.test(text)) return { messageId: m.messageId, rule: 'warehouse_code', sentAt: m.sentAt }
    const lower = text.toLowerCase()
    if (QUOTE_SENT_PHRASES.some((p) => lower.includes(p))) {
      return { messageId: m.messageId, rule: 'quote_sent_phrase', sentAt: m.sentAt }
    }
  }
  return null
}

// ── 三、批次边界：同一人隔多久、换了什么货算「新一次咨询」──────────────────

/**
 * 两次命中相隔至少这么多天，才**有资格**被考虑成新一次咨询。
 *
 * 🔴 光用天数切不够——真实数据给出两个矛盾案例：一个隔 14 天、品名换了，
 * 该算两次；一个隔 12 天、还是同一票货，只是客户拖了才回来接着聊，该算一次。
 * 所以天数只是资格条件，真正判定还要看 signalToken 是否变了（见下方
 * classifyNalConversation）。这条规则目前只能覆盖「品名/数字明显不同」这种
 * 情况，建议先落地跑一阵子看实际数据分布，不是精确解。
 */
export const BATCH_GAP_DAYS = 7

export interface QualifiedLead {
  outcomeKind: 'lead'
  /** 客户给出货物信息的那条消息 —— 幂等键 source_ref 的原料。 */
  leadMessageId: string
  leadRule: CargoDetailHit['rule']
  /** NAL 给出实质回应的那条消息。 */
  replyMessageId: string
  replyRule: NalReplyHit['rule']
  occurredAt: string
}

/**
 * 扫描一段完整对话（按 sentAt 升序），找出全部满足「客户给了细节 + NAL 给了
 * 实质回应」的批次，每个批次对应一次独立的「有效咨询」。
 *
 * 纯函数：不读数据库、不查客户端配置，方便单测直接打。
 */
export function classifyNalConversation(
  inbound: readonly InboundMessage[],
  outbound: readonly OutboundMessage[],
): QualifiedLead[] {
  const leads: QualifiedLead[] = []
  let cursor = 0
  let lastSignalToken: string | null = null
  let lastLeadAt: string | null = null

  while (cursor < inbound.length) {
    const remaining = inbound.slice(cursor)
    const hit = findCargoDetailHit(remaining)
    if (!hit) break

    const hitIndexInRemaining = remaining.findIndex((m) => m.messageId === hit.messageId)
    const hitMessage = remaining[hitIndexInRemaining]

    // 「新一次」要同时满足：隔够 BATCH_GAP_DAYS 天 且 signalToken 变了。
    // 只满足其中一条（离得太近；或者隔够了但还是同一票货换个说法追问，
    // 即 Rangiora 案例：隔 12 天但 token 没变）都算同一批，不重复计。
    const isSameBatchAsLast =
      lastLeadAt !== null &&
      (daysBetween(lastLeadAt, hitMessage.sentAt) < BATCH_GAP_DAYS || lastSignalToken === hit.signalToken)

    // 同一票货的延续追问——跳过，从这条消息之后继续找下一个真正的新命中。
    if (isSameBatchAsLast) {
      cursor += hitIndexInRemaining + 1
      continue
    }

    const reply = findNalReplyHit(outbound, hitMessage.sentAt)
    if (reply) {
      leads.push({
        outcomeKind: 'lead',
        leadMessageId: hit.messageId,
        leadRule: hit.rule,
        replyMessageId: reply.messageId,
        replyRule: reply.rule,
        occurredAt: reply.sentAt,
      })
      lastSignalToken = hit.signalToken
      lastLeadAt = hitMessage.sentAt
    }
    // 不管这次有没有等到 NAL 实质回应，都从这条消息之后继续扫——
    // 「还没等到回复」不是错误，是这一轮故意先不算数（见文件头说明）。
    cursor += hitIndexInRemaining + 1
  }

  return leads
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
}

/** 幂等键原料——跟 CTS 那条线（`ctsSourceRef`）风格一致：一眼看出来自哪条消息。 */
export function nalMessengerSourceRef(contactId: string, leadMessageId: string): string {
  return `nal_messenger:${contactId}:${leadMessageId}`
}
