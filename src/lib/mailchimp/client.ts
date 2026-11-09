/**
 * Mailchimp —— 读取「谁收到了、谁打开了、谁点了链接」，外加一条**受控**的写：
 * 把一个已同意的联系人订阅进 audience（触发 Welcome journey 的入口动作）。
 *
 * 为什么要这些：销售一天打不完 297 个电话。但一批邮件发出去，三分之一的人
 * 会打开、一成多会点链接（CTS 近 90 天真实数据：打开率 20.8%–58.2%，
 * 点击率 0%–35.3%）—— **该打给谁，由他有没有反应决定**，不是由我们打没打过。
 *
 * 唯一的写路径 = `subscribeMember`（POST /lists/{id}/members）。**不 PATCH、
 * 不重订阅、不改现有会员状态** —— Mailchimp 的 unsubscribed / cleaned 是客户
 * 主动或系统认证的选择，代码永远不能替客户翻转它。发送邮件本身仍在 Mailchimp
 * 里做，本文件不发邮件。
 *
 * API key 的数据中心后缀就是 host：`abc123...-us14` → https://us14.api.mailchimp.com
 * 所以只需要一个环境变量，不用另配 region。
 */

import { createHash } from 'node:crypto'

const API_VERSION = '3.0'

export interface MailchimpCampaign {
  id: string
  title: string
  subject: string
  sentAt: string | null
  emailsSent: number
  opens: number
  uniqueOpens: number
  clicks: number
  openRate: number
  clickRate: number
}

/** 一个人对一封邮件做了什么。写进他时间线的就是这个。 */
export interface MemberActivity {
  email: string
  opened: boolean
  clicked: boolean
  /** 最后一次动作的时间（打开或点击，取最晚）。没动作就是 null。 */
  lastActionAt: string | null
}

export class MailchimpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** 超时/网络类失败可以重试；认证失败、格式错误这类不该重试。 */
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'MailchimpError'
  }
}

/**
 * key 末尾的 `-us14` 是数据中心，也是请求要打的 host。
 * 没有后缀的 key 是坏的 —— 早点说清楚，别等调用时报一个看不懂的 401。
 */
export function datacenterFromKey(apiKey: string): string {
  const dc = apiKey.trim().split('-').pop()
  if (!dc || !/^[a-z]+\d+$/.test(dc)) {
    throw new MailchimpError(
      'Mailchimp key 格式不对：末尾应该带数据中心后缀（像 -us14），复制时要连着一起复制',
    )
  }
  return dc
}

/** 打开率这类比例，Mailchimp 给的是 0–1 的小数；统一成百分数保留一位。 */
export function toPercent(ratio: unknown): number {
  const n = typeof ratio === 'number' ? ratio : 0
  return Math.round(n * 1000) / 10
}

interface RawCampaign {
  id: string
  settings?: { title?: string; subject_line?: string }
  send_time?: string
  emails_sent?: number
  report_summary?: {
    opens?: number
    unique_opens?: number
    clicks?: number
    open_rate?: number
    click_rate?: number
  }
}

export function normaliseCampaign(raw: RawCampaign): MailchimpCampaign {
  const r = raw.report_summary ?? {}
  return {
    id: raw.id,
    title: raw.settings?.title ?? raw.settings?.subject_line ?? '(未命名)',
    subject: raw.settings?.subject_line ?? '',
    sentAt: raw.send_time || null,
    emailsSent: raw.emails_sent ?? 0,
    opens: r.opens ?? 0,
    uniqueOpens: r.unique_opens ?? 0,
    clicks: r.clicks ?? 0,
    openRate: toPercent(r.open_rate),
    clickRate: toPercent(r.click_rate),
  }
}

/**
 * 把「打开明细」和「点击明细」两份名单合成每人一条。
 *
 * 点击 ⊃ 打开：Mailchimp 里点了链接的人有时不在 open-details 里（图片被拦
 * 导致打开没被记录）。点了链接却算成「没打开」会让最热的人掉出名单，
 * 所以这里显式补上 opened=true。
 */
export function mergeActivity(
  openers: Array<{ email_address?: string; last_open?: string; timestamp?: string }>,
  clickers: Array<{ email_address?: string; timestamp?: string }>,
): MemberActivity[] {
  const byEmail = new Map<string, MemberActivity>()

  const put = (rawEmail: unknown, at: unknown, kind: 'open' | 'click') => {
    if (typeof rawEmail !== 'string') return
    const email = rawEmail.trim().toLowerCase()
    if (!email) return
    const when = typeof at === 'string' && at ? at : null
    const cur = byEmail.get(email) ?? { email, opened: false, clicked: false, lastActionAt: null }
    if (kind === 'open') cur.opened = true
    else {
      cur.clicked = true
      // 点了必然看了 —— 图片被拦时 Mailchimp 记不到打开。
      cur.opened = true
    }
    if (when && (!cur.lastActionAt || new Date(when) > new Date(cur.lastActionAt))) {
      cur.lastActionAt = when
    }
    byEmail.set(email, cur)
  }

  for (const o of openers) put(o.email_address, o.last_open ?? o.timestamp, 'open')
  for (const c of clickers) put(c.email_address, c.timestamp, 'click')

  return Array.from(byEmail.values())
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * Mailchimp 接了连接但迟迟不回应时，没有超时的 fetch 会一直 pending ——
 * leads-sync 之类的调用方是逐条串行等的，一个卡住的请求会拖住其后所有
 * 客户/表单，直到整个定时任务被平台杀掉。必须给个硬上限。
 */
const REQUEST_TIMEOUT_MS = 20_000

async function call<T>(apiKey: string, path: string, params?: Record<string, string>): Promise<T> {
  const dc = datacenterFromKey(apiKey)
  const url = new URL(`https://${dc}.api.mailchimp.com/${API_VERSION}${path}`)
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v)

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        // Mailchimp 认 Basic，用户名随便填。
        Authorization: `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new MailchimpError(`Mailchimp 请求超过 ${REQUEST_TIMEOUT_MS / 1000}s 没响应，先跳过`, undefined, true)
    }
    throw new MailchimpError(
      `Mailchimp 连不上：${err instanceof Error ? err.message : String(err)}`,
      undefined,
      true,
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) {
      throw new MailchimpError('Mailchimp 认证失败：key 不对或已被撤销', 401)
    }
    throw new MailchimpError(`Mailchimp ${res.status}: ${body.slice(0, 200)}`, res.status)
  }
  return (await res.json()) as T
}

/** 单页上限。Mailchimp 每页最多 1000。 */
const PAGE = 1000

async function fetchAllMembers(
  apiKey: string,
  path: string,
  pick: (json: Record<string, unknown>) => unknown[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  for (let offset = 0; ; offset += PAGE) {
    const json = await call<Record<string, unknown>>(apiKey, path, {
      count: String(PAGE),
      offset: String(offset),
    })
    const rows = pick(json) as Array<Record<string, unknown>>
    if (!rows || rows.length === 0) break
    out.push(...rows)
    if (rows.length < PAGE) break
    // 安全阀:一批邮件几万人是异常,别无限翻。
    if (out.length >= 50_000) break
  }
  return out
}

/** 最近发出去的邮件（含打开/点击汇总）。 */
export async function listSentCampaigns(
  apiKey: string,
  opts: { sinceSentAt?: string; count?: number; listId?: string } = {},
): Promise<MailchimpCampaign[]> {
  const params: Record<string, string> = {
    status: 'sent',
    sort_field: 'send_time',
    sort_dir: 'DESC',
    count: String(opts.count ?? 100),
  }
  if (opts.sinceSentAt) params.since_send_time = opts.sinceSentAt
  // The API key is shared by every client's audience: without this, one client's campaigns would be read as another's.
  if (opts.listId) params.list_id = opts.listId

  const json = await call<{ campaigns?: RawCampaign[] }>(apiKey, '/campaigns', params)
  return (json.campaigns ?? []).map(normaliseCampaign)
}

/** 这封邮件里，谁打开了、谁点了链接。 */
export async function getCampaignActivity(
  apiKey: string,
  campaignId: string,
): Promise<MemberActivity[]> {
  const [openers, clickers] = await Promise.all([
    fetchAllMembers(apiKey, `/reports/${campaignId}/open-details`, (j) => (j.members as unknown[]) ?? []),
    // 点击明细按链接分组,这里要的是「点过任意链接的人」——用 click-details 的
    // members 汇总端点,一次拿全,不用逐条链接翻。
    fetchAllMembers(
      apiKey,
      `/reports/${campaignId}/click-details`,
      (j) => (j.urls_clicked as unknown[]) ?? [],
    ).then(async (urls) => {
      const all: Array<Record<string, unknown>> = []
      for (const u of urls) {
        const id = (u as { id?: string }).id
        if (!id) continue
        const members = await fetchAllMembers(
          apiKey,
          `/reports/${campaignId}/click-details/${id}/members`,
          (j) => (j.members as unknown[]) ?? [],
        )
        all.push(...members)
      }
      return all
    }),
  ])

  return mergeActivity(
    openers as Array<{ email_address?: string; last_open?: string }>,
    clickers as Array<{ email_address?: string; timestamp?: string }>,
  )
}

/** `not_recipient` = the address was not sent this campaign; `hard` = it bounced and never arrived. */
export type CampaignRecipientStatus = 'sent' | 'soft' | 'hard' | 'not_recipient'

/**
 * 这个邮箱收到过这封群发吗（官方「Get campaign recipient info」：subscriber_hash = 小写邮箱的 MD5）。
 * 404 = 不是收件人；其它错误照常抛（调用方要把「查不了」当成「无法核实」，不能当成「没收到」）。
 * 返回了不认识的 status 时按 `sent` 算：宁可多数一封。
 */
export async function getCampaignRecipientStatus(
  apiKey: string,
  campaignId: string,
  email: string,
): Promise<CampaignRecipientStatus> {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex')
  try {
    const json = await call<{ status?: string }>(
      apiKey,
      `/reports/${encodeURIComponent(campaignId)}/sent-to/${hash}`,
    )
    return json.status === 'soft' || json.status === 'hard' ? json.status : 'sent'
  } catch (err) {
    if (err instanceof MailchimpError && err.status === 404) return 'not_recipient'
    throw err
  }
}

/** 一封邮件的一个收件人：Mailchimp 的发送状态（sent=已发出 / hard=永久退回 / soft=暂时退回）。 */
export interface CampaignRecipient {
  email: string
  status: 'sent' | 'hard' | 'soft' | 'other'
}

/**
 * 这封邮件发给了谁（含没打开的人）。
 *
 * 为什么要它：`getCampaignActivity` 只返回打开 / 点击过的人，收到了没打开的人一条都没有 ——
 * 于是每天早上的欢迎信在客人抽屉里永远看不到（2026-10-29 PM 发现）。
 *
 * 端点 `/reports/{id}/sent-to`，返回的数组字段叫 `sent_to`（不是 `members`，照搬 `members` 会静默拿到 0 条）；
 * 每人一行，**没有每个人各自的发送时间**，只能用整封邮件的发出时间。
 */
export async function getCampaignRecipients(
  apiKey: string,
  campaignId: string,
): Promise<CampaignRecipient[]> {
  const rows = await fetchAllMembers(apiKey, `/reports/${campaignId}/sent-to`, (j) => (j.sent_to as unknown[]) ?? [])
  const out: CampaignRecipient[] = []
  for (const r of rows as Array<{ email_address?: string; status?: string }>) {
    const email = (r.email_address ?? '').trim().toLowerCase()
    if (!email) continue
    const st = r.status === 'sent' || r.status === 'hard' || r.status === 'soft' ? r.status : 'other'
    out.push({ email, status: st })
  }
  return out
}

/** key 能不能用。配好之后先跑这个,别等同步时才发现 401。 */
export async function ping(apiKey: string): Promise<{ ok: true; account: string }> {
  const json = await call<{ account_name?: string }>(apiKey, '/')
  return { ok: true, account: json.account_name ?? '(未命名账户)' }
}

// ── 唯一的写入：把已同意的联系人订阅进 audience ──────────────────────────────

/**
 * `subscribeMember` 的结果 —— 显式区分四种，绝不折叠成布尔。
 *
 * • `subscribed`     ── HTTP 200/201，我们刚成功建了这个会员
 * • `already_member` ── 只认 Mailchimp 400 + title === 'Member Exists'。
 *                       **不 PATCH、不重新订阅** —— 如果他之前 unsubscribed，
 *                       就让他继续 unsubscribed；Welcome journey 不会重跑，
 *                       这是设计。
 * • `skipped`        ── 没到 Mailchimp（缺配置 / 缺邮箱 / 缺同意证据 / …）
 * • `failed`         ── 打了 Mailchimp 但对方错了（429/5xx/网络/超时/校验类）
 *
 * 上游拿到 `subscribed` 或 `already_member` 时可以把 `mailchimp_synced_at` 写
 * 进 contacts；`failed` 和 `skipped` 都不写 —— 观测列的语义是「audience 会员
 * 关系已确认」，不是「我们试过」。
 */
export type SubscribeMemberResult =
  | { status: 'subscribed' }
  | { status: 'already_member' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string; providerStatus?: number; retryable?: boolean }

export interface SubscribeMemberInput {
  apiKey: string
  audienceId: string
  /** 已归一（trim + toLowerCase）的邮箱。不是干净格式请上游拒绝，别落到这里。 */
  email: string
  firstName?: string | null
  lastName?: string | null
  /**
   * 写进 Mailchimp 的 `SOURCE` merge field（text 类型）。
   * ⚠️ 这条 merge field 必须先在 Mailchimp UI 里建好，否则 Mailchimp 会以
   *    「Invalid Resource / merge field does not exist」类 400 回错，本函数
   *    会如实返回 `failed`，不静默继续。这是 Ray external gate 2。
   */
  source: string
  /** audience tag。可选，用来在 Mailchimp 后台分组「哪批人是从哪条管道进来的」。 */
  tag?: string
  /**
   * 覆盖 fetch，测试用（默认走 globalThis.fetch）。生产不传。
   */
  fetchImpl?: typeof fetch
  /**
   * POST 的硬超时（毫秒）。生产走 `REQUEST_TIMEOUT_MS`（20s）—— 挂住的会员写
   * 请求会拖住整个串行 leads-sync；给一个明确上限，超时归成 retryable failed。
   * 测试可以传小值验证 abort 生效。
   */
  timeoutMs?: number
}

/**
 * 把已同意的一个联系人订阅进 audience。**只 POST，不做别的**。
 *
 * 失败/错误一律返回 `SubscribeMemberResult`，不 throw —— 上游是 lead 摄入
 * 的关键路径，Mailchimp 出错**不能**回滚 contact/触点写入（Issue #1188
 * 第 C 段硬约束）。
 *
 * 日志脱敏：只吐 status + 内部分类 reason；**不打邮箱、不打 provider body、
 * 不打 API key**。
 */
export async function subscribeMember(input: SubscribeMemberInput): Promise<SubscribeMemberResult> {
  // 缺配置就地拦下（本函数是共享出口，不假设上游一定检查过；两处兜一次）
  if (!input.apiKey || !input.apiKey.trim()) {
    return { status: 'skipped', reason: 'no_api_key' }
  }
  if (!input.audienceId || !input.audienceId.trim()) {
    return { status: 'skipped', reason: 'no_audience_id' }
  }
  const email = input.email.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'skipped', reason: 'invalid_email' }
  }

  let dc: string
  try {
    dc = datacenterFromKey(input.apiKey)
  } catch {
    // key 格式错在这里当 skipped 更诚实：我们连打都没打，不算 provider failure
    return { status: 'skipped', reason: 'bad_api_key_format' }
  }

  const merge_fields: Record<string, string> = {}
  if (input.firstName && input.firstName.trim()) merge_fields.FNAME = input.firstName.trim()
  if (input.lastName && input.lastName.trim()) merge_fields.LNAME = input.lastName.trim()
  merge_fields.SOURCE = input.source

  const body: Record<string, unknown> = {
    email_address: email,
    status: 'subscribed',
    merge_fields,
  }
  if (input.tag && input.tag.trim()) body.tags = [input.tag.trim()]

  const url = `https://${dc}.api.mailchimp.com/${API_VERSION}/lists/${encodeURIComponent(input.audienceId)}/members`
  const doFetch = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS

  let res: Response
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`me:${input.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // 硬上限：连着不回、DNS 掐、TLS 卡都被 AbortSignal 拉起来 —— leads-sync
      // 是串行遍历所有客户/表单的，一条 POST 卡住 = 之后全被拖走。
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    // 用鸭子测 name —— DOMException 在部分运行时不是 `instanceof Error`，
    // 只用 `err instanceof Error` 会漏掉 AbortSignal.timeout 抛出的 TimeoutError。
    const name = (err as { name?: unknown } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      // 超时 = 我们主动拉断了，Mailchimp 那头可能收到也可能没收到；语义上
      // 「未确认」，可重试。上层看到 retryable=true 时可以在下一次窗口内再打一次。
      return { status: 'failed', reason: 'timeout', retryable: true }
    }
    // 网络/DNS —— Mailchimp 那头是不是收到不重要，语义就是「没确认成功」
    return { status: 'failed', reason: 'network_error', retryable: true }
  }

  if (res.status === 200 || res.status === 201) {
    return { status: 'subscribed' }
  }

  // 400 里唯独 `Member Exists` 不算错；其它 400 都算真校验失败。
  if (res.status === 400) {
    const title = await safeReadTitle(res)
    if (title === 'Member Exists') {
      return { status: 'already_member' }
    }
    // 缺 SOURCE / 无效 merge field / 邮箱被 Mailchimp 拒 / … —— 数据本身的错，
    // 重试也没用，`retryable=false` 让上层不要盲刷。
    return { status: 'failed', reason: classify400(title), providerStatus: 400, retryable: false }
  }

  if (res.status === 401 || res.status === 403) {
    return { status: 'failed', reason: 'auth', providerStatus: res.status, retryable: false }
  }
  if (res.status === 404) {
    // audience id 不存在
    return { status: 'failed', reason: 'audience_not_found', providerStatus: 404, retryable: false }
  }
  if (res.status === 429) {
    return { status: 'failed', reason: 'rate_limited', providerStatus: 429, retryable: true }
  }
  if (res.status >= 500) {
    return { status: 'failed', reason: 'provider_5xx', providerStatus: res.status, retryable: true }
  }

  return { status: 'failed', reason: 'unexpected_status', providerStatus: res.status, retryable: false }
}

/**
 * 从 Mailchimp 的 4xx JSON 里取 `title`（例如 "Member Exists"）。**只读 title，
 * 不读 detail** —— detail 常常回显 email 或部分 payload，落日志会漏客户 PII。
 */
async function safeReadTitle(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { title?: unknown }
    return typeof json?.title === 'string' ? json.title : null
  } catch {
    return null
  }
}

/** 把 Mailchimp 400 的 title 归成一小把有限的 reason 码，方便查报表。 */
function classify400(title: string | null): string {
  if (!title) return 'validation'
  const t = title.toLowerCase()
  if (t.includes('merge field')) return 'missing_merge_field'
  if (t.includes('invalid resource')) return 'invalid_resource'
  return 'validation'
}
