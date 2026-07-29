/**
 * Mailchimp —— 只读取「谁收到了、谁打开了、谁点了链接」。
 *
 * 为什么要这些：销售一天打不完 297 个电话。但一批邮件发出去，三分之一的人
 * 会打开、一成多会点链接（CTS 近 90 天真实数据：打开率 20.8%–58.2%，
 * 点击率 0%–35.3%）—— **该打给谁，由他有没有反应决定**，不是由我们打没打过。
 *
 * 这个文件不发邮件、不改 Mailchimp 里的任何东西，只读。发送仍在 Mailchimp 里做。
 *
 * API key 的数据中心后缀就是 host：`abc123...-us14` → https://us14.api.mailchimp.com
 * 所以只需要一个环境变量，不用另配 region。
 */

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

async function call<T>(apiKey: string, path: string, params?: Record<string, string>): Promise<T> {
  const dc = datacenterFromKey(apiKey)
  const url = new URL(`https://${dc}.api.mailchimp.com/${API_VERSION}${path}`)
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v)

  const res = await fetch(url, {
    headers: {
      // Mailchimp 认 Basic，用户名随便填。
      Authorization: `Basic ${Buffer.from(`me:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
  })

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
  opts: { sinceSentAt?: string; count?: number } = {},
): Promise<MailchimpCampaign[]> {
  const params: Record<string, string> = {
    status: 'sent',
    sort_field: 'send_time',
    sort_dir: 'DESC',
    count: String(opts.count ?? 100),
  }
  if (opts.sinceSentAt) params.since_send_time = opts.sinceSentAt

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

/** key 能不能用。配好之后先跑这个,别等同步时才发现 401。 */
export async function ping(apiKey: string): Promise<{ ok: true; account: string }> {
  const json = await call<{ account_name?: string }>(apiKey, '/')
  return { ok: true, account: json.account_name ?? '(未命名账户)' }
}
