/**
 * Customer brief generation — turns a stored Messenger thread into the card a
 * client's salesperson reads (see brief-schema.ts).
 *
 * Trigger rules live here rather than in the cron route so they can be tested
 * without HTTP. A brief is (re)written only when ALL of these hold:
 *   1. the thread has at least one message
 *   2. nobody has spoken for QUIET_PERIOD_MS — summarise a finished exchange,
 *      not a half-typed one
 *   3. there is no brief yet, or the thread has grown since the last one
 *   4. the thread has not already been rewritten MAX_REGENS_PER_DAY times today
 *
 * Rule 4 is the one that matters commercially: without it a fast back-and-forth
 * re-summarises on every single message.
 *
 * 🔴 2026-09-13 事故：这个文件曾经把系统提示词写死成"你是 CTS Tours New Zealand"，
 *    且调用链没有传 clientId —— 结果每一个客户（不只 CTS）生成的摘要都在冒充 CTS 身份，
 *    还给物流客户 New Asian Logistics 编出"客户想了解中国旅游"这种不存在的需求。
 *    修复：generateBrief 现在强制要求 clientId，身份从 `clients.name` 动态读取
 *    （见 loadClientIdentity），trip（旅游行程专属字段）只对 `industry === 'travel'`
 *    的客户开放、其余客户在代码层强制清空，且明显是垃圾/钓鱼消息的对话直接短路成
 *    noiseBrief，不再进模型编需求。
 *
 * 🔴 issue #1647（2026-09-15）：那次修复把身份改对了，但 CTS 自己的具体商业事实
 *    （25 年历史、免签政策、支持电话/邮箱）当时只是从"写死在系统提示词里"挪到了
 *    "写死在 brief-client-facts.ts 的一张表里"——同一条红线 2 违规换了个文件，
 *    并没有真正解决。这次改成从客户知识库（`getClientKnowledge`）读取，
 *    brief-client-facts.ts 已删除。见 loadClientFacts() 和 clientFactsBlock()。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { askJson, listConfiguredProviders, type AskJsonDeps } from '@/lib/ai/failover'
import {
  MessengerBriefSchema,
  MessengerBriefStrictSchema,
  MESSENGER_BRIEF_JSON_SCHEMA,
  BRIEF_SCHEMA_VERSION,
  type MessengerBrief,
  type BriefContext,
  type BriefChannel,
  type TripDetails,
} from './brief-schema'

// 渠道类型定义在 brief-schema（放这里会跟它成环），但调用方习惯从 brief 引，所以再导出一次。
export type { BriefChannel }

import { hasIndustryFeature } from '@/lib/clients/industry-features'
import { getClientKnowledge, type GetClientKnowledgeDeps } from '@/lib/knowledge/read'
import { KnowledgeNotEntitledError } from '@/lib/knowledge/errors'
import type { KnowledgeEntry } from '@/lib/knowledge/types'

/**
 * 每条渠道怎么称呼、回信要带什么。英文是给模型看的，所以这里不翻译。
 *
 * `replyNote` 对私信**刻意留空**：私信这条路已经上线并在给 525 段对话写卡，
 * 这次只加邮件，不顺手改它的提示词 —— 换了提示词就等于换了一条在跑的链路。
 */
const CHANNEL_WORDS: Record<
  BriefChannel,
  { article: string; thread: string; replyNote: (business: string) => string }
> = {
  messenger: {
    article: 'a',
    thread: 'Facebook Messenger thread',
    replyNote: () => '',
  },
  email: {
    article: 'an',
    thread: 'email thread',
    replyNote: (business) =>
      `- It is an email, not a chat message: open with the customer's first name and sign off as ${business}. Never write a subject line.`,
  },
}

/** Wait this long after the last message before summarising. */
export const QUIET_PERIOD_MS = 30 * 60 * 1000

/** Hard ceiling on rewrites per thread per day. */
export const MAX_REGENS_PER_DAY = 3

/**
 * The three outcomes of reading this client's knowledge for this brief.
 * `read_failed` is the one that matters to the caller: it means
 * `draft_reply` came back empty and this thread must be retried on the next
 * cycle even if no new customer message arrived (see `shouldGenerateBrief`
 * and `existingKnowledgeStatus` below).
 */
export type KnowledgeStatus = 'ok' | 'no_approved_facts' | 'read_failed'

export interface BriefCandidate {
  conversationId: string
  clientId: string
  messageCount: number
  lastMessageAt: string | null
  existingBriefMessageCount: number | null
  regenCount: number
  regenCountDate: string | null
  /** `conversation_briefs.knowledge_status` from the last stored brief, if any. */
  existingKnowledgeStatus?: 'read_failed' | null
}

export interface StoredMessage {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string
  sentAt: string
  /** 邮件渠道靠它去拉全文（库里只存了 255 字摘要）。私信不需要，留空。 */
  messageId?: string | null
}

/**
 * Should this thread get a (re)written brief right now?
 * Pure function — `now` is injected so the quiet period is testable.
 */
export function shouldGenerateBrief(c: BriefCandidate, now: Date): boolean {
  if (c.messageCount <= 0 || !c.lastMessageAt) return false

  const quiet = now.getTime() - new Date(c.lastMessageAt).getTime() >= QUIET_PERIOD_MS
  if (!quiet) return false

  // Nothing new to say since the last brief — UNLESS that last brief failed
  // to read the knowledge base (issue #1647): `draft_reply` came back empty
  // and this thread must be retried even though no new customer message
  // arrived. Without this carve-out a read-failed brief with a quiet thread
  // would never be picked up again.
  if (
    c.existingBriefMessageCount !== null &&
    c.existingBriefMessageCount >= c.messageCount &&
    c.existingKnowledgeStatus !== 'read_failed'
  ) {
    return false
  }

  const today = now.toISOString().slice(0, 10)
  const countedToday = c.regenCountDate === today ? c.regenCount : 0
  return countedToday < MAX_REGENS_PER_DAY
}

function modelName(): string {
  return process.env.MESSENGER_BRIEF_MODEL ?? 'gpt-4o-mini'
}

/** What the model is told about the business it is summarising for. Never a hardcoded client. */
export interface ClientIdentity {
  name: string
  /** From `clients.industry` (see src/lib/clients/industries.ts). Null when unset. */
  industry: string | null
  /** From `clients.country` (ISO-2, e.g. 'NZ'). Null when unset — then no currency rule is stated. */
  country?: string | null
}

/** Home currency for the markets this product serves. Unknown country → null (no rule, no guess). */
const COUNTRY_CURRENCY: Record<string, { code: string; name: string }> = {
  NZ: { code: 'NZD', name: 'New Zealand dollars' },
  AU: { code: 'AUD', name: 'Australian dollars' },
}

export function currencyRuleFor(country: string | null | undefined): string {
  const c = country ? COUNTRY_CURRENCY[country.trim().toUpperCase()] : undefined
  if (!c) return ''
  return `CURRENCY — this business trades in ${c.name} (${c.code}). An amount in the thread with no explicit currency is ${c.code}: write it as "${c.code} 4,275" in the Chinese fields. NEVER write "美元" or "USD" unless the thread explicitly says US dollars; if the thread names another currency, keep that one.\n`
}

/**
 * Reuses the same industry-keyword matcher the admin UI already uses to
 * decide whether a client sees travel-only features (`src/lib/clients/industry-features.ts`).
 * `clients.industry` has free-text history ("Travel — Tour Operator", not
 * just "travel") — matching only the exact string "travel" would silently
 * repeat this incident's shape for any client whose industry wasn't typed
 * in the canonical form (confirmed against production: at least one travel
 * client is stored as free text, not the canonical 'travel' value).
 */
function isTravelIndustry(identity: ClientIdentity): boolean {
  return hasIndustryFeature(identity.industry, 'tailor_made')
}

/**
 * Read who we are summarising for straight from `clients` — never assume it.
 *
 * A real read failure (network blip, connection reset) THROWS rather than
 * degrading to a neutral identity: `generateDueBriefs` already catches
 * per-conversation failures and counts them as `failed` (brief-cycle.ts) —
 * this conversation simply has no brief written this run and is picked up
 * again on a later run (it still qualifies under `shouldGenerateBrief`),
 * rather than a transient error silently producing a wrong identity right
 * now. Only a genuinely missing row (queried fine, no such client) falls
 * back to a neutral name — it must NEVER fall back to another client's name.
 */
export async function loadClientIdentity(clientId: string): Promise<ClientIdentity> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('name, industry, country')
    .eq('id', clientId)
    .maybeSingle()

  if (error) throw new Error(`clients lookup failed for ${clientId}: ${error.message}`)

  const row = data as { name?: string | null; industry?: string | null; country?: string | null } | null
  if (!row?.name) return { name: 'this business', industry: null }
  return { name: row.name, industry: row.industry ?? null, country: row.country ?? null }
}

/**
 * Some knowledge entries are a correction rather than a fact to assert —
 * `structuredValue: { wrong, insteadSay }` (see the migration for issue
 * #1647's CTS `company.founding_year_correction` row). Any client's mining
 * pipeline or manual entry can use this shape; it is a rendering convention,
 * not something specific to one client.
 */
function isNeverClaimShaped(value: unknown): value is { wrong: string; insteadSay: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).wrong === 'string' &&
    typeof (value as Record<string, unknown>).insteadSay === 'string'
  )
}

/**
 * Renders the `customer_reply`-eligible knowledge entries `getClientKnowledge`
 * returned into the "extra facts draft_reply may state as true" block.
 * Contains NO hardcoded client name, industry, or business fact — every line
 * comes from `entries`, which is empty for any client with nothing approved
 * (or no entitlement grant at all; see `loadClientFacts`).
 */
export function clientFactsBlock(entries: readonly KnowledgeEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map((entry) =>
    isNeverClaimShaped(entry.structuredValue)
      ? `- Never write ${entry.structuredValue.wrong}. Instead: ${entry.structuredValue.insteadSay}`
      : `- ${entry.statement}`,
  )
  return `\nCLIENT FACTS — the only extra facts draft_reply may state as true (never state anything else as fact):\n${lines.join('\n')}\n`
}

/**
 * Read this client's `customer_reply`-eligible knowledge exactly once per
 * brief (design doc §9.14 B: "每轮每客户只读一次知识库"). Three outcomes:
 *
 *   - `'ok'`               — `entries` may be non-empty; render them.
 *   - `'no_approved_facts'`— nothing to say for this client: either the read
 *     genuinely returned zero entries, OR this client has no entitlement
 *     grant at all (`KnowledgeNotEntitledError`). Both are normal,
 *     unexceptional states for a brief — the card generates exactly as it
 *     did before the knowledge base existed. This is what makes brief.ts's
 *     de-CTS-ification NOT subject to the knowledge base's own admission
 *     gate (design doc §7.1's final sentence): a client without a grant
 *     simply gets no extra facts block, same as today.
 *   - `'read_failed'`      — a real DB/infra failure. The caller must blank
 *     `draft_reply` and mark this brief for retry (see `shouldGenerateBrief`
 *     / `storeBrief`'s `knowledge_status` column).
 */
export async function loadClientFacts(
  clientId: string,
  deps: GetClientKnowledgeDeps = {},
): Promise<{ status: KnowledgeStatus; entries: KnowledgeEntry[] }> {
  try {
    const result = await getClientKnowledge(clientId, { purpose: 'customer_reply' }, deps)
    return { status: result.entries.length > 0 ? 'ok' : 'no_approved_facts', entries: result.entries }
  } catch (err) {
    if (err instanceof KnowledgeNotEntitledError) return { status: 'no_approved_facts', entries: [] }
    return { status: 'read_failed', entries: [] }
  }
}

function tripInstructions(isTravel: boolean): string {
  if (isTravel) {
    return `NAMES — tour names stay in ENGLISH exactly as this business sells them ("Best of China", "A Tale of Two Cities"), even inside Chinese fields. Staff search on them and match them to the website; a translated name is unusable.

TRIP DETAILS — every field describes what the CUSTOMER told us, never what we offered or quoted (see ATTRIBUTION above). tour_interest may be filled from a tour the customer named or picked in a form, not from one we merely pitched.`
  }
  return `TRIP DETAILS — this business is not a travel agency. Every field under "trip" MUST be null. Do not infer, guess, or invent a travel interest, destination, or travel date for this business's customers.`
}

/**
 * Builds the system prompt for one client. Contains NO hardcoded client name,
 * industry, or business fact — identity comes from `identity`, and any extra
 * fact comes from `factEntries` (the `customer_reply`-eligible rows
 * `loadClientFacts`/`getClientKnowledge` returned for this client).
 */
export function buildSystemPrompt(
  identity: ClientIdentity,
  factEntries: readonly KnowledgeEntry[],
  channel: BriefChannel = 'messenger',
): string {
  const isTravel = isTravelIndustry(identity)
  const business = identity.name
  const words = CHANNEL_WORDS[channel]
  const replyNote = words.replyNote(business)
  const replyNoteLine = replyNote === '' ? '' : `\n${replyNote}`

  return `You turn ${words.article} ${words.thread} between ${business} and a prospective customer into a briefing card for a ${business} salesperson.

LANGUAGE — this is the most common mistake, get it right:
- summary, customer_needs, objections, promises_made, next_action, risk_flags: write in SIMPLIFIED CHINESE. Staff read these in a Chinese interface.
- draft_reply: write in ENGLISH. It is sent to the customer.
- When quoting the customer inside a Chinese field, keep their original English in brackets.
- Customer names are identity data: copy their spelling exactly as it appears in the source, even inside Chinese fields. Never translate or transliterate a name (for example, Jane Doe must stay Jane Doe). If the source name is uncertain, write 客户 without a name. Do not invent one.

ATTRIBUTION — the mistake that makes a card useless. Every field under "trip" and "contact" describes what the CUSTOMER told us. Anything the ${business} side said — a date we offered, a price we quoted, something we suggested — is OUR information, not theirs.
- If ${business} quoted a price and the customer said nothing about money, budget_signal is null. A quote is not a budget.
- If ${business} named a date and the customer never named one, travel_window is null. A date we offered is not their travel window.
- contact.phone / contact.email only from details the customer supplied (lead forms put them in the first message). Never ${business}'s own support number or email.

${tripInstructions(isTravel)}

${currencyRuleFor(identity.country)}
GROUNDING — only use what is in the thread:
- Never invent names, prices, dates, or other specific details that are not in the thread or in CLIENT FACTS below.
- If the customer asked something the thread does not answer, say so in next_action and leave draft_reply asking rather than guessing.
- promises_made must capture EVERY commitment the ${business} side made ("we'll send you...", "a specialist will call you within 24 hours"). Staff cannot honour a promise they never saw. An offer the customer has not accepted ("would you like more details?") is NOT a promise.
- If the thread is spam, an unrelated promotional broadcast, or otherwise has nothing to do with ${business}'s actual business: customer_needs MUST be an empty array and risk_flags must say so ("疑似垃圾/推广消息，非真实客户咨询"). Never invent a plausible-sounding need to fill the field.
${clientFactsBlock(factEntries)}
next_action must be a concrete thing a salesperson does today, in the imperative — "打电话给 Kam，确认出行月份". Never "等待客户回复": if the customer has gone quiet, chasing them IS the action, and the elapsed time below tells you how overdue it is.

draft_reply rules (it goes to a real customer as ${business}):
- Warm, plain English. Two or three sentences. No hype words.${replyNoteLine}
- If the thread is about refunds, cancellations, changes, payment, insurance, medical or accessibility needs, or a complaint: do not attempt to resolve it. Draft a short reply saying a ${business} specialist will come back to them.`
}

/**
 * State the model cannot read off the transcript: who is waiting on whom, and
 * for how long. Without this next_action degrades to "wait for the customer".
 */
function renderContext(context: BriefContext | undefined, business: string): string {
  if (!context) return ''
  const who = context.awaitingReply
    ? `The CUSTOMER spoke last and has been waiting ${context.hoursSinceLastMessage} hours for a reply from ${business}.`
    : `${business} spoke last. The customer has not replied for ${context.hoursSinceLastMessage} hours.`
  return `Current state: ${who}\n\n`
}

/**
 * 只追加给备用模型（Claude / DeepSeek）的提示词后缀，OpenAI 不受影响。
 *
 * 2026-10-26 在 8 段真实 CTS 邮件对话上并排试跑：同一份提示词，Claude 只有 5/8 张把
 * 一句话和下一步写成中文；末尾加这一句之后 8/8，耗时不变。语言要求是简报专属的，
 * 所以内容放在这里、由调用方传给切换层，切换层自己不知道简报要中文。
 */
export const BACKUP_MODEL_LANGUAGE_REMINDER =
  '\n\nFINAL CHECK before you answer — this is the most common mistake: summary, customer_needs, objections, promises_made, next_action and risk_flags MUST be written in SIMPLIFIED CHINESE (汉字), even though the thread is in English. Only draft_reply is English. Do not answer these fields in English.'

function renderThread(messages: StoredMessage[], business: string): string {
  return messages
    .map((m) => {
      const who = m.direction === 'inbound' ? (m.senderName ?? 'Customer') : business
      return `[${m.sentAt}] ${who}: ${m.body}`
    })
    .join('\n')
}

/**
 * Unicode "Mathematical Alphanumeric Symbols" (U+1D400–U+1D7FF) — the styled
 * bold/italic-looking Latin letters scam accounts use to dress up a "your page
 * is now eligible for a verification badge" broadcast so it reads past
 * keyword filters. Real customers essentially never type in this block; a
 * couple of decorative characters in an otherwise normal message should not
 * trip this, so this is a share of the message, not a raw count.
 */
const STYLED_UNICODE_RANGE = /[\u{1D400}-\u{1D7FF}]/gu

/** English phishing/verification-badge lures seen on Meta business pages. Extend as new wording shows up (no Chinese samples seen yet). */
const KNOWN_SPAM_PHRASES = [
  /verification badge/i,
  /eligible to activate/i,
  /click the (document|link) below/i,
  /claim your (reward|badge|prize)/i,
]

function messageLooksLikeSpam(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  const styledChars = text.match(STYLED_UNICODE_RANGE)?.length ?? 0
  const meaningfulChars = text.replace(/\s/g, '').length
  const styledRatio = meaningfulChars > 0 ? styledChars / meaningfulChars : 0
  const heavilyStyled = styledChars >= 8 && styledRatio >= 0.3
  return heavilyStyled || KNOWN_SPAM_PHRASES.some((re) => re.test(text))
}

/**
 * Is this thread just noise (spam/phishing/promotional), with nothing a
 * salesperson should act on? Checked BEFORE calling the model — a thread
 * this obviously not a customer inquiry should never spend a model call
 * inventing a plausible-sounding need for it.
 *
 * Every substantive (non-empty) inbound message must look like spam, not
 * just one of them — a real customer who once received a spam blast earlier
 * in the same thread should not have every later, genuine message dismissed
 * as noise because of it.
 */
export function looksLikeAutomatedSpam(messages: StoredMessage[]): boolean {
  const substantiveInbound = messages.filter((m) => m.direction === 'inbound' && m.body.trim())
  if (substantiveInbound.length === 0) return false
  return substantiveInbound.every((m) => messageLooksLikeSpam(m.body))
}

/**
 * 邮件线程清洗完一个字都不剩时写的卡。
 *
 * 为什么要写卡、而不是跳过（魏征式复审 2026-10-26 的 P2）：跳过等于不往
 * `conversation_briefs` 写行，而「该不该写卡」的判据看的就是那张表——于是这段对话
 * 每小时都会被重新选中、重新拉最多 12 封邮件全文，还占着邮件那半配额。
 * 实测约一成邮件对话会落到这里（553 段里约 55 段），**比每轮 25 段的配额还多**，
 * 真会把配额占死、让存量永远跑不完。
 *
 * 卡的内容只陈述事实，不编任何东西 —— 这正是员工需要知道的一件事：
 * 这个人把我们自己发的邮件转回来了，但一个字没写。
 */
export function nothingFromCustomerBrief(): MessengerBrief {
  return MessengerBriefSchema.parse({
    summary: '客人这封邮件里没有自己写的内容（只转发/引用了我们发出的邮件）。',
    intent_level: 'unknown',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: '打开原始邮件看一眼客人想问什么；如果确实什么都没写，直接打电话或回一封问他需要什么。',
    follow_up_due_at: null,
    risk_flags: ['客人没写文字，无法判断需求，别照这张卡做跟进决定'],
    trip: {
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    },
    contact: { phone: null, email: null },
    draft_reply: '',
  })
}

/**
 * Deterministic brief for a thread that is spam/phishing/promotional, not a
 * real customer inquiry. No model call, no invented need, no auto-reply.
 * The raw conversation is untouched and still visible to staff — this only
 * replaces what the AI-generated card says about it.
 */
export function noiseBrief(): MessengerBrief {
  return MessengerBriefSchema.parse({
    summary: '疑似垃圾/推广/钓鱼消息，非真实客户咨询。',
    intent_level: 'unknown',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: '核实原始对话是否为垃圾/推广/钓鱼消息；确认后可忽略，无需按标准流程跟进。',
    follow_up_due_at: null,
    risk_flags: ['疑似垃圾/推广/钓鱼消息，非真实客户咨询，建议核实后忽略'],
    trip: {
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    },
    contact: { phone: null, email: null },
    draft_reply: '',
  })
}

const NULL_TRIP: TripDetails = {
  tour_interest: null,
  travel_window: null,
  party_size: null,
  departure_city: null,
  first_time_to_china: null,
  budget_signal: null,
}

export interface GenerateBriefDeps {
  /** Test-only override for the knowledge-base read (default: real `getClientKnowledge`). */
  knowledge?: GetClientKnowledgeDeps
  /**
   * Bounds the model call to whatever is left of the caller's per-candidate
   * budget (see `brief-cycle.ts`'s `generateDueBriefs`). Without this the
   * OpenAI request has no deadline of its own — the caller's clock check
   * only runs BETWEEN candidates, so one slow call (2026-09-23: a 429 the
   * SDK retries twice, ~20s) still runs past the gateway's own timeout and
   * the whole chunk never returns (see `CHUNK_TIME_BUDGET_MS`).
   */
  signal?: AbortSignal
  /**
   * 这一条候选的总预算（毫秒）。切换层按它给每一家切时间；省略时 20 秒，
   * 跟 `brief-cycle.ts` 的 `PER_CANDIDATE_BUDGET_MS` 同值。
   */
  budgetMs?: number
  /** 测试注入：假的供应商 / 冷却状态，整条链路不碰网络。生产不传。 */
  failover?: AskJsonDeps
}

export interface GeneratedBrief {
  brief: MessengerBrief
  /**
   * 这张卡**实际是谁答的**。必须如实带回去落库 —— 原来 `storeBrief` 写的是
   * `process.env.OPENAI_API_KEY ? modelName() : 'fallback'`：凭环境猜的，
   * 断电时钥匙当然还在，于是备用模型答的卡也会被记成 gpt-4o-mini。
   * 规则生成的卡（垃圾过滤、没钥匙的兜底）用 provider 'rule'。
   */
  answeredBy?: { provider: string; model: string }
  /**
   * `null` when no knowledge read was attempted at all (spam short-circuit,
   * or the no-API-key dev/test fallback — neither calls the model, so there
   * is nothing to report). Otherwise the outcome of `loadClientFacts` for
   * this run — the caller (`storeBrief` / `brief-cycle.ts`) uses it to mark
   * `read_failed` briefs for retry.
   */
  knowledgeStatus: KnowledgeStatus | null
}

/**
 * Ask the model for a brief. `clientId` is required — every field in the
 * prompt that used to say "CTS" now comes from this client's own row in
 * `clients`, and non-travel clients get their `trip` field hard-cleared
 * below regardless of what the model returns (see 2026-09-13 incident note
 * at the top of this file).
 *
 * Falls back to a deterministic brief when no API key is configured so
 * dev/test never depends on a network call.
 */
export async function generateBrief(
  messages: StoredMessage[],
  clientId: string,
  context?: BriefContext,
  deps: GenerateBriefDeps = {},
): Promise<GeneratedBrief> {
  if (looksLikeAutomatedSpam(messages)) {
    return { brief: noiseBrief(), knowledgeStatus: null, answeredBy: { provider: 'rule', model: 'spam-filter' } }
  }

  // 钥匙门仍然在**任何网络调用之前**（包括下面查 clients）—— dev/test 没配钥匙时必须零网络，
  // 这是本函数自己的合同。但门不能再只看 OpenAI：钥匙被撤/没填正是切换要兜的故障形态之一，
  // 只认 OpenAI 的门会让 OpenAI 没钥匙时直接出兜底卡，Claude 一次都不会被试
  // （魏征审查 2026-10-26）。现在是「所有启用的家都没钥匙」才兜底。
  if (listConfiguredProviders().length === 0) {
    return { brief: fallbackBrief(messages), knowledgeStatus: null, answeredBy: { provider: 'rule', model: 'fallback' } }
  }

  const identity = await loadClientIdentity(clientId)
  const facts = await loadClientFacts(clientId, deps.knowledge)
  // 走切换层：OpenAI 没钱时自动换 Claude（DeepSeek 经 PM 同意、由开关控制）。
  // 设计稿 docs/specs/2026-10-26-ai-provider-failover-design-v1.md。
  //
  // 下面三条是**原来这里的刻意选择**，一条都没丢（传给切换层原样保留）：
  //  · `bypassGateway: true` —— `responses.create` 从没走过 CF 网关一次（openai-client.ts 里有实测核对过程），
  //    不拿一条零证据的路由换掉在跑的链路；
  //  · 总预算 + 调用方 signal —— 2026-09-23 事故：这个调用曾没有自己的超时，SDK 对 429 重试两次能把一条卡烧到 ~20 秒；
  //  · 不开 json_schema 的 strict —— 现在也没开，开了就是行为变更。
  // 🔴 变化点（诚实列出，别写成「一字不变」）：每家 maxRetries 变成 0、错误类型变成聚合错误、
  //    校验换成无默认值的严格版（缺字段不再被默认值悄悄填空，会触发重试/换家）。
  const answer = await askJson({
    system: buildSystemPrompt(identity, facts.entries, context?.channel),
    user: `${renderContext(context, identity.name)}Thread:\n${renderThread(messages, identity.name)}`,
    schema: MessengerBriefStrictSchema,
    jsonSchema: {
      name: 'messenger_brief',
      schema: MESSENGER_BRIEF_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    totalBudgetMs: deps.budgetMs ?? 20_000,
    signal: deps.signal,
    bypassGateway: true,
    openaiModel: modelName(),
    backupSystemSuffix: BACKUP_MODEL_LANGUAGE_REMINDER,
  }, deps.failover)
  const brief = answer.data
  const finalBrief: MessengerBrief = {
    ...brief,
    follow_up_due_at: normaliseFollowUpDueAt(brief.follow_up_due_at),
    summary: stripMarkdown(brief.summary),
    next_action: brief.next_action ? stripMarkdown(brief.next_action) : null,
    customer_needs: brief.customer_needs.map(stripMarkdown),
    objections: brief.objections.map(stripMarkdown),
    promises_made: brief.promises_made.map(stripMarkdown),
    // 🔴 issue #1647 第 5 点：知识库读取失败时 draft_reply 必须留空——它本来
    // 就是唯一读了知识库事实的字段，读失败意味着这次没人能保证它没编事实。
    // 其余字段（summary/customer_needs/...）不依赖知识库，正常保留。
    draft_reply: facts.status === 'read_failed' ? '' : stripMarkdown(brief.draft_reply),
    // Hard gate, not a prompt suggestion: a non-travel client's trip stays
    // null no matter what the model returned. This is what actually fixes
    // the 2026-09-13 incident — the prompt instruction above is defence in
    // depth, not the guarantee.
    trip: isTravelIndustry(identity) ? brief.trip : NULL_TRIP,
  }
  return {
    brief: finalBrief,
    knowledgeStatus: facts.status,
    answeredBy: { provider: answer.provider, model: answer.model },
  }
}

/**
 * follow_up_due_at goes straight into a TIMESTAMPTZ column, so a model that
 * answers "下周三" or "in 3 days" does not merely render oddly — the INSERT
 * throws and the salesperson gets NO card for that thread at all. One unusable
 * date must not cost the whole brief, so anything unparseable becomes null.
 *
 * Bare dates ("2026-08-03") are accepted; Postgres would take them anyway and
 * midnight UTC is a reasonable reading of "that day".
 */
export function normaliseFollowUpDueAt(raw: string | null): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed.toISOString()
}

/**
 * Messenger has no markdown: `**Best of China**` reaches the customer with the
 * asterisks visible. The source threads are full of them (the Meta agent writes
 * markdown), so the model copies the habit. A prompt rule alone is not enough
 * for text that goes to a real customer, so strip it here too.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * Deterministic brief for the no-API-key path. Says only what is mechanically
 * true — it must never look like a real summary the salesperson can trust.
 */
export function fallbackBrief(messages: StoredMessage[]): MessengerBrief {
  const inbound = messages.filter((m) => m.direction === 'inbound')
  return MessengerBriefSchema.parse({
    summary: `未生成 AI 摘要（未配置模型）。客户共发送 ${inbound.length} 条消息，最后一条：${inbound[inbound.length - 1]?.body?.slice(0, 80) ?? '—'}`,
    intent_level: 'unknown',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: '请直接查看下方完整对话记录。',
    follow_up_due_at: null,
    risk_flags: ['AI 摘要未生成，请以原始对话为准'],
    trip: {
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    },
    contact: { phone: null, email: null },
    draft_reply: '',
  })
}

/**
 * Write (or rewrite) the brief row for one conversation.
 *
 * `knowledgeStatus` is only ever persisted as `'read_failed'` or `NULL` —
 * `'ok'` / `'no_approved_facts'` collapse to `NULL` because `knowledge_status`
 * exists solely to mark "this brief needs a rewrite" (issue #1647 §5); those
 * two outcomes need no rewrite.
 */
export async function storeBrief(
  candidate: BriefCandidate,
  brief: MessengerBrief,
  now: Date,
  knowledgeStatus: KnowledgeStatus | null = null,
  /** Same per-candidate deadline as `generateBrief`'s — see its `GenerateBriefDeps.signal`. */
  signal?: AbortSignal,
  /**
   * 实际答题的模型（来自 `GeneratedBrief.answeredBy.model`）。🔴 不再凭环境变量猜：
   * 原来写 `process.env.OPENAI_API_KEY ? modelName() : 'fallback'`，断电时钥匙还在，
   * 备用模型答的卡会被记成 gpt-4o-mini，这一列就在主动说谎。
   */
  model: string = 'unknown',
): Promise<void> {
  const today = now.toISOString().slice(0, 10)
  const countedToday = candidate.regenCountDate === today ? candidate.regenCount : 0

  let query = supabaseAdmin.from('conversation_briefs').upsert(
    {
      conversation_id: candidate.conversationId,
      client_id: candidate.clientId,
      schema_version: BRIEF_SCHEMA_VERSION,
      model,
      summary: brief.summary,
      intent_level: brief.intent_level,
      customer_needs: brief.customer_needs,
      objections: brief.objections,
      promises_made: brief.promises_made,
      next_action: brief.next_action,
      follow_up_due_at: brief.follow_up_due_at,
      risk_flags: brief.risk_flags,
      trip: brief.trip,
      contact: brief.contact,
      draft_reply: brief.draft_reply,
      knowledge_status: knowledgeStatus === 'read_failed' ? 'read_failed' : null,
      source_message_count: candidate.messageCount,
      generated_at: now.toISOString(),
      regen_count: countedToday + 1,
      regen_count_date: today,
      updated_at: now.toISOString(),
    },
    { onConflict: 'conversation_id' },
  )
  if (signal) query = query.abortSignal(signal)

  const { error } = await query

  if (error) throw new Error(`brief upsert failed: ${error.message}`)
}
