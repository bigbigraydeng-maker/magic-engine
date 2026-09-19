/**
 * Client knowledge base — conversation mining (design §3.2/§9.7/§9.8/§9.14-E.3,
 * issue #1645).
 *
 * Turns real employee replies into `client_knowledge_facts` CANDIDATES. Never
 * writes anything but `status='candidate'` — approval is always a separate,
 * human step (FDE review issue #1646, then client confirmation for
 * non-general facts via the existing dual-sign gate in `read.ts`).
 *
 * Pipeline (§3.2): collect → merge exact-duplicate templates → redact PII →
 * extract via LLM → drop deal-specific one-offs → verify every number
 * against its source message → group into conflict clusters (including
 * against already-approved facts AND still-unreviewed candidates from prior
 * runs) → write candidates + a receipt row.
 *
 * Fail-closed budget (§9.8): every run declares max messages / max model
 * calls / max spend up front; missing any one of the three refuses to run
 * at all (`assertMiningBudget`) — there is no "unlimited" default. These
 * three per-run hard caps ARE the spend governor for this feature.
 *
 * 🔴 事故预防（2026-09-14，读设计文档 §9.8 逐字核对后发现的自我纠错）：
 * 早期版本额外调用了 `@/lib/mtc/budget-guard` 的 `checkBudget()` 做"只读
 * 月度预算头寸检查"，理由是issue #1645 的一句话概述提到"复用既有预算
 * 闸"。但设计文档 §9.8（魏征 11）明确写了**不用**这个模块，并给了两条
 * 理由：① 它管的是客户自己购买的 MTC 积分余额，跟 ME 自己付给模型
 * 供应商的钱是两个完全不同的账本，语义层不对；② 实测确认
 * `getMonthlyCap()` 读失败时会静默放行、退回默认上限 5000（`budget-
 * guard.ts` 的 `getMonthlyCap` 函数），这是"读失败=放行"的 fail-open
 * 设计，跟本文件"缺任一硬顶就拒绝运行"的 fail-closed 原则直接矛盾——
 * 把这道本该严格的闸，接到一个允许静默放行的模块上。issue 文本本身在
 * 设计文档这条修正之后没有同步更新，本文件之前照着 issue 的旧描述实现
 * 是错的，已经删掉这个依赖，只保留本来就正确的三道硬顶。
 */

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'
import { jsonrepair } from 'jsonrepair'
import { getClientKnowledge } from './read'
import { detectSensitivity, type Sensitivity } from './sensitivity'

/**
 * 桥接 unknown：同 read.ts/entitlement.ts 的 defaultSupabase() 深层泛型限制
 * （supabase-js 的 select() 只能从字面量字符串推断行类型；本文件的 select 多数是
 * 拼接出来的普通字符串）。实测：本机 PG 沙盘对着真实表跑过同样的 select/insert/
 * update，每个调用点传入的列清单都跟对应表的真实列逐一核对一致（见本 PR 描述的
 * 探针记录）。
 */
export function asRows<T>(data: unknown): T[] {
  return (data ?? []) as unknown as T[]
}

// ── Budget ───────────────────────────────────────────────────────────────

export interface MiningBudget {
  maxMessages: number
  maxModelCalls: number
  maxSpendUsd: number
}

/**
 * Throws unless all three caps are present and positive. There is
 * deliberately no fallback value for a missing cap — "forgot to configure a
 * limit" and "explicitly unlimited" must never look the same (§9.8).
 */
export function assertMiningBudget(budget: Partial<MiningBudget> | null | undefined): asserts budget is MiningBudget {
  if (!budget) throw new Error('assertMiningBudget: no budget given — mining must not run unbounded')
  const { maxMessages, maxModelCalls, maxSpendUsd } = budget
  if (!maxMessages || maxMessages <= 0) {
    throw new Error('assertMiningBudget: maxMessages must be a positive number')
  }
  if (!maxModelCalls || maxModelCalls <= 0) {
    throw new Error('assertMiningBudget: maxModelCalls must be a positive number')
  }
  if (!maxSpendUsd || maxSpendUsd <= 0) {
    throw new Error('assertMiningBudget: maxSpendUsd must be a positive number')
  }
}

// ── Template merging ─────────────────────────────────────────────────────

/**
 * Merge key for "is this the same template". NFKC-normalises and collapses
 * whitespace/newlines so formatting noise doesn't fragment a template, but
 * never touches digits or words — "Under 20 kg" and "Under 10 kg" must
 * never merge (§9.7: "合并只合规范化后完全相同的文本，数字原样保留").
 */
export function normaliseTemplateKey(body: string): string {
  return body.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export interface RawMessage {
  body: string
  sentAt: string
  direction: 'inbound' | 'outbound'
  conversationId: string
}

export interface MessageTemplate {
  normalizedKey: string
  sampleBody: string
  /** Total number of times this exact template was sent, across all conversations. */
  count: number
  /**
   * How many DISTINCT conversations this template appeared in — the number
   * that actually matters for "is this a reusable house rule or one
   * customer being told the same thing repeatedly" (§9.7: "只在一段对话
   * 出现过...不能成为通用候选"). Using raw `count` for this would conflate
   * "sent to 51 different customers" with "repeated 51 times to the SAME
   * customer in one thread" — the latter is not evidence of a business-wide
   * rule no matter how many times it recurs.
   */
  distinctConversationCount: number
  firstSeenAt: string
  lastSeenAt: string
  /** The customer message immediately preceding the FIRST occurrence, if any — LLM context only, not evidence. */
  precedingCustomerQuestion: string | null
}

/**
 * Group a client's outbound (employee) messages into exact-duplicate
 * templates, each carrying its occurrence count and a representative
 * preceding customer question for LLM context.
 */
export function groupMessagesIntoTemplates(messages: RawMessage[]): MessageTemplate[] {
  const byConversation = new Map<string, RawMessage[]>()
  for (const m of messages) {
    if (!byConversation.has(m.conversationId)) byConversation.set(m.conversationId, [])
    byConversation.get(m.conversationId)!.push(m)
  }
  for (const list of byConversation.values()) {
    list.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }

  const templates = new Map<string, MessageTemplate>()
  const conversationsByKey = new Map<string, Set<string>>()

  for (const [conversationId, list] of byConversation.entries()) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (m.direction !== 'outbound') continue
      const key = normaliseTemplateKey(m.body)
      if (!key) continue

      let precedingCustomerQuestion: string | null = null
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].direction === 'inbound') {
          precedingCustomerQuestion = list[j].body
          break
        }
      }

      if (!conversationsByKey.has(key)) conversationsByKey.set(key, new Set())
      conversationsByKey.get(key)!.add(conversationId)

      const existing = templates.get(key)
      if (!existing) {
        templates.set(key, {
          normalizedKey: key,
          sampleBody: m.body,
          count: 1,
          distinctConversationCount: 0, // filled in below, once all messages are seen
          firstSeenAt: m.sentAt,
          lastSeenAt: m.sentAt,
          precedingCustomerQuestion,
        })
      } else {
        existing.count += 1
        if (m.sentAt < existing.firstSeenAt) existing.firstSeenAt = m.sentAt
        if (m.sentAt > existing.lastSeenAt) existing.lastSeenAt = m.sentAt
      }
    }
  }

  for (const [key, template] of templates.entries()) {
    template.distinctConversationCount = conversationsByKey.get(key)?.size ?? 0
  }

  return [...templates.values()].sort((a, b) => b.count - a.count)
}

// ── PII redaction ────────────────────────────────────────────────────────
//
// Deliberately aggressive (same philosophy as sensitivity.ts): over-redacting
// business text just costs the LLM a little context; under-redacting sends a
// customer's name/phone/address/order number to a third-party API.

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

// Phone-number-or-postcode SHAPE: a digit, then a run of digits/space/tab/
// hyphen/parens, ending in a digit. Deliberately permissive about the
// separators — a real ANZ phone number is almost always written WITH
// separators ("021 234 5678", "021-234-5678", "+64 21 234 5678",
// "(09) 123 4567"); a bare `\d{6,}` (no separators allowed) would miss every
// one of those and only catch an already-rare bare digit run. Operates
// per-LINE (never on the raw multi-line text) so `\s` here can only match
// spaces/tabs within one line, not swallow across lines. The actual
// digit-count check (not match length) happens in the replace callback
// below — a match's *length* can be inflated by punctuation without its
// *digit count* being a real phone number, so length alone isn't the gate.
//
// 🔴 魏征复审（2026-09-14）实测发现：字符类里原来含字面 `.`，会把
// "NZD 1234.56" 这类真实报价金额也当成电话号码抹掉（小数点当成分隔符，
// 凑够 6 位数字触发）。NZ 电话号码从不用句点做分隔符，去掉 `.` 后金额
// 的整数部分（"1234"，4 位）够不到 MIN_PHONE_DIGITS，小数部分（"56"，
// 2 位）单独也够不到——两边都不会被误判成电话。
const PHONE_CANDIDATE_PATTERN = /\+?\(?\d[\d \t\-()]{2,}\d\)?/g
const MIN_PHONE_DIGITS = 6

function countDigits(text: string): number {
  return (text.match(/\d/g) ?? []).length
}

// Order/tracking numbers: 2-6 letters immediately followed by 4-8 digits.
const TRACKING_NUMBER_PATTERN = /\b[A-Za-z]{2,6}\d{4,8}\b/g

// A line is treated as a physical address once it contains 2+ Chinese
// administrative/street markers (simplified AND traditional variants —
// 魏征复审 2026-09-14 实测发现原列表只有简体，一条纯繁体地址会漏判).
const ADDRESS_MARKERS = [
  '省', '市', '区', '區', '镇', '鎮', '村', '路', '街', '巷', '弄',
  '号', '號', '栋', '棟', '幢', '单元', '單元', '室', '邮编', '郵編', '县', '縣',
]

function looksLikeChineseAddressLine(line: string): boolean {
  const hits = ADDRESS_MARKERS.filter((marker) => line.includes(marker)).length
  return hits >= 2
}

// 🔴 魏征复审（2026-09-14）实测确认的高危缺口：原实现只认中文地址标记，
// 一条普通的新西兰英文地址（"42 Ponsonby Road, Grey Lynn, Auckland 1021"）
// 完全不脱敏，原样发给 Anthropic API——这条 PR 存在的理由本身被打穿。
// 英文地址判定：一个数字门牌号 + 附近出现常见街道类型词，不要求门牌号
// 紧邻词本身（"12 Beach Road" / "Unit 3, 42 Ponsonby Road" 都要抓住）。
const ENGLISH_STREET_TYPE_RE =
  /\b\d+[a-z]?\b[\s\S]{0,40}\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|place|pl|way|crescent|cres|terrace|tce|highway|hwy|grove|close|court|ct|boulevard|blvd)\b/i

function looksLikeEnglishAddressLine(line: string): boolean {
  return ENGLISH_STREET_TYPE_RE.test(line)
}

// 🔴 魏征复审（2026-09-14）实测确认：客户/收件人姓名从未被任何一类规则
// 覆盖过（PR 自带的地址夹具脱敏后 "TJJ28967 - Praash" 变成
// "[已抹去:单号] - Praash"，姓名原样保留，是作者自己的测试数据证明的）。
// 姓名本身无法用正则可靠识别（没有词典/NER），退而求其次：只要一行文本
// 带有"收件人/联系人/客户姓名/Recipient/Contact/Attn/Attention/Name"这类
// 标签+冒号，就把标签之后的整段内容当成姓名整行抹掉——覆盖不了没有显式
// 标签的姓名提及（如正文里随口一句"跟 John 说一声"），这是已知残留风险，
// 不是这次能用正则彻底解决的问题，故显式记录、不假装做到了。
const NAME_LABEL_RE = /(收件人|联系人|客户姓名|姓名|recipient|contact(?:\s*person)?|attn(?:ention)?|customer\s*name|name)\s*[:：]\s*(.+)/i

export interface RedactResult {
  text: string
  hits: string[]
}

/** Strip email / phone-or-postcode / tracking-number / address / labelled-name content before any text leaves ME for an LLM call. */
export function redactPersonalInfo(input: string): RedactResult {
  const hits = new Set<string>()
  const lines = input.normalize('NFKC').split('\n')

  const redactedLines = lines.map((line) => {
    if (looksLikeChineseAddressLine(line) || looksLikeEnglishAddressLine(line)) {
      hits.add('address')
      return '[已抹去:地址]'
    }
    const nameMatch = line.match(NAME_LABEL_RE)
    if (nameMatch) {
      hits.add('name')
      return line.slice(0, nameMatch.index! + nameMatch[1].length) + '：[已抹去:姓名]'
    }
    // Every pattern below uses a replace-callback (not test-then-replace) so
    // there is exactly one pass per pattern and no reliance on a global
    // regex's lastIndex state between the "did it match" check and the
    // substitution itself.
    let out = line.replace(EMAIL_PATTERN, () => {
      hits.add('email')
      return '[已抹去:邮箱]'
    })
    out = out.replace(TRACKING_NUMBER_PATTERN, () => {
      hits.add('tracking_number')
      return '[已抹去:单号]'
    })
    out = out.replace(PHONE_CANDIDATE_PATTERN, (match) => {
      if (countDigits(match) < MIN_PHONE_DIGITS) return match
      hits.add('phone_or_postcode')
      return '[已抹去:号码]'
    })
    return out
  })

  return { text: redactedLines.join('\n'), hits: [...hits] }
}

// ── Number provenance ────────────────────────────────────────────────────

// 🔴 魏征复审（2026-09-14）实测发现：原正则 `\d+(\.\d+)?` 把逗号当成非数字
// 分隔符，"NZD 1,000" 会被拆成两个独立的数字 1 和 000（=0），候选侧写的
// "1000" 永远核不到源文本里的 "1,000"，导致合法候选被误杀（物流报价过
// 千很常见千分位写法，不是边缘场景）。先尝试匹配"千分位逗号分组"的完整
// 数字，匹配不到才退化成普通连续数字，匹配到之后统一去掉逗号再转数值。
function extractNumbers(text: string): Set<number> {
  const normalised = text.normalize('NFKC')
  const matches = normalised.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []
  return new Set(matches.map((m) => Number(m.replace(/,/g, ''))))
}

/**
 * Every number the candidate asserts (in its statement AND its structured
 * value) must appear, by numeric value, somewhere in `sourceText`. A
 * candidate that invents a number the source never contained is dropped,
 * never written as a candidate (§9.7 anti-hallucination guard, PITFALLS D1).
 * A candidate with no numbers at all trivially passes (nothing to verify).
 */
export function validateNumberProvenance(
  candidateStatement: string,
  structuredValue: unknown,
  sourceText: string,
): boolean {
  const candidateText = `${candidateStatement} ${JSON.stringify(structuredValue ?? '')}`
  const candidateNumbers = extractNumbers(candidateText)
  if (candidateNumbers.size === 0) return true
  const sourceNumbers = extractNumbers(sourceText)
  return [...candidateNumbers].every((n) => sourceNumbers.has(n))
}

// ── Deal-specific classification ─────────────────────────────────────────

export type CandidateSpecificity = 'template' | 'suspected_deal_specific' | 'deal_specific'

/**
 * §9.7: the model saying nothing defaults to deal-specific (fail-closed — an
 * unlabelled candidate never becomes a reusable fact); a template that only
 * ever appeared once cannot be a reusable candidate either, no matter what
 * the model says; a number that matches what the CUSTOMER themselves quoted
 * (their own weight/value) is flagged suspected rather than dropped outright
 * so a human can look at it once, not to auto-approve or auto-reject it.
 *
 * `occurrenceCount` MUST be `MessageTemplate.distinctConversationCount`, not
 * `.count` — the design's "只在一段对话出现过...不能成为通用候选" means
 * "appeared in only one distinct conversation", not "was sent N times in
 * total" (raw send count conflates "sent to 51 different customers" with
 * "repeated 51 times to the same customer in one thread", which is not
 * evidence of a business-wide rule either way).
 */
export function classifyCandidateSpecificity(input: {
  occurrenceCount: number
  modelSaysDealSpecific: boolean | null
  numbersMatchCustomerQuestion: boolean
}): CandidateSpecificity {
  // 🔴 实测踩过一次：只判 `=== true` 会让"模型没给出信号"（解析失败时的
  // null）悄悄漏成非 deal_specific——只有明确的 `false` 才能免于 fail-closed，
  // `true` 和 `null` 都必须走 deal_specific，跟本函数文档一开始就写的
  // "模型没给信号也按 deal-specific 处理" 对齐（原实现只判 === true，跟
  // 自己的文档描述不符，已在移植时改正并补测试锁死）。
  if (input.modelSaysDealSpecific !== false) return 'deal_specific'
  if (input.occurrenceCount <= 1) return 'deal_specific'
  if (input.numbersMatchCustomerQuestion) return 'suspected_deal_specific'
  return 'template'
}

// ── Conflict grouping ────────────────────────────────────────────────────

export interface ConflictMember {
  /**
   * 'existing_candidate' — a `status='candidate'` row already sitting in the
   * table from a PRIOR mining run, not yet reviewed. Distinct from
   * 'candidate' (this run's freshly extracted, not-yet-written proposals) so
   * a conflict spanning both a prior run's unresolved candidate and a new
   * one can reuse the prior row's `conflict_group_id` instead of minting a
   * new, disconnected one — without this, the same real-world disagreement
   * fragments into multiple conflict groups across runs and a reviewer
   * never sees them side by side.
   */
  origin: 'approved' | 'candidate' | 'existing_candidate'
  refId: string
  factKey: string
  unit: string | null
  valueSignature: string
  /**
   * Set for 'approved' and 'existing_candidate' — the conflict group this
   * row already belongs to, if any (both are rows already sitting in
   * `client_knowledge_facts`, so both can already carry one from a prior
   * run). 🔴 魏征复审（2026-09-14）实测发现：原实现只给
   * 'existing_candidate' 设这个字段，'approved' 分支从未参与过"复用已有
   * 组号"和"回填组号"两段逻辑——已批准事实一旦被新候选顶上冲突，那一行
   * 自己的 conflict_group_id 永远是 null，复审页面按组号联查看不到它。
   */
  existingConflictGroupId?: string | null
}

export interface ConflictGroup {
  factKey: string
  unit: string | null
  members: ConflictMember[]
  hasConflict: boolean
}

/** Stable string for "is this the same asserted value" comparison, order-independent for object keys. */
export function computeValueSignature(structuredValue: unknown): string {
  if (structuredValue === null || structuredValue === undefined) return 'null'
  if (typeof structuredValue !== 'object') return JSON.stringify(structuredValue)
  const entries = Object.entries(structuredValue as Record<string, unknown>)
    .filter(([k]) => k !== 'unit')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

/**
 * Group every member sharing (factKey, unit) into one conflict group —
 * unconditionally, without trying to compare scopes (§9.14-B: "模型新提议的
 * 范围先强制与同单位全部事实归入冲突组，人定下范围后才解除" — scope
 * disambiguation is a human decision, not something this function guesses
 * at). A group is flagged `hasConflict` when it contains more than one
 * distinct asserted value.
 */
export function groupCandidatesByConflict(members: ConflictMember[]): ConflictGroup[] {
  const groups = new Map<string, ConflictMember[]>()
  for (const member of members) {
    const key = `${member.factKey} ${member.unit ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(member)
  }
  return [...groups.entries()].map(([key, groupMembers]) => {
    const [factKey, unit] = key.split(' ')
    const distinctValues = new Set(groupMembers.map((m) => m.valueSignature))
    return { factKey, unit: unit || null, members: groupMembers, hasConflict: distinctValues.size > 1 }
  })
}

/**
 * Content fingerprint used for the write-time dedup/conflict key
 * (`client_knowledge_facts.value_fingerprint`) — deliberately NOT
 * `fingerprint.ts#computeContentFingerprint` (that one folds in
 * `validUntil`, which this module computes fresh as `now() + 90d` on every
 * insert — reusing it would make the same value get a different fingerprint
 * on every re-mining run and defeat both the identity uniqueness index and
 * incremental idempotency).
 */
export function computeCandidateFingerprint(statement: string, structuredValue: unknown): string {
  return JSON.stringify({ statement, value: computeValueSignature(structuredValue) })
}

// ── LLM extraction ───────────────────────────────────────────────────────

export interface ExtractedCandidate {
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: (Record<string, unknown> & { unit?: string }) | null
  isDealSpecific: boolean | null
}

// Sonnet pricing, kept in sync manually with anthropic/client.ts (private to
// that module, not exported). Used only for the pre-call worst-case budget
// estimate below, never for the actual receipted cost (that always comes
// from callClaudeChat's real usage).
const SONNET_PRICE_INPUT_PER_M_USD = 3.0
const SONNET_PRICE_OUTPUT_PER_M_USD = 15.0
export const EXTRACTION_MAX_OUTPUT_TOKENS = 800

/**
 * Conservative worst-case cost of ONE extraction call, computed from the
 * prompt text BEFORE calling the model — never from what the call actually
 * cost (§9.14-B: "每次调模型前按最坏情况预估判上限，不是调完再算"; a
 * check made after the money is already spent cannot prevent overspend, it
 * can only report it). ~4 chars/token is a standard rough estimate; +200
 * tokens of headroom for the fixed system prompt.
 */
export function estimateWorstCaseExtractionCostUsd(promptText: string): number {
  const estimatedInputTokens = Math.ceil(promptText.length / 4) + 200
  return (
    (estimatedInputTokens / 1_000_000) * SONNET_PRICE_INPUT_PER_M_USD +
    (EXTRACTION_MAX_OUTPUT_TOKENS / 1_000_000) * SONNET_PRICE_OUTPUT_PER_M_USD
  )
}

const EXTRACTION_SYSTEM_PROMPT = `You extract reusable business facts an AI assistant could later say to a customer, from ONE employee reply template a business sent to real customers.

Only extract facts that are GENERALLY TRUE for this business (pricing rules, service fees, cutoff times, policies) — never a specific customer's individual quote (a computed total for one shipment, one person's exact route/weight). If the message is a one-off calculation for a specific customer, set "is_deal_specific": true and return no facts.

Every number you put in a fact (in "statement" or "structured_value") MUST appear verbatim in the source message. Never compute, round, or infer a number that is not literally written there.

Respond with ONLY a JSON object, no prose, shaped exactly like:
{
  "is_deal_specific": boolean,
  "facts": [
    {
      "fact_key": "short.stable.identifier",
      "scope": { "...": "..." },
      "statement": "human-readable sentence, in the same language as the source",
      "structured_value": { "unit": "NZD/kg", "...": "..." } | null
    }
  ]
}
If is_deal_specific is true, "facts" must be an empty array.`

export interface RawExtractionCall {
  candidates: ExtractedCandidate[]
  isDealSpecific: boolean | null
  costUsd: number
}

function parseExtractionResponse(raw: string): { isDealSpecific: boolean | null; facts: unknown[] } {
  const repaired = jsonrepair(raw.trim())
  const parsed = JSON.parse(repaired) as { is_deal_specific?: unknown; facts?: unknown }
  const facts = Array.isArray(parsed.facts) ? parsed.facts : []
  const isDealSpecific = typeof parsed.is_deal_specific === 'boolean' ? parsed.is_deal_specific : null
  return { isDealSpecific, facts }
}

function toExtractedCandidate(raw: unknown, isDealSpecific: boolean | null): ExtractedCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.fact_key !== 'string' || typeof r.statement !== 'string') return null
  return {
    factKey: r.fact_key,
    scope: r.scope && typeof r.scope === 'object' ? (r.scope as Record<string, unknown>) : {},
    statement: r.statement,
    structuredValue:
      r.structured_value && typeof r.structured_value === 'object'
        ? (r.structured_value as Record<string, unknown>)
        : null,
    isDealSpecific,
  }
}

/**
 * One LLM call per template. Industry-neutral prompt (per design §9.14-A —
 * no travel/logistics-specific vocabulary lives here; an industry hint would
 * be injected as a separate L2 layer, not built into this function).
 */
export async function extractCandidatesFromTemplate(
  templateBody: string,
  precedingCustomerQuestion: string | null,
): Promise<RawExtractionCall> {
  const redactedTemplate = redactPersonalInfo(templateBody).text
  const redactedQuestion = precedingCustomerQuestion ? redactPersonalInfo(precedingCustomerQuestion).text : null

  const userPrompt = redactedQuestion
    ? `Customer asked (for context only, do not extract facts from this line):\n${redactedQuestion}\n\nEmployee replied (extract from THIS message):\n${redactedTemplate}`
    : `Employee message (extract from this):\n${redactedTemplate}`

  const result = await callClaudeChat({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
  })

  const parsed = parseExtractionResponse(result.text)
  const candidates = parsed.facts
    .map((f) => toExtractedCandidate(f, parsed.isDealSpecific))
    .filter((c): c is ExtractedCandidate => c !== null)

  return { candidates, isDealSpecific: parsed.isDealSpecific, costUsd: result.cost_usd }
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface MiningRunReceipt {
  runId: string
  status: 'succeeded' | 'failed'
  conversationsScanned: number
  messagesScanned: number
  templatesMerged: number
  candidatesWritten: number
  conflictGroups: number
  dealSpecificSkipped: number
  provenanceRejected: number
  modelCallsUsed: number
  costUsd: number
  error?: string
}

interface ConversationRow {
  id: string
}
interface MessageRow {
  conversation_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}
interface PriorRunRow {
  high_watermark_at: string | null
}

interface ExistingCandidateRow {
  id: string
  fact_key: string
  structured_value: unknown
  conflict_group_id: string | null
}

/** Every not-yet-reviewed candidate for this client — needed so a new conflict can be linked to one already sitting in the table from a prior run (see ConflictMember.origin docs). */
async function fetchExistingCandidateFacts(clientId: string): Promise<ExistingCandidateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('client_knowledge_facts')
    .select('id, fact_key, structured_value, conflict_group_id')
    .eq('client_id', clientId)
    .eq('status', 'candidate')
  if (error) throw new Error(`fetchExistingCandidateFacts: read failed for client ${clientId}: ${error.message}`)
  return asRows<ExistingCandidateRow>(data)
}

/**
 * Create a fresh `client_knowledge_mining_runs` row, or — when `reclaimId`
 * is set — UPDATE that existing row in place instead. Reclaiming (rather
 * than inserting) is what lets a retry recover a row left stuck in
 * `running`/`queued` by a crashed prior attempt: the table's
 * `request_id` unique constraint means a second INSERT for the same
 * request_id would always fail, so the only way to actually retry is to
 * reuse the existing row's id.
 */
export async function upsertRunRow(reclaimId: string | null, fields: Record<string, unknown>): Promise<string | null> {
  if (reclaimId) {
    const { error } = await supabaseAdmin.from('client_knowledge_mining_runs').update(fields).eq('id', reclaimId)
    if (error) throw new Error(`upsertRunRow: reclaim update failed for run ${reclaimId}: ${error.message}`)
    return reclaimId
  }
  const { data, error } = await supabaseAdmin.from('client_knowledge_mining_runs').insert(fields).select('id').single()
  if (error) throw new Error(`upsertRunRow: insert failed: ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}

async function fetchWatermark(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('client_knowledge_mining_runs')
    .select('high_watermark_at')
    .eq('client_id', clientId)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`fetchWatermark: read failed for client ${clientId}: ${error.message}`)
  return asRows<PriorRunRow>(data)[0]?.high_watermark_at ?? null
}

export async function fetchConversationIds(clientId: string): Promise<string[]> {
  const ids: string[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchConversationIds: read failed for client ${clientId}: ${error.message}`)
    const rows = asRows<ConversationRow>(data)
    ids.push(...rows.map((r) => r.id))
    if (rows.length < pageSize) break
  }
  return ids
}

// 🔴 2026-09-15，issue #1760 首次真拿 CTS 真实数据（722 段对话）跑
// `runStylePatternMining` 时实测撞到的真问题：`.in('conversation_id', ...)`
// 把全部 conversationId 一次性塞进一个请求，722 个 UUID 拼出的 querystring
// 超过了 PostgREST/反代的请求体积上限，直接 400 Bad Request——不是这次新写的
// `style-mining.ts` 的 bug，是 `fetchMessagesSince` 这个 `mining.ts` 原有的
// 共享读取函数从来没在这个规模的真实客户上跑过；`runKnowledgeMining`（issue
// #1645 的事实萃取，已上线）用的是同一个函数，同样会在 CTS 这个规模上炸。
// 按 conversationId 分批查询修复，两个调用方都受益，不是本次顺手夹带的额外
// 范围。
//
// 200 是经验安全值（UUID 36 字符 + 逗号分隔，200 个约 7.4KB），不是从
// PostgREST/反代实际请求体积上限精确算出来的——留了余量，不是精确边界。
const CONVERSATION_ID_CHUNK_SIZE = 200

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

/** Reads up to `maxMessages` messages (both directions, for pairing) since `sinceIso`, paginated past PostgREST's default row cap AND chunked past its request-size cap on the `.in()` filter. */
export async function fetchMessagesSince(
  conversationIds: string[],
  sinceIso: string | null,
  maxMessages: number,
): Promise<RawMessage[]> {
  if (conversationIds.length === 0) return []
  const collected: RawMessage[] = []
  const pageSize = 1000
  for (const idChunk of chunkArray(conversationIds, CONVERSATION_ID_CHUNK_SIZE)) {
    // 🔴 子牙复审 BLOCKER（2026-09-15）：分块之前，外层 `for` 循环本身就是
    // "collected.length < maxMessages 才继续翻页"——一读够就整体停手。分块
    // 拆开之后如果把这道提前止损也一起丢了，变成"每个分块都无条件读到底"，
    // 一个历史消息量远超 maxMessages 的大客户（这次 CTS 722 段/3600 条还看
    // 不出来，但这个函数是已上线的 runKnowledgeMining 共用的核心读取路径，
    // 客户体量会持续涨）会被打成读全量——不是等价重构，是真实的性能/成本
    // 倒退。每个分块各自也遵守同一个 maxMessages 上限，把止损条件下推进
    // 分块内层循环，而不是彻底删掉。
    //
    // 这不是精确的"全局最早 N 条"——分块之间按 conversationId 分组，彼此没有
    // 时间序关系，最坏情况下总读取量是 `分块数 × maxMessages`，不是精确的
    // `maxMessages`。跟"读全部历史"比仍然是数量级的改善，跟真正的跨分块
    // 归并排序比是复杂度换正确性精度的权衡——对 CTS 这次 4 个分块的规模，
    // 最坏也只是读 4 倍上限，可接受；如果客户体量涨到分块数很多的地步，这个
    // 权衡需要重新评估（做成真正的多路归并），不是这次的范围。
    let chunkCollected = 0
    for (let offset = 0; chunkCollected < maxMessages; offset += pageSize) {
      let query = supabaseAdmin
        .from('conversation_messages')
        .select('conversation_id, direction, body, sent_at')
        .in('conversation_id', idChunk)
        .order('sent_at', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (sinceIso) query = query.gt('sent_at', sinceIso)
      const { data, error } = await query
      if (error) throw new Error(`fetchMessagesSince: read failed: ${error.message}`)
      const rows = asRows<MessageRow>(data)
      for (const row of rows) {
        if (!row.body) continue
        collected.push({
          body: row.body,
          sentAt: row.sent_at,
          direction: row.direction,
          conversationId: row.conversation_id,
        })
        chunkCollected += 1
      }
      if (rows.length < pageSize) break
    }
  }
  // 分批查询丢掉了"单次查询天然按 sent_at 全局有序"这件事——`runKnowledgeMining`
  // 拿 `messages[messages.length-1].sentAt` 当下一轮增量水位，必须是真正全局
  // 最新的一条，不能只是"恰好最后处理的那个分片里最新的一条"，所以这里在
  // 截断到 `maxMessages` 之前先补一次全局排序。
  collected.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0))
  return collected.slice(0, maxMessages)
}

// §9.6's stated default recheck period for price facts. Not DB-enforced for
// 'general' sensitivity facts (client_knowledge_facts has no CHECK requiring
// valid_until — only this write path's own convention), but every mined
// candidate gets one regardless of sensitivity, matching the design intent
// that nothing sits un-reviewed indefinitely.
export const DEFAULT_CANDIDATE_VALID_DAYS = 90

export interface NewFactRow {
  client_id: string
  fact_key: string
  scope: Record<string, unknown>
  statement: string
  structured_value: unknown
  status: 'candidate'
  visibility: 'internal_only'
  sensitivity: Sensitivity
  valid_until: string
  // `client_knowledge_facts.source_kind` has no CHECK enum on purpose (see
  // its column comment) — `'conversation_mining_style'` (issue #1760) is a
  // second, real value it accepts, not a typo of `'conversation_mining'`.
  source_kind: 'conversation_mining' | 'conversation_mining_style'
  evidence: Record<string, unknown>
  conflict_group_id: string | null
  value_fingerprint: string
}

interface SurvivingCandidate {
  candidate: ExtractedCandidate
  template: MessageTemplate
  unit: string | null
}

/**
 * Run one client's mining pass end to end. Throws only on a setup failure
 * (bad budget, can't read messages at all, MTC headroom check itself
 * erroring); a failure partway through is recorded on the run row and
 * reflected in the returned receipt's `status` rather than thrown, so a
 * partial candidate set already written is not lost.
 *
 * `visibility` is deliberately the conservative placeholder `internal_only`
 * — a later step (FDE review, issue #1646) is what actually classifies
 * visibility (e.g. promotes a fact to `customer_ok`). `sensitivity` is
 * classified for real via `detectSensitivity()` (issue #1643/#1650) — NOT a
 * placeholder — because the dual-sign gate in `read.ts` keys its behaviour
 * on this value the moment a candidate is later approved. Nothing written
 * by this function is ever `status='approved'`.
 *
 * Spend governance is entirely the three per-run hard caps in `budget`
 * (enforced via `assertMiningBudget` and the `client_knowledge_mining_runs`
 * schema's own CHECK constraints) — see the file header for why this
 * deliberately does not also consult `@/lib/mtc/budget-guard`.
 */
export async function runKnowledgeMining(
  clientId: string,
  budget: MiningBudget,
  requestId: string = randomUUID(),
): Promise<MiningRunReceipt> {
  assertMiningBudget(budget)

  // 🔴 Idempotency at the request_id layer: `client_knowledge_mining_runs`
  // requires request_id to be unique. Inngest's own `idempotency` config
  // stops the SAME event from starting a fresh execution, but a step retry
  // WITHIN one execution (the whole point of `retries: 2` on the Inngest
  // function — recovering from a transient crash) would otherwise hit that
  // unique constraint the moment it tries to insert a second `running` row
  // for the same request_id.
  //
  // 🔴 子牙+魏征联合复审（2026-09-14）实测发现的真问题，已修：早期版本在
  // 找到一条既有记录时，无论它是终态（succeeded/failed）还是"卡在
  // running"，一律直接拼一个 receipt 返回，从不写回数据库。如果进程恰好
  // 崩溃在"插入 running 行"和"标成 succeeded/failed"之间（现实中最常见
  // 的崩溃时机——OOM/超时/网络分区），这一行会永远卡在 running、error 永
  // 远是 NULL，而 Inngest 的 retries:2 配置对这种情况完全不起作用：重试
  // 命中的是这段短路逻辑，只会拼一个"failed 但没有 error 文案"的假回执
  // 给调用方，数据库里那行本身从未被更新，retries 形同虚设。
  //
  // 现在的处理：终态记录直接返回（真正的幂等短路，不重跑，不重复扣费）；
  // 非终态（running/queued）记录视为"上一次执行崩溃留下的残留"，复用同一
  // 行的 id 重新走一遍完整流程（下面创建/复用 running 行那一步用 UPDATE
  // 而不是 INSERT），让 retries:2 真正发挥作用，而不是被这层短路吃掉。
  const existing = await supabaseAdmin
    .from('client_knowledge_mining_runs')
    .select(
      'id, status, error, conversations_scanned, messages_scanned, candidates_found, conflict_groups_found, llm_cost_usd',
    )
    .eq('request_id', requestId)
    .maybeSingle()
  if (existing.error) throw new Error(`runKnowledgeMining: idempotency check failed: ${existing.error.message}`)

  let reclaimedRunId: string | null = null
  if (existing.data) {
    const row = existing.data as {
      id: string
      status: 'queued' | 'running' | 'succeeded' | 'failed'
      error: string | null
      conversations_scanned: number
      messages_scanned: number
      candidates_found: number
      conflict_groups_found: number
      llm_cost_usd: number | null
    }
    if (row.status === 'succeeded' || row.status === 'failed') {
      return {
        runId: row.id,
        status: row.status,
        conversationsScanned: row.conversations_scanned,
        messagesScanned: row.messages_scanned,
        templatesMerged: 0,
        candidatesWritten: row.candidates_found,
        conflictGroups: row.conflict_groups_found,
        dealSpecificSkipped: 0,
        provenanceRejected: 0,
        modelCallsUsed: 0,
        costUsd: row.llm_cost_usd ?? 0,
        ...(row.error ? { error: row.error } : {}),
      }
    }
    // Non-terminal: reclaim this row's id and actually retry below, instead
    // of reporting a fabricated failure and leaving the row stuck forever.
    reclaimedRunId = row.id
  }

  let watermark: string | null
  let conversationIds: string[]
  let messages: RawMessage[]
  let templates: MessageTemplate[]
  try {
    watermark = await fetchWatermark(clientId)
    conversationIds = await fetchConversationIds(clientId)
    messages = await fetchMessagesSince(conversationIds, watermark, budget.maxMessages)
    templates = groupMessagesIntoTemplates(messages)
  } catch (error) {
    // A failure here must still leave a machine-readable receipt — an
    // operator must never have to go spelunking through Inngest's own
    // execution log to find out mining silently never ran for a client.
    const message = error instanceof Error ? error.message : String(error)
    const failedRunId = await upsertRunRow(reclaimedRunId, {
      request_id: requestId,
      client_id: clientId,
      status: 'failed',
      error: message,
      max_messages_cap: budget.maxMessages,
      max_model_calls_cap: budget.maxModelCalls,
      max_spend_usd_cap: budget.maxSpendUsd,
      finished_at: new Date().toISOString(),
    })
    return {
      runId: failedRunId ?? '',
      status: 'failed',
      conversationsScanned: 0,
      messagesScanned: 0,
      templatesMerged: 0,
      candidatesWritten: 0,
      conflictGroups: 0,
      dealSpecificSkipped: 0,
      provenanceRejected: 0,
      modelCallsUsed: 0,
      costUsd: 0,
      error: message,
    }
  }

  const runId = await upsertRunRow(reclaimedRunId, {
    request_id: requestId,
    client_id: clientId,
    status: 'running',
    max_messages_cap: budget.maxMessages,
    max_model_calls_cap: budget.maxModelCalls,
    max_spend_usd_cap: budget.maxSpendUsd,
    low_watermark_at: watermark,
    conversations_scanned: conversationIds.length,
    messages_scanned: messages.length,
    started_at: new Date().toISOString(),
    // Reclaiming a stale row: clear whatever partial counters/error a
    // crashed prior attempt may have left, so this fresh attempt's own
    // numbers aren't polluted by leftovers.
    ...(reclaimedRunId ? { error: null, candidates_found: 0, conflict_groups_found: 0, llm_cost_usd: null } : {}),
  })
  if (!runId) {
    throw new Error('runKnowledgeMining: could not create or reclaim run row')
  }

  let modelCallsUsed = 0
  let costUsd = 0
  let dealSpecificSkipped = 0
  let provenanceRejected = 0
  const survivingCandidates: SurvivingCandidate[] = []
  let runError: string | undefined

  try {
    // 🔴 子牙复审（2026-09-14）实测发现：entitlement 检查（藏在
    // getClientKnowledge 内部）原来排在整个抽取循环之后——一个没有知识库
    // 授权的客户，代码会先跑完整个抽取循环（真调用 Anthropic API、真花
    // 钱），最后才在这里报错，等于白花钱白算。跟本文件反复强调的"花钱前
    // 先判上限"原则矛盾：应该先判"这个客户到底有没有资格用这个功能"，
    // 再花钱，不是跑完才发现白跑。挪到循环最前面，未授权客户在第一次
    // 模型调用之前就失败。
    const knowledgeRead = await getClientKnowledge(clientId, { purpose: 'internal_brief' })

    for (const template of templates) {
      if (modelCallsUsed >= budget.maxModelCalls) break

      const promptText = `${template.sampleBody} ${template.precedingCustomerQuestion ?? ''}`
      const estimatedCost = estimateWorstCaseExtractionCostUsd(promptText)
      if (costUsd + estimatedCost > budget.maxSpendUsd) break

      const extraction = await extractCandidatesFromTemplate(template.sampleBody, template.precedingCustomerQuestion)
      modelCallsUsed += 1
      costUsd += extraction.costUsd

      for (const candidate of extraction.candidates) {
        // A candidate whose numbers happen to match the CUSTOMER's own
        // question (they quoted their own weight/value) is suspicious even
        // when the model didn't flag it — the reply may just be echoing
        // that customer's specific figures back, not stating a house rate.
        const numbersMatchCustomerQuestion =
          template.precedingCustomerQuestion !== null &&
          validateNumberProvenance(candidate.statement, candidate.structuredValue, template.precedingCustomerQuestion)

        const specificity = classifyCandidateSpecificity({
          occurrenceCount: template.distinctConversationCount,
          modelSaysDealSpecific: candidate.isDealSpecific,
          numbersMatchCustomerQuestion,
        })
        if (specificity === 'deal_specific') {
          dealSpecificSkipped += 1
          continue
        }
        if (!validateNumberProvenance(candidate.statement, candidate.structuredValue, template.sampleBody)) {
          provenanceRejected += 1
          continue
        }
        survivingCandidates.push({
          candidate,
          template,
          unit: typeof candidate.structuredValue?.unit === 'string' ? candidate.structuredValue.unit : null,
        })
      }
    }

    const approvedMembers: ConflictMember[] = knowledgeRead.entries.map((fact) => {
      const structured = fact.structuredValue as Record<string, unknown> | null
      return {
        origin: 'approved',
        refId: fact.id,
        factKey: fact.factKey,
        unit: typeof structured?.unit === 'string' ? structured.unit : null,
        valueSignature: computeValueSignature(fact.structuredValue),
        existingConflictGroupId: fact.conflictGroupId,
      }
    })
    const candidateMembers: ConflictMember[] = survivingCandidates.map((entry, index) => ({
      origin: 'candidate',
      refId: String(index),
      factKey: entry.candidate.factKey,
      unit: entry.unit,
      valueSignature: computeValueSignature(entry.candidate.structuredValue),
    }))

    // A conflict must be linked to one already sitting in the table from a
    // PRIOR, still-unreviewed mining run — not just to already-approved
    // facts — or the same real disagreement fragments into a fresh,
    // disconnected conflict_group_id every run.
    const existingCandidateFacts = await fetchExistingCandidateFacts(clientId)
    const existingCandidateMembers: ConflictMember[] = existingCandidateFacts.map((fact) => {
      const structured = fact.structured_value as Record<string, unknown> | null
      return {
        origin: 'existing_candidate',
        refId: fact.id,
        factKey: fact.fact_key,
        unit: typeof structured?.unit === 'string' ? structured.unit : null,
        valueSignature: computeValueSignature(fact.structured_value),
        existingConflictGroupId: fact.conflict_group_id,
      }
    })

    const conflictGroups = groupCandidatesByConflict([
      ...approvedMembers,
      ...existingCandidateMembers,
      ...candidateMembers,
    ]).filter((g) => g.hasConflict)

    const conflictGroupIdByCandidateIndex = new Map<number, string>()
    // Rows already sitting in client_knowledge_facts (both 'approved' and
    // 'existing_candidate' origins — anything already in the table) that
    // this run's conflicts touch but that don't yet carry the resolved
    // conflict_group_id — a group formed for the first time around an old
    // row (whether it's a still-unreviewed candidate OR an approved fact
    // that a new candidate now contradicts) needs to retroactively tag it
    // too, or the review page still can't show them together.
    const factIdsToBackfill = new Map<string, string>() // existing row id -> group id

    for (const group of conflictGroups) {
      // Reuse a group id already present among this group's existing rows
      // (approved or unreviewed-candidate, from a prior run) instead of
      // minting a new one — that's what actually keeps the same
      // disagreement in one place across runs. If members disagree on which
      // existing group id to reuse, deterministically pick the smallest one
      // rather than silently picking whichever the Set/Map iteration
      // happened to hit first.
      const existingGroupIds = group.members
        .filter((m) => (m.origin === 'existing_candidate' || m.origin === 'approved') && m.existingConflictGroupId)
        .map((m) => m.existingConflictGroupId as string)
      const groupId = existingGroupIds.length > 0 ? [...existingGroupIds].sort()[0] : randomUUID()

      for (const member of group.members) {
        if (member.origin === 'candidate') {
          conflictGroupIdByCandidateIndex.set(Number(member.refId), groupId)
        } else if (
          (member.origin === 'existing_candidate' || member.origin === 'approved') &&
          member.existingConflictGroupId !== groupId
        ) {
          factIdsToBackfill.set(member.refId, groupId)
        }
      }
    }

    if (factIdsToBackfill.size > 0) {
      for (const [factId, groupId] of factIdsToBackfill) {
        const { error: backfillError } = await supabaseAdmin
          .from('client_knowledge_facts')
          .update({ conflict_group_id: groupId })
          .eq('id', factId)
        if (backfillError) {
          throw new Error(`conflict_group_id backfill failed for fact ${factId}: ${backfillError.message}`)
        }
      }
    }

    const rows: NewFactRow[] = survivingCandidates.map((entry, index) => ({
      client_id: clientId,
      fact_key: entry.candidate.factKey,
      scope: entry.candidate.scope,
      statement: entry.candidate.statement,
      structured_value: entry.candidate.structuredValue,
      status: 'candidate',
      visibility: 'internal_only',
      sensitivity: detectSensitivity(entry.candidate.statement, entry.candidate.structuredValue),
      valid_until: new Date(Date.now() + DEFAULT_CANDIDATE_VALID_DAYS * 86_400_000).toISOString(),
      source_kind: 'conversation_mining',
      evidence: {
        occurrence_count: entry.template.count,
        distinct_conversation_count: entry.template.distinctConversationCount,
        first_seen_at: entry.template.firstSeenAt,
        last_seen_at: entry.template.lastSeenAt,
      },
      conflict_group_id: conflictGroupIdByCandidateIndex.get(index) ?? null,
      value_fingerprint: computeCandidateFingerprint(entry.candidate.statement, entry.candidate.structuredValue),
    }))

    let candidatesWritten = 0
    if (rows.length > 0) {
      // 🔴 This target MUST include value_fingerprint. Conflicting only on
      // (client_id,fact_key,scope) — the row's IDENTITY, which an
      // already-approved fact also occupies — would silently drop a
      // candidate proposing a genuinely different value for that identity
      // via ON CONFLICT DO NOTHING. Including value_fingerprint makes the
      // conflict target "this exact proposed content", so only a
      // byte-for-byte identical re-mining result gets deduplicated — a
      // differing value always becomes its own row for a human to see. See
      // migration 20260914000001's uq_client_knowledge_facts_identity
      // comment for why this is a plain (not partial) index — PostgREST's
      // upsert cannot target a partial index's WHERE predicate.
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('client_knowledge_facts')
        .upsert(rows, { onConflict: 'client_id,fact_key,scope,value_fingerprint', ignoreDuplicates: true })
        .select('id')
      if (insertError) throw new Error(`candidate write failed: ${insertError.message}`)
      candidatesWritten = asRows<{ id: string }>(inserted).length
    }

    const highWatermark = messages.length > 0 ? messages[messages.length - 1].sentAt : watermark

    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({
        status: 'succeeded',
        high_watermark_at: highWatermark,
        candidates_found: candidatesWritten,
        conflict_groups_found: conflictGroups.length,
        llm_cost_usd: costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return {
      runId,
      status: 'succeeded',
      conversationsScanned: conversationIds.length,
      messagesScanned: messages.length,
      templatesMerged: templates.length,
      candidatesWritten,
      conflictGroups: conflictGroups.length,
      dealSpecificSkipped,
      provenanceRejected,
      modelCallsUsed,
      costUsd,
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({
        status: 'failed',
        error: runError,
        llm_cost_usd: costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return {
      runId,
      status: 'failed',
      conversationsScanned: conversationIds.length,
      messagesScanned: messages.length,
      templatesMerged: templates.length,
      candidatesWritten: 0,
      conflictGroups: 0,
      dealSpecificSkipped,
      provenanceRejected,
      modelCallsUsed,
      costUsd,
      error: runError,
    }
  }
}
