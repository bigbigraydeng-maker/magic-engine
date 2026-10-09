/**
 * 发信前的**只读**频率闸门。
 *
 * ## 这个文件解决什么
 *
 * 2026-10 之前，ME 对「这个人最近收过我们几封信」是**完全瞎的**。群发名单是
 * 按标签筛出来的，标签只说明「他是谁」，不说明「他昨天刚收过欢迎流程第 3 封」。
 * 于是同一个人可以在同一天里收到：欢迎流程的自动信 + 一次 newsletter 群发 +
 * 一次补发 —— 三封，谁都不知道。
 *
 * 这里在**发之前**数一遍：给定一批收件人，每个人在滚动窗口里已经收过几封，
 * 到顶的挑出来排除掉。调用方拿 `allowed` 去发，拿 `excluded` 去解释为什么少了人。
 *
 * ## 一条不许破的线：只读，绝不写
 *
 * 整个文件只有 GET。没有 POST / PUT / PATCH / DELETE。这不是「暂时没写」，
 * 是设计：一个「检查」动作如果会改 Mailchimp 状态，它就不能在发信前跑 ——
 * 发信前跑的东西必须可以随便重跑、随便预演、随便失败。
 * receipt 里的 `mailchimp_writes: 0` 和 `no_publish: true` 是给审计看的收据。
 *
 * ## 数得到什么、数不到什么
 *
 * 数的是 Mailchimp 的 activity-feed（`activity_filters=sent`），它同时包含
 * **群发**和 **Customer Journey 自动流程**发出的信 —— 这正是我们需要的两类。
 * 数不到的东西写在 `FREQUENCY_CAP_COVERAGE_GAPS` 里，跟着 receipt 一起交出去。
 * 「拿不到 ≠ 没有」：数不到的部分必须**说出来**，不能假装窗口是完整的。
 *
 * ## 策略永远是传进来的
 *
 * 这个文件里没有 `2`、没有 `7`、没有客户名、没有 audience id。上限和窗口是
 * 每个客户自己的配置（`clients.leads_config.email_frequency_cap`），由调用方
 * 解析好传进来。写死一个默认值等于替客户做决定，而且没人会发现。
 *
 * ## PII
 *
 * 错误信息里不回显邮箱（同 `tags.ts` / `client.ts`）。receipt 里当然有邮箱 ——
 * 那是调用方自己给的输入，不是我们从日志里捞的。
 */

import { datacenterFromKey } from './client'
import {
  subscriberHash,
  type FetchLike,
  type MailchimpTagsConfig,
} from './tags'

const API_VERSION = '3.0'
const REQUEST_TIMEOUT_MS = 20_000
/** activity-feed 一页最多 100 条，够覆盖任何合理的窗口。 */
const ACTIVITY_PAGE_SIZE = 100
/** Mailchimp 允许 10 个并发连接，留一半余量。 */
const MAX_CONCURRENCY = 8
const DEFAULT_CONCURRENCY = 4
/** 429 之后等多久再试：1500ms * 第几次重试。 */
const RETRY_BASE_MS = 1_500
const MAX_RETRIES = 2
/** 回执有效 6 小时：检查和发送之间隔得越久，名单越不可信。 */
const RECEIPT_TTL_MS = 6 * 60 * 60 * 1000
/** 批次运行期间新发出的信时间戳会略晚于取 now 的时刻，容差内仍算数。 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

// ── 策略 ────────────────────────────────────────────────────────────────────

export interface FrequencyCapPolicy {
  maxSends: number
  windowDays: number
}

/**
 * 把 `clients.leads_config.email_frequency_cap` 那份 JSON 解析成策略。
 *
 * 形状是 `{ max_sends: number, window_days: number }`（snake_case，因为它是
 * 数据库里的 JSON，不是 TS 对象）。
 *
 * **没有默认值**。缺一个、不是整数、小于 1、窗口超过 90 天 —— 一律 null。
 * 调用方拿到 null 就该拒绝发信，而不是「用个保守的默认值先跑着」：一个猜出来
 * 的上限会让本该被拦下的人收到信，而且日志上看不出这是猜的。
 *
 * 窗口上限 90 天：这是我们没有验证过更长历史的保守边界（2026-10-08 只实测过
 * 近 7 天的 activity-feed 可用）。窗口开得比可靠数据还长，数出来的「窗口内
 * 封数」会系统性偏低，而且看起来是准的 —— 要放宽先去实测。
 */
export function parseFrequencyCapPolicy(raw: unknown): FrequencyCapPolicy | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>

  const maxSends = obj.max_sends
  const windowDays = obj.window_days

  if (!Number.isInteger(maxSends) || (maxSends as number) < 1) return null
  if (!Number.isInteger(windowDays) || (windowDays as number) < 1) return null
  if ((windowDays as number) > 90) return null

  return { maxSends: maxSends as number, windowDays: windowDays as number }
}

// ── 查历史 ──────────────────────────────────────────────────────────────────

export interface SentRecord {
  campaignId: string
  campaignTitle: string
  sentAt: string
}

export type SendHistoryResult =
  | { status: 'ok'; sends: SentRecord[] }
  | { status: 'not_in_audience' }
  | { status: 'error'; reason: string; retryable: boolean }

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`
}

/**
 * 这个邮箱在名单里的话，最近收过哪些信。
 *
 * 错误映射跟 `tags.ts` 的 `findMemberByEmail` 逐条对齐 —— 两个文件对同一个
 * Mailchimp 端点族给出不同的错误分类，调用方就没法写统一的处理逻辑。
 *
 * 404 仍然是**正常结果**（`not_in_audience`），不是错误：名单里没这个人是每天
 * 都会发生的事。把它当 error 会让「没这个人」和「Mailchimp 挂了」混在一起，
 * 而这两件事的处理方式完全相反（前者照发，后者不能发）。
 */
export async function fetchSendHistory(
  cfg: MailchimpTagsConfig,
  email: string,
): Promise<SendHistoryResult> {
  const clean = email.trim().toLowerCase()
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { status: 'error', reason: 'invalid_email', retryable: false }
  }

  let dc: string
  try {
    dc = datacenterFromKey(cfg.apiKey)
  } catch {
    return { status: 'error', reason: 'bad_api_key_format', retryable: false }
  }

  const url =
    `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}` +
    `/members/${subscriberHash(clean)}/activity-feed` +
    `?count=${ACTIVITY_PAGE_SIZE}&activity_filters=sent`

  const doFetch: FetchLike = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return { status: 'error', reason: timeout ? 'timeout' : 'network', retryable: true }
  }

  if (res.status === 404) return { status: 'not_in_audience' }
  if (res.status === 401) return { status: 'error', reason: 'unauthorized', retryable: false }
  // 429 是限流 —— 等一下就好，判成不可重试等于把「稍后再来」讲成「永远别来」。
  if (!res.ok) {
    return {
      status: 'error',
      reason: `http_${res.status}`,
      retryable: res.status >= 500 || res.status === 429,
    }
  }

  try {
    const json = (await res.json()) as { activity?: unknown; total_items?: unknown }
    if (!Array.isArray(json.activity)) {
      // 形状变了 ≠ 0 封：Mailchimp 改字段名时，这里必须报错，不能整批放行。
      return { status: 'error', reason: 'bad_shape', retryable: false }
    }
    const parsed = parseActivity(json.activity)
    if (parsed.dropped > 0) return { status: 'error', reason: 'bad_shape', retryable: false }
    // 只取了一页：返回条数达到页上限、或总数比返回的多，说明最近的记录可能在页外。
    const total = typeof json.total_items === 'number' ? json.total_items : json.activity.length
    if (json.activity.length >= ACTIVITY_PAGE_SIZE || total > json.activity.length) {
      return { status: 'error', reason: 'truncated', retryable: false }
    }
    return { status: 'ok', sends: parsed.sends }
  } catch {
    return { status: 'error', reason: 'bad_json', retryable: false }
  }
}

/**
 * 只留真正的「发出」记录。
 *
 * 即使带了 `activity_filters=sent`，也逐条再验一遍 `activity_type`：过滤器是
 * 服务端行为，我们不该把「服务端按我们说的做了」当成前提。缺 `created_at_timestamp`
 * 或 `campaign_id` 的「发出」条目不能静默丢（计数会偏低），数出来交给调用方 fail closed。`campaign_title` 缺了就用空串，标题只是给人看的。
 */
function parseActivity(activity: unknown[]): { sends: SentRecord[]; dropped: number } {
  const out: SentRecord[] = []
  let dropped = 0
  for (const item of activity) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (row.activity_type !== 'sent') continue
    // 是「发出」记录却缺时间或编号：不能默默丢（会让计数偏低），记下来让上层 fail closed。
    if (typeof row.created_at_timestamp !== 'string' || typeof row.campaign_id !== 'string') {
      dropped++
      continue
    }
    out.push({
      campaignId: row.campaign_id,
      campaignTitle: typeof row.campaign_title === 'string' ? row.campaign_title : '',
      sentAt: row.created_at_timestamp,
    })
  }
  return { sends: out, dropped }
}

// ── 判定 ────────────────────────────────────────────────────────────────────

export type RecipientVerdictReason =
  | 'ok'
  | 'at_cap'
  | 'not_in_audience'
  | 'lookup_failed'
  | 'invalid_email'

export interface RecipientVerdict {
  email: string
  allowed: boolean
  reason: RecipientVerdictReason
  sendsInWindow: SentRecord[]
  countInWindow: number
  errorReason?: string
}

/**
 * 一个人该不该收这封信。**纯函数** —— 不查网、不看时钟（`now` 是参数）。
 *
 * 判定规则：
 *   - 窗口内封数 >= maxSends → `at_cap`，**不允许**。注意是 `>=` 不是 `>`：
 *     上限是「这个人最多收几封」，已经收满 maxSends 封时，下一封就是多出来的
 *     那一封。写成 `>` 会让每个人多收一封，而且只在边界上错，很难发现。
 *   - 查不到人（`not_in_audience`）→ **允许**。名单里没有他，说明我们本来也
 *     不会通过 Mailchimp 发给他；这不是「查失败」，不该拦。
 *   - 查失败（`error`）→ **不允许**（fail closed）。数不出来的时候放行，等于
 *     把「不知道」当成「没超」—— 这正是这条链路上一次栽的跟头。
 */
export function judgeRecipient(
  email: string,
  history: SendHistoryResult,
  policy: FrequencyCapPolicy,
  now: Date,
): RecipientVerdict {
  const clean = email.trim().toLowerCase()

  if (history.status === 'not_in_audience') {
    return { email: clean, allowed: true, reason: 'not_in_audience', sendsInWindow: [], countInWindow: 0 }
  }

  if (history.status === 'error') {
    const invalid = history.reason === 'invalid_email'
    return {
      email: clean,
      allowed: false,
      reason: invalid ? 'invalid_email' : 'lookup_failed',
      sendsInWindow: [],
      countInWindow: 0,
      errorReason: history.reason,
    }
  }

  const sendsInWindow = withinWindow(history.sends, policy.windowDays, now)
  const atCap = sendsInWindow.length >= policy.maxSends
  return {
    email: clean,
    allowed: !atCap,
    reason: atCap ? 'at_cap' : 'ok',
    sendsInWindow,
    countInWindow: sendsInWindow.length,
  }
}

/**
 * 窗口内的信，按时间倒序，按 campaignId+sentAt 去重。
 *
 * 去重是必要的：activity-feed 在分页边界上可能把同一条记录吐两次，而重复计数
 * 会让一个没到顶的人被误判成到顶 —— 误拦比漏拦更难被发现（少发一封信，没人
 * 会来问）。
 *
 * 未来时间戳直接丢：时钟漂移或 Mailchimp 侧写入异常时，一条「明天」的记录会
 * 永远留在窗口里，把这个人永久锁死。
 */
function withinWindow(sends: readonly SentRecord[], windowDays: number, now: Date): SentRecord[] {
  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const nowMs = now.getTime()
  const seen = new Set<string>()
  const out: SentRecord[] = []

  for (const s of sends) {
    const t = Date.parse(s.sentAt)
    if (!Number.isFinite(t)) continue
    if (t < windowStart || t > nowMs + FUTURE_TOLERANCE_MS) continue
    const key = `${s.campaignId}\u0000${s.sentAt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }

  out.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
  return out
}

// ── 覆盖面声明 ──────────────────────────────────────────────────────────────

/**
 * 这个检查**数得到**的来源。跟着 receipt 一起交出去，让看收据的人知道
 * 「窗口内 0 封」到底意味着什么。
 */
export const FREQUENCY_CAP_COUNTED_SOURCES: readonly string[] = [
  'Mailchimp 群发邮件（含程序创建的每日批次、newsletter）',
  'Mailchimp Customer Journey 自动流程邮件（如 Welcome new contacts）',
]

/**
 * 这个检查**数不到**的东西。必须跟着 receipt 一起交出去。
 *
 * 一份只写「窗口内 1 封，未到顶」的收据会让人以为窗口是完整的 —— 而实际上
 * Gmail 手发的、排着队还没发的、发到旧地址的，全都不在里面。把缺口写出来，
 * 收据才是诚实的。
 */
export const FREQUENCY_CAP_COVERAGE_GAPS: readonly string[] = [
  'Mailchimp 之外发出的邮件（Gmail 手发、ME 自己的发信通道、咨询分流邮件若不走 Mailchimp）这里数不到',
  '已经排队但还没发出的信（欢迎流程里排着的、已排期的群发）不在统计里，只数已经发出的',
  '收件人换过邮箱地址时，旧地址收到的信不会算到新地址头上',
]

// ── 批量检查 ────────────────────────────────────────────────────────────────

export interface FrequencyCapReceipt {
  receipt_version: 1
  request_id: string
  client_id: string
  audience_id: string
  checked_at: string
  /** 回执有效期：过了这个时间不得再拿 allowed 名单去发，要重新检查。 */
  valid_until: string
  window_start: string
  policy: FrequencyCapPolicy
  scanned: number
  allowed_count: number
  excluded_count: number
  allowed: string[]
  excluded: RecipientVerdict[]
  lookup_failed_count: number
  counted_sources: readonly string[]
  coverage_gaps: readonly string[]
  no_publish: true
  mailchimp_writes: 0
}

export interface CheckRecipientsInput {
  clientId: string
  requestId: string
  cfg: MailchimpTagsConfig
  policy: FrequencyCapPolicy
  emails: readonly string[]
  now?: Date
  concurrency?: number
}

/**
 * 一批收件人过一遍频率闸门，返回一份收据。
 *
 * 收据里 `excluded` 带着 `sendsInWindow` —— 审计要能看见「是哪几封把他顶到
 * 上限的」，不然「这个人被排除了」就是一句无法复核的话。
 *
 * 单个收件人出任何问题都**不抛**：一批 500 人里有一个查失败，不该让整批发不
 * 出去。查失败的那个人进 `excluded`（fail closed），其余照常。
 */
export async function checkRecipientsFrequencyCap(
  input: CheckRecipientsInput,
): Promise<FrequencyCapReceipt> {
  const now = input.now ?? new Date()
  const emails = dedupeEmails(input.emails)
  const concurrency = clampConcurrency(input.concurrency)

  // audience id 填错时每个人都会 404，会被当成「不在名单」整批放行 —— 先确认名单存在。
  const audienceOk = await audienceExists(input.cfg)
  const verdicts = audienceOk
    ? await mapWithPool(emails, concurrency, (email) =>
        lookupAndJudge(input.cfg, email, input.policy, now),
      )
    : emails.map((email) => judgeRecipient(email, { status: 'error', reason: 'audience_unreachable', retryable: false }, input.policy, now))

  const allowed = verdicts.filter((v) => v.allowed).map((v) => v.email).sort()
  const excluded = verdicts.filter((v) => !v.allowed)
  const windowStart = new Date(
    now.getTime() - input.policy.windowDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  return {
    receipt_version: 1,
    request_id: input.requestId,
    client_id: input.clientId,
    audience_id: input.cfg.audienceId,
    checked_at: now.toISOString(),
    valid_until: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
    window_start: windowStart,
    policy: input.policy,
    scanned: emails.length,
    allowed_count: allowed.length,
    excluded_count: excluded.length,
    allowed,
    excluded,
    lookup_failed_count: excluded.filter((v) => v.reason === 'lookup_failed').length,
    counted_sources: FREQUENCY_CAP_COUNTED_SOURCES,
    coverage_gaps: FREQUENCY_CAP_COVERAGE_GAPS,
    no_publish: true,
    mailchimp_writes: 0,
  }
}

/** GET /lists/{id}：名单真的存在且读得到。读不到一律当 false（fail closed）。 */
async function audienceExists(cfg: MailchimpTagsConfig): Promise<boolean> {
  let dc: string
  try {
    dc = datacenterFromKey(cfg.apiKey)
  } catch {
    return false
  }
  const url = `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(cfg.audienceId)}?fields=id`
  try {
    const res = await (cfg.fetchImpl ?? fetch)(url, {
      headers: { Authorization: authHeader(cfg.apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 查一个人 + 判定。429 时按退避重试，其余错误直接交给判定。 */
async function lookupAndJudge(
  cfg: MailchimpTagsConfig,
  email: string,
  policy: FrequencyCapPolicy,
  now: Date,
): Promise<RecipientVerdict> {
  let history = await fetchSendHistory(cfg, email)

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (history.status !== 'error' || !history.retryable) break
    if (history.reason !== 'http_429') break
    await sleep(RETRY_BASE_MS * attempt)
    history = await fetchSendHistory(cfg, email)
  }

  return judgeRecipient(email, history, policy, now)
}

/** 小写 + trim + 去空 + 去重，保持首次出现的顺序。 */
function dedupeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of emails) {
    const clean = raw.trim().toLowerCase()
    if (!clean) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

/** 并发数夹在 1..8 之间 —— 超过 8 会撞 Mailchimp 的连接上限。 */
function clampConcurrency(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_CONCURRENCY
  const floored = Math.floor(n)
  if (floored < 1) return 1
  if (floored > MAX_CONCURRENCY) return MAX_CONCURRENCY
  return floored
}

/**
 * 固定大小的工作池。不用 `Promise.all(items.map(...))`：那会一次性打开 N 个
 * 连接，N 是收件人数 —— 500 人的批次会直接把 Mailchimp 的并发限制撞穿。
 */
async function mapWithPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) workers.push(worker())
  await Promise.all(workers)
  return results
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
