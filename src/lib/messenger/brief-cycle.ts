/**
 * 私信简报这一轮该做的三件事，从 cron 路由里抽出来变成可分段调用的三个函数。
 *
 * ## 为什么要抽（2026-09-07 · 修 14 天停更）
 *
 * 原来三件事全挤在 `/api/cron/messenger-brief-hourly` 一个请求里，一轮 160~210 秒。
 * 而网关在**约 125 秒**就掐断连接（实测边界见下），于是这一整轮永远只能在
 * 「响应超时但服务端跑完了」的状态下结束 —— 谁上游按 HTTP 结果判成败，谁就误判。
 *
 * 抽成三段之后，Inngest 那边可以一段一个请求地跑：每段都远在网关那条线以内，
 * 失败也只重试那一段，不用把已经写好的 50 张卡再写一遍。
 *
 * ## 三段的顺序不能换
 *
 * 1. `loadDueBriefs` —— 挑出该写卡的对话（纯读库，秒级）
 * 2. `generateDueBriefs` —— 写卡（每张约 3.2 秒的模型调用，**必须分批**）
 * 3. `runPostBriefSweeps` —— 自动标真买家 + 填「跟进到哪一步」
 *
 * 第 3 步要读第 2 步刚写好的卡，所以必须排在后面；它整段失败也只记一笔，
 * 不回滚已经写好的卡（跟抽出来之前的行为一致）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { classifyThrownOpenAIError, needsHuman } from '@/lib/ai/provider-failure'
import {
  shouldGenerateBrief,
  generateBrief,
  storeBrief,
  nothingFromCustomerBrief,
  type BriefCandidate,
  type StoredMessage,
} from '@/lib/messenger/brief'
import { autoTagQualifiedBuyers, type AutoTagResult } from '@/lib/crm/qualified-buyer-autotag'
import { inferStagesFromConversations, type StageInferResult } from '@/lib/crm/stage-infer'
import { inferConversationFacts, type FactsRunResult } from '@/lib/crm/facts/infer'
import { supabaseFactsIo } from '@/lib/crm/facts/io'
import type { BriefChannel } from './brief-schema'
import {
  hasAnythingToSummarise,
  resolveEmailBodies,
  type FetchFullText,
} from './email-brief-bodies'

/**
 * 一轮最多写几张卡。**这是花钱的闸** —— 积压会顺着后面几轮慢慢排掉，
 * 而不是让一轮坏运行变成一张没有上限的账单。
 */
export const MAX_BRIEFS_PER_RUN = 50

/**
 * 一段最多写几张卡。
 *
 * 🔴 这个数字的唯一依据是**网关约 125 秒掐断**：实测每张卡约 3.2 秒
 *    （2026-08-22 那批运行：50 张 / 157~208 秒），12 张约 40 秒，留足三倍余量。
 *    调大到 40 张就会重新踩回这次事故的那条线。
 */
export const BRIEFS_PER_CHUNK = 12

/**
 * 一段最多允许跑多久（毫秒）。**这是防「段永远不返回」的硬闸。**
 *
 * 🔴 `BRIEFS_PER_CHUNK = 12` 这个数字是按「每张约 3.2 秒」算出来的，而每张卡到底多久
 *    取决于外面那个 AI 服务当时的状态 —— 一旦它变慢（2026-09-23 实测：余额用光时
 *    SDK 对 429 重试两次，一张卡烧 20.1 秒），12 张要约 242 秒，网关约 125 秒就把
 *    连接掐断：这一段**永远不返回**，`log-finish` 一次都跑不到，运行记录永远停在
 *    「在跑」—— 监控上跟健康一模一样。
 *
 *    条数上限管不住这件事，只有时间上限管得住：写完一张就看一眼表，超了就把剩下的
 *    留给下一轮，**把段返回出去**。90 秒留了 35 秒余量给最后那张卡跑完。
 */
export const CHUNK_TIME_BUDGET_MS = 90_000

/**
 * **单条候选**最多允许占多久。必须明显小于整段预算，不是等于它。
 *
 * 🔴 为什么不能让一条候选吃掉整段预算（Codex 复审 2026-09-23 · P1，本分支原来就是这样）：
 *    `loadDueBriefs` 按 `last_message_at` 倒序排，**排在最前面的永远是同一条**。
 *    如果队首那条在模型调用或写库上一直挂着，它会吃满 90 秒 → 整段报 aborted →
 *    编排器停掉后面所有段。而它没写成卡，下一小时它**又排在最前面**，再吃满一次 ——
 *    于是这一条坏对话可以让**其他所有客户的卡永久饿死**，而且每一轮的运行记录
 *    看起来都「有在跑、只是没写完」。
 *
 *    20 秒的依据是实测：正常一张卡 3.75 秒（2026-09-23 生产，50 张 187 秒），
 *    留 5 倍余量；而余额用光时 SDK 重试两次刚好把一条烧到约 20 秒，
 *    也就是说「最贵的已知正常形态」正好在这条线上。
 *    90 ÷ 20 = 一段里最坏情况也还能往前推进 4 条以上，队列不会停在原地。
 */
export const PER_CANDIDATE_BUDGET_MS = 20_000

/**
 * 账户级失效各自对应的一句中文 —— 它会原样进 `cron_run_logs.error_message`，
 * 也就是 PM 在体检报告和今日待办里看到的那句话，所以要说清「谁该动手」。
 */
const ABORT_REASON: Record<string, string> = {
  account_exhausted: 'AI 服务账户余额/额度用光了 —— 充值前这一轮剩下的都会同样失败，已当场停下',
  credential_invalid: 'AI 服务的钥匙不认了（被撤销 / 打错 / 过期）—— 换钥匙前这一轮剩下的都会同样失败，已当场停下',
  gateway_auth_failed: 'AI 调用卡在网关那一层，还没走到 OpenAI —— 要换网关令牌，这一轮剩下的都会同样失败，已当场停下',
}

/** 候选池一次最多从库里捞多少条对话（挑之前的粗筛上限，不是写卡上限）。 */
const CANDIDATE_POOL = 500

interface ExistingBrief {
  source_message_count: number
  regen_count: number
  regen_count_date: string | null
  knowledge_status: string | null
}

interface ConversationRow {
  id: string
  client_id: string
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
  conversation_briefs: ExistingBrief | ExistingBrief[] | null
}

/**
 * 该写卡的一条对话。
 *
 * 🔴 必须是**纯 JSON**：它要作为 Inngest 步骤的返回值被缓存下来，跨步骤传递。
 *    塞进 Date 或类实例，重放时拿回来的就不是同一个东西。
 */
export interface DueBrief extends BriefCandidate {
  /** 最后说话的是客人还是我们 —— 模型靠它决定「谁在等谁」。 */
  awaitingReply: boolean
  /** 这段对话来自哪条渠道。决定提示词口径，以及要不要去拉邮件全文。 */
  channel: BriefChannel
}

export interface BriefGenerationResult {
  generated: number
  failed: number
  /**
   * 邮件清洗完一个字都不剩的条数（客人只转发了我们自己的邮件、没写字）。
   * 这些对话会拿到一张「客人没写内容」的卡（不调模型），所以不算进 `generated`，
   * 也绝不算 `failed` —— 它不是故障。混进任何一边都会让运行记录说谎。
   */
  emptyThreads?: number
  /**
   * 这一段被提前掐掉的原因，正常跑完是 null。
   *
   * 🔴 调用方**必须**看这个字段：有值就别再排下一段了，而且这一轮要记成失败 ——
   *    「余额用光」和「今天没人要写卡」在运行记录里长得一样的话，这次事故会再发生一遍。
   */
  aborted: string | null
}

/** 给 `generateDueBriefs` 的旋钮，全部有默认值；测试用来注入假表和短预算。 */
export interface GenerateDueBriefsOptions {
  /** 这一段的时间预算，默认 `CHUNK_TIME_BUDGET_MS`。 */
  budgetMs?: number
  /** 单条候选的上限，默认 `PER_CANDIDATE_BUDGET_MS`。 */
  perCandidateMs?: number
  /** 读表用的时钟，默认 `Date.now`。测试注入假表，不用真等 90 秒。 */
  clock?: () => number
  /**
   * 邮件渠道怎么拿「某个客户的拉全文方法」。默认走生产那条（查邮箱连接 → 换令牌）。
   * 测试注入假的，整条链路不碰网络。
   */
  emailFullText?: (clientId: string) => Promise<FetchFullText | null>
}

export interface PostBriefSweepResult {
  qualifiedBuyers: AutoTagResult | { error: string }
  stageInfer: StageInferResult | { error: string }
  /** AI 读对话存事实（默认关，`CRM_FACTS_CLIENT_IDS` 列了客户才跑）。只写自己的表，不影响名单。 */
  conversationFacts: FactsRunResult | { error: string }
}

function toCandidate(row: ConversationRow): BriefCandidate {
  // PostgREST 对一对一关系返回对象、对一对多返回数组，两种都要认；只认数组会让
  // 「已写过卡」永远判成没写过（2026-10 审计，每天约 1200 次调用只需约 70 次）。
  const raw = row.conversation_briefs
  const brief = Array.isArray(raw) ? raw[0] : raw ?? undefined
  return {
    conversationId: row.id,
    clientId: row.client_id,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    existingBriefMessageCount: brief?.source_message_count ?? null,
    regenCount: brief?.regen_count ?? 0,
    regenCountDate: brief?.regen_count_date ?? null,
    existingKnowledgeStatus: brief?.knowledge_status === 'read_failed' ? 'read_failed' : null,
  }
}

/**
 * 读这条对话的全部消息。
 *
 * 🔴 **查询失败必须抛，绝不能吞成空数组**（Codex 复审 2026-09-23 抓到，而且这正是
 *    本 PR 要消灭的那类毛病换了个位置）：PostgREST 被 `AbortSignal` 掐断时**不抛异常**，
 *    而是返回 `{ data: null, error: AbortError }`。旧写法只取 `data`，于是
 *    「查询超时了」会变成「这条对话一条消息都没有」→ 调用方 `continue` 当正常空对话跳过。
 *    如果它恰好是这一段的最后一条候选，循环直接结束、返回 `aborted: null` ——
 *    **一次超时被记成成功，`failed=0`**，跟 9/20 那次「监控上一切正常」一模一样。
 */
async function loadMessages(conversationId: string, signal?: AbortSignal): Promise<StoredMessage[]> {
  let query = supabaseAdmin
    .from('conversation_messages')
    .select('direction, sender_name, body, sent_at, message_id')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
  if (signal) query = query.abortSignal(signal)

  const { data, error } = await query
  if (error) throw new Error(`读对话 ${conversationId} 的消息失败：${error.message}`)

  return (data ?? []).map((m) => ({
    direction: m.direction as 'inbound' | 'outbound',
    senderName: m.sender_name,
    body: m.body ?? '',
    sentAt: m.sent_at,
    messageId: (m as { message_id?: string | null }).message_id ?? null,
  }))
}

/**
 * 「这一条候选跑过了本段剩余预算」—— 专门起一个类，让 catch 能**无歧义地**认出它。
 *
 * 靠 `err.name === 'AbortError'` 认是不够的：业务代码里别的地方也可能冒出中止错误，
 * 而这里要的判断是「该不该把整段停下来」，不是「刚才那次网络怎么了」。
 */
class CandidateBudgetExhausted extends Error {
  constructor(readonly conversationId: string) {
    super(`候选 ${conversationId} 跑过了本段剩余预算`)
    this.name = 'CandidateBudgetExhausted'
  }
}

/**
 * 给一条候选的**整条流程**套一个硬截止时间。
 *
 * 🔴 为什么 `AbortSignal` 一个人守不住（Codex 复审 2026-09-23）：signal 只传给了
 *    模型调用和两处 Supabase 查询，可 `generateBrief()` 在调模型**之前**还要先读
 *    `clients`（身份）和知识库，那两组读取既没收这个 signal、也没有自己的超时。
 *    任一处挂住，90 秒预算就形同不存在，整段照旧被网关强杀、留下一行「在跑」。
 *    一条一条去接 signal 要动到共享的知识库模块（`getClientKnowledge` 的 deps 里
 *    没有 signal），爆炸半径比这件事本身大得多。
 *
 *    所以改成一道**外层硬闸**：不管卡在哪一步，到点就让这一条以
 *    `CandidateBudgetExhausted` 结束，把控制权交回循环。signal 照旧保留 ——
 *    它负责真正取消在飞的 HTTP 请求（省资源），这道闸负责保证控制流一定回来。
 *
 * 🔴 这里的 `setTimeout` 不是 PITFALLS §F 说的那种「在 step.run 里轮询」：
 *    它不轮询、不续命，而且 `finally` 里一定清掉，不会把 step 吊着。
 */
function withCandidateDeadline<T>(
  work: Promise<T>,
  ms: number,
  conversationId: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CandidateBudgetExhausted(conversationId)), ms)
  })
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

/**
 * 挑出这一轮该写卡的对话。纯读库，不花钱、不写库。
 *
 * 读失败**抛异常**而不是返回空：返回空跟「今天真的没人要写卡」长得一模一样，
 * 上游会把一次读库失败记成一次正常的空轮。
 */
const CANDIDATE_COLUMNS =
  'id, client_id, message_count, last_message_at, last_message_from, conversation_briefs(source_message_count, regen_count, regen_count_date, knowledge_status)'

/** 一条渠道的候选池。私信不带客户名单（所有客户都写卡），邮件只给开了开关的客户。 */
async function loadChannelCandidates(
  channel: BriefChannel,
  now: Date,
  clientIds: readonly string[] | null,
): Promise<DueBrief[]> {
  if (clientIds !== null && clientIds.length === 0) return []

  let q = supabaseAdmin
    .from('conversations')
    .select(CANDIDATE_COLUMNS)
    .gt('message_count', 0)
    .eq('channel', channel)
  if (clientIds !== null) q = q.in('client_id', clientIds)

  const { data, error } = await q.order('last_message_at', { ascending: false }).limit(CANDIDATE_POOL)
  // 读失败抛异常而不是返回空：返回空跟「今天真的没人要写卡」长得一模一样。
  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((row) => {
      const r = row as ConversationRow
      return { ...toCandidate(r), awaitingReply: r.last_message_from === 'customer', channel }
    })
    .filter((c) => shouldGenerateBrief(c, now))
}

/**
 * 哪些客户开了「邮件也写简报」。没开的客户一段邮件都不会碰。
 *
 * 照 `payment-email-detect-wire.ts` 同一套写法：开关在 `clients.leads_config`，
 * 不写死任何客户。读失败**当成没人开**（fail-closed）—— 宁可今天少写几张卡，
 * 也不要因为读配置失败就给没打算开的客户花钱调模型。
 */
async function clientsWithEmailBriefs(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .filter('leads_config->email_briefs->>enabled', 'eq', 'true')
  if (error) return []
  return (data ?? []).map((r) => (r as { id: string }).id)
}

/**
 * 挑出这一轮该写卡的对话。纯读库，不花钱、不写库。
 *
 * ## 为什么邮件单独一条查询
 *
 * 原来这里只认私信，注释写的理由是「喂邮件进去会得到一张说错渠道的卡」——
 * 那个理由已经修掉了（提示词现在认渠道）。但还是**不把两条渠道合成一条查询**：
 *
 * 1. 私信这条路已经在给 525 段对话写卡。合成一条查询就等于改一条在跑的链路，
 *    而这次要加的只是邮件。
 * 2. 候选池是「按最后消息时间取最近 500 条」。两条渠道挤同一个池子，
 *    消息多的那条会把另一条挤出去 —— 这种饿死不会报错，只会某天某条渠道
 *    悄悄不写卡了。各给一个池，谁也挤不着谁。
 *
 * 配额按 `cap` 对半分，邮件那半用不完就还给私信。
 */
export async function loadDueBriefs(
  now: Date,
  cap: number = MAX_BRIEFS_PER_RUN,
): Promise<DueBrief[]> {
  const emailClients = await clientsWithEmailBriefs()
  // 一个客户都没开 → 一条额外查询都不发，行为跟加这个功能之前逐字相同。
  if (emailClients.length === 0) {
    return (await loadChannelCandidates('messenger', now, null)).slice(0, cap)
  }

  const [messenger, email] = await Promise.all([
    loadChannelCandidates('messenger', now, null),
    loadChannelCandidates('email', now, emailClients),
  ])
  const emailShare = Math.min(email.length, Math.floor(cap / 2))
  const taken = [...email.slice(0, emailShare), ...messenger.slice(0, cap - emailShare)]
  // 回到「谁最近说话谁先写」的口径，跟只有私信时一致。
  return taken.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')).slice(0, cap)
}


/**
 * 邮件渠道专用：把库里那 255 字摘要换成「清洗过的全文」。
 *
 * 为什么非做不可：`conversation_messages.body` 只存了 255 字（当初为省空间故意的），
 * 实测 **73% 的客人来信在这里被截断**。拿半句话写卡，错得看不出来。
 * 而全文又带着整段引用历史 —— 一封真实来信全文 3963 字，客人自己只写了 78 字，
 * 剩下全是我们自己发的营销邮件被引用回来。所以必须拉全文 **再** 清洗，缺一步都不行。
 *
 * 返回 `null` 表示「清洗完没有任何可总结的内容」，调用方据此跳过不写卡。
 */
async function withEmailFullText(
  candidate: DueBrief,
  stored: readonly StoredMessage[],
  fetchForClient: (clientId: string) => Promise<FetchFullText | null>,
): Promise<StoredMessage[] | null> {
  const fetchFullText = await fetchForClient(candidate.clientId)
  // 取不到邮箱令牌（没连、已吊销）就按原样走：255 字摘要虽然短，
  // 但它确实是这封信的开头，比不写卡更有用。不许把它当成失败。
  if (fetchFullText === null) return [...stored]

  const refs = stored.map((m) => ({ messageId: m.messageId ?? '', storedBody: m.body }))
  const resolved = await resolveEmailBodies(refs, fetchFullText)
  if (!hasAnythingToSummarise(resolved)) return null

  return stored.map((m, i) => ({ ...m, body: resolved.bodies[i]?.text ?? m.body }))
}

/**
 * 生产用的取全文方法：按客户找到在用的邮箱连接，换一个有效令牌。
 *
 * 跟 `payment-email-detect-wire.ts` 同一套（同一个 provider 常量、同一个状态常量、
 * 同一个令牌管理器），不另起一条读邮箱的路。
 *
 * 🔴 **缓存必须是「一轮一份」，绝不能挂在模块顶层**（复审 2026-10-26 的 P1，实测成立）：
 *    `getValidTokenForConnection` 的契约是「每次调用都给你一个没过期的令牌」，
 *    它自己会在过期前换新。把它返回的**字符串**长期缓存，等于把这个保证作废 ——
 *    Render 上进程常驻，令牌约一小时过期，于是第二轮之后每次拉全文都失败，
 *    而失败被 `tryFetchFullText` 吞掉、退回 255 字摘要，运行记录里一点异常都没有。
 *    结果是悄悄退回这个功能要解决的那个老问题：73% 的来信被截断，卡却看着正常。
 *    缓存 `null` 一样有害：客户之后接上邮箱，不重启就永远不认。
 */
export function makeEmailFullTextResolver(
  resolveOne: (clientId: string) => Promise<FetchFullText | null> = resolveEmailFetcher,
): (clientId: string) => Promise<FetchFullText | null> {
  const perRunCache = new Map<string, FetchFullText | null>()
  return async (clientId: string) => {
    const cached = perRunCache.get(clientId)
    if (cached !== undefined) return cached
    const resolved = await resolveOne(clientId)
    perRunCache.set(clientId, resolved)
    return resolved
  }
}

async function resolveEmailFetcher(clientId: string): Promise<FetchFullText | null> {
  let resolvedFetch: FetchFullText | null = null
  try {
    const { MICROSOFT_MAIL_PROVIDER } = await import('@/lib/microsoft/mail-oauth')
    const { CONNECTION_STATUS } = await import('@/lib/platform-oauth/vocabulary')
    const { data } = await supabaseAdmin
      .from('platform_oauth_connections')
      .select('id')
      .eq('client_id', clientId)
      .eq('provider', MICROSOFT_MAIL_PROVIDER)
      .eq('status', CONNECTION_STATUS.ACTIVE)
      .limit(1)
      .maybeSingle()
    const connectionId = (data as { id: string } | null)?.id ?? null
    if (connectionId !== null) {
      const { getValidTokenForConnection } = await import('@/lib/platform-oauth/token-manager')
      const { fetchMessageText } = await import('@/lib/microsoft/mail-graph')
      const token = await getValidTokenForConnection(connectionId)
      resolvedFetch = async (messageId: string) => {
        const r = await fetchMessageText(token, messageId)
        return r.ok ? r.message.body : null
      }
    }
  } catch {
    // 换令牌失败就按「没有全文」走，上面会退回 255 字摘要。
    resolvedFetch = null
  }
  return resolvedFetch
}

/**
 * 给这一批对话各写一张卡。**调用方负责分批**（见 `BRIEFS_PER_CHUNK`）。
 *
 * 单条失败只记一笔继续下一条 —— 一个人的对话数据坏了，不该让这一批剩下的人
 * 今天都看不到卡。
 *
 * 但有两种情况必须**当场把这一段返回出去**，否则段会撞穿网关那条约 125 秒的线、
 * 永远不返回，运行记录就永远停在「在跑」（2026-09-23 事故，见
 * `CHUNK_TIME_BUDGET_MS` 和 `@/lib/ai/provider-failure`）：
 *
 *   1. **账户级 AI 故障**（余额用光 / 密钥被拒）—— 对剩下每一条都是同一个结论，
 *      逐条确认只是把 20 秒乘以条数。
 *   2. **时间预算用完** —— 无论慢在哪里，剩下的留给下一轮，先把段交出去。
 *
 * 这道时间预算检查只在条目**之间**生效；单条 `loadMessages` / OpenAI 请求 /
 * `storeBrief` 自己卡住的话，检查永远等不到下一次循环。所以每条候选还会拿到
 * 一个按剩余预算算出来的 `AbortSignal.timeout(...)`，逐一传进这三步——单条调用
 * 到点自己中止，不靠外面这层检查兜底。
 */
export async function generateDueBriefs(
  due: readonly DueBrief[],
  now: Date,
  opts: GenerateDueBriefsOptions = {},
): Promise<BriefGenerationResult> {
  const budgetMs = opts.budgetMs ?? CHUNK_TIME_BUDGET_MS
  // 邮件清洗完没有任何客人原话的条数。单独记，不混进 failed —— 它不是故障。
  let emptyThreads = 0
  // 🔴 一轮一份的邮箱令牌缓存（见 makeEmailFullTextResolver 头上那条）。
  const emailFullText = opts.emailFullText ?? makeEmailFullTextResolver()
  const perCandidateMs = opts.perCandidateMs ?? PER_CANDIDATE_BUDGET_MS
  const clock = opts.clock ?? Date.now
  const startedAt = clock()
  let generated = 0
  let failed = 0
  let done = 0

  for (const candidate of due) {
    // 先看表再干活：这一张要是开工就注定超时，不如把段先交出去。
    const elapsed = clock() - startedAt
    if (elapsed >= budgetMs) {
      const left = due.length - done
      return {
        generated,
        failed,
        aborted: `这一段跑满了 ${Math.round(budgetMs / 1000)} 秒的时间预算，剩下 ${left} 条留给下一轮（防止整段撞穿网关超时、运行记录卡在「在跑」）`,
      }
    }
    done++

    // 🔴 上面那个时间检查只在条目之间生效——单条 loadMessages / OpenAI 请求 /
    // storeBrief 自己挂住的话，这个检查永远没有机会跑到下一轮。把剩余的段预算
    // 落成一个真实的 AbortSignal 传给这一条调用本身，让它到点自己中止，而不是
    // 靠调用方在外面干等到网关把整段连接掐断（2026-09-23 事故）。
    // 🔴 两条线取小：既不许超过整段剩余预算，也不许让这一条独占太久（见
    //    `PER_CANDIDATE_BUDGET_MS` —— 队首那条挂住会饿死其他所有客户）。
    const remaining = budgetMs - elapsed
    const candidateMs = Math.min(remaining, perCandidateMs)
    const signal = AbortSignal.timeout(candidateMs)

    try {
      // 外层硬闸 + 内层 signal 两层一起上，理由见 withCandidateDeadline。
      await withCandidateDeadline(
        (async () => {
          const stored = await loadMessages(candidate.conversationId, signal)
          if (stored.length === 0) return
          const prepared =
            candidate.channel === 'email'
              ? await withEmailFullText(candidate, stored, emailFullText)
              : stored
          // 邮件清洗完可能一个字都不剩（客人只把我们自己的推广邮件转回来、没写字）。
          // 这种情况写一张**只陈述这个事实**的卡，不调模型、不编任何内容。
          // 为什么不是直接跳过：跳过等于不往 conversation_briefs 写行，而「该不该写卡」
          // 的判据看的就是那张表 —— 这段对话每小时都会被重新选中、重新拉最多 12 封全文，
          // 还占着邮件那半配额。实测约一成邮件对话落到这里（553 段里约 55 段），
          // 比每轮 25 段的配额还多，真会把配额占死、让存量永远跑不完。
          if (prepared === null) {
            await storeBrief(candidate, nothingFromCustomerBrief(), now, null, signal)
            emptyThreads++
            return
          }
          const { brief, knowledgeStatus } = await generateBrief(
            prepared,
            candidate.clientId,
            {
              awaitingReply: candidate.awaitingReply,
              hoursSinceLastMessage: candidate.lastMessageAt
                ? Math.round((now.getTime() - new Date(candidate.lastMessageAt).getTime()) / 3_600_000)
                : 0,
              channel: candidate.channel,
            },
            { signal },
          )
          await storeBrief(candidate, brief, now, knowledgeStatus, signal)
          generated++
        })(),
        candidateMs,
        candidate.conversationId,
      )
    } catch (err) {
      // 🔴 预算跑完了 → 整段收工，**不能只记一笔 failed 继续往下走**。
      //    继续走的话，如果它恰好是最后一条候选，函数会返回 `aborted: null`，
      //    一次超时就被记成成功 —— 正是本 PR 要消灭的那个形态。
      if (err instanceof CandidateBudgetExhausted) {
        // 🔴 这里必须分两种情况，合成一种就会重新造出队首饿死（Codex P1）：
        //
        //    · 整段预算真的用完了 → 收工，剩下的留给下一轮。
        //    · 只是**这一条**吃满了自己那 20 秒、整段还有时间 → **记一笔失败继续下一条**。
        //      停下来的话，队首那条坏对话每一轮都会把整段掐掉，其他客户永远排不到。
        failed++
        console.error(`[messenger/brief] ${err.message}（单条上限 ${Math.round(candidateMs / 1000)} 秒）`)
        if (clock() - startedAt >= budgetMs) {
          const left = due.length - done
          return {
            generated,
            failed,
            aborted: `这一段跑满了 ${Math.round(budgetMs / 1000)} 秒的时间预算，剩下 ${left} 条留给下一轮（防止整段撞穿网关超时、运行记录卡在「在跑」）`,
          }
        }
        continue
      }

      // 账户级失效（没钱 / 钥匙不认了 / 卡在网关）对这一批剩下的每一条都是同一个结论。
      // 判据原样用 `@/lib/ai/provider-failure` 那一份，这里不另立标准。
      const kind = classifyThrownOpenAIError(err)
      if (needsHuman(kind)) {
        const reason = ABORT_REASON[kind]
        console.error(`[messenger/brief] 账户级故障，这一轮当场停下：${reason}`, err)
        return { generated, failed, emptyThreads, aborted: reason }
      }
      failed++
      console.error(`[messenger/brief] ${candidate.conversationId} failed:`, err)
    }
  }

  return { generated, failed, emptyThreads, aborted: null }
}

/**
 * 写完卡之后的两遍扫描。
 *
 * 两遍各自 catch：任一整轮失败都只记一笔，已经写好的卡不回滚 ——
 * 卡直接影响销售今天看到什么，标签和阶段不影响。
 */
export async function runPostBriefSweeps(now: Date): Promise<PostBriefSweepResult> {
  let qualifiedBuyers: AutoTagResult | { error: string }
  try {
    qualifiedBuyers = await autoTagQualifiedBuyers(now)
  } catch (err) {
    qualifiedBuyers = { error: err instanceof Error ? err.message : String(err) }
    console.error('[crm/qualified-buyer] 自动打标整轮失败:', err)
  }

  let stageInfer: StageInferResult | { error: string }
  try {
    stageInfer = await inferStagesFromConversations(now)
  } catch (err) {
    stageInfer = { error: err instanceof Error ? err.message : String(err) }
    console.error('[crm/stage-infer] 读往来填阶段整轮失败:', err)
  }

  // 存「AI 读对话得出的事实」。只写 conversation_facts 这一张自己的表，这一版名单**不读它**
  // （PR2 才读）。整轮出错只记一笔，不影响上面两遍。
  let conversationFacts: FactsRunResult | { error: string }
  try {
    conversationFacts = await inferConversationFacts(now, { io: supabaseFactsIo() })
  } catch (err) {
    conversationFacts = { error: err instanceof Error ? err.message : String(err) }
    console.error('[crm/facts] 存对话事实整轮失败:', err)
  }

  return { qualifiedBuyers, stageInfer, conversationFacts }
}

/** 把 due 列表切成每段 `BRIEFS_PER_CHUNK` 条。抽出来是为了能直测切法。 */
export function chunkDueBriefs(
  due: readonly DueBrief[],
  size: number = BRIEFS_PER_CHUNK,
): DueBrief[][] {
  if (size <= 0) throw new Error('chunk size 必须大于 0')
  const out: DueBrief[][] = []
  for (let i = 0; i < due.length; i += size) out.push(due.slice(i, i + size))
  return out
}
