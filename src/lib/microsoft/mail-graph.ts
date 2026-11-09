/**
 * 从客户的邮箱里读信（Microsoft Graph）。
 *
 * 只读，不改客户的邮箱 —— 不标已读、不移动、不删除。授权时也只要了
 * `Mail.Read`，没要 `Mail.ReadWrite`（见 mail-oauth.ts）。
 *
 * ## 为什么分开读「收件箱」和「已发送」
 *
 * Graph 有个 `/me/messages` 能一次读全部文件夹，但那样就得靠比对发件人地址
 * 猜方向 —— 别名、转发、代发都会让这个猜法出错，而方向错了整条时间线就读不通
 * （客人的话被排成我们说的）。分两个文件夹读，方向是**由文件夹决定的事实**，
 * 不是推断。
 *
 * ## 三个会安静出错的地方
 *
 * 1. **分页**。Graph 一次最多给一页，剩下的在 `@odata.nextLink` 里。不翻页
 *    就会在忙的那天悄悄漏掉最新的信 —— 而且不会报错。
 * 2. **正文别拉全的**。一封带引用历史的邮件正文能有几十 KB，几百封就是几十兆
 *    进内存和数据库。这里只取 `bodyPreview`（Graph 给的纯文本摘要），
 *    时间线上要看全文再单独去拉。
 * 3. **水位线用 `receivedDateTime` 而不是 `sentDateTime`**。晚到的邮件
 *    （对方服务器延迟几小时）按发送时间算会直接跳过水位线，那封信永远读不到。
 * 4. **必须要 `Prefer: IdType="ImmutableId"`**。Graph 默认给的消息 id 在这封信
 *    换文件夹时会变——而「草稿变已发送」正是 `mail-send.ts` 从 CRM 回信时
 *    必经的那一步。不要这个请求头，`mail-send.ts` 存的 id 跟这里之后同步
 *    读到的 id 会对不上，那封刚发的信会在时间线上插出重复的一行——
 *    正是两边都想避免的那个问题，只是换个更隐蔽的方式重新发生
 *    （2026-09-15 子牙架构复审 PR #1714 揪出来的，见微软官方文档
 *    "Get Outlook mail, calendar, or contact IDs to remain the same"）。
 */

import type { FormNoticeLead } from './mail-form-notice'

const GRAPH = 'https://graph.microsoft.com/v1.0'

/** 一次要多少封。Graph 硬顶 999，取 50 是为了单次响应小、失败重试便宜。 */
const PAGE_SIZE = 50

/** 一次同步最多翻多少页 —— 防止历史邮箱把一次 cron 拖死。 */
const MAX_PAGES = 20

export type MailFolder = 'inbox' | 'sentitems'

export interface MailMessage {
  /** Graph 的消息 id。幂等键就是它。 */
  id: string
  /** 同一封往来的会话 id —— 我们的 conversations 直接用它串线。 */
  conversationId: string | null
  subject: string | null
  /** 纯文本摘要。要全文再单独去拉，不在同步里带。 */
  preview: string
  /** 收到（或发出）的时间。水位线用它。 */
  receivedAt: string
  /** 对方是谁 —— 收件箱取发件人，已发送取第一个收件人。 */
  counterparty: { address: string; name: string | null } | null
  direction: 'inbound' | 'outbound'
  /** 带附件吗 —— 付款截图/回单常常整封信只有一句「见附件」，正文判不出来。 */
  hasAttachment: boolean
  /**
   * 网站表单通知里提取出的客人（只有 syncMailbox 的预处理识别成功才会有）。
   * 有它时 counterparty 已被改写成这位客人，下游据此走「网站表单」分支。
   */
  formLead?: FormNoticeLead
}

interface GraphAddress {
  emailAddress?: { address?: string | null; name?: string | null } | null
}

interface RawMessage {
  id?: string
  conversationId?: string | null
  subject?: string | null
  bodyPreview?: string | null
  receivedDateTime?: string | null
  from?: GraphAddress | null
  sender?: GraphAddress | null
  toRecipients?: GraphAddress[] | null
  hasAttachments?: boolean | null
}

function pickAddress(a: GraphAddress | null | undefined): MailMessage['counterparty'] {
  const addr = a?.emailAddress?.address?.trim()
  if (!addr) return null
  return { address: addr.toLowerCase(), name: a?.emailAddress?.name?.trim() || null }
}

function toMessage(raw: RawMessage, direction: 'inbound' | 'outbound'): MailMessage | null {
  if (!raw.id || !raw.receivedDateTime) return null
  return {
    id: raw.id,
    conversationId: raw.conversationId ?? null,
    subject: raw.subject?.trim() || null,
    preview: (raw.bodyPreview ?? '').trim(),
    receivedAt: raw.receivedDateTime,
    // 收件箱：对方是发件人。已发送：对方是第一个收件人。
    // 抄送里的人不算「这封信是跟谁的往来」—— 那会把一封抄送给全公司的信
    // 变成十几个客人。
    counterparty:
      direction === 'inbound'
        ? pickAddress(raw.from ?? raw.sender)
        : pickAddress(raw.toRecipients?.[0]),
    direction,
    hasAttachment: raw.hasAttachments === true,
  }
}

export type FetchResult =
  | { ok: true; messages: MailMessage[]; truncated: boolean }
  | { ok: false; error: string }

/**
 * 读某个文件夹里、某个时间点之后的信。
 *
 * @param accessToken 已经确保有效的令牌（调用方走 token-manager 拿）。
 * @param folder      收件箱还是已发送 —— 方向由它决定，不靠猜。
 * @param since       只要这个时刻之后的。第一次同步时由调用方决定回溯多久。
 */
export async function fetchMailSince(
  accessToken: string,
  folder: MailFolder,
  since: Date,
): Promise<FetchResult> {
  const direction: 'inbound' | 'outbound' = folder === 'inbox' ? 'inbound' : 'outbound'
  const messages: MailMessage[] = []

  // 刻意不用 URLSearchParams：它把空格编成 `+`，而 OData 的 $filter / $orderby
  // 里 `+` 不保证被当成空格 —— 筛选条件可能整个失效，而且**不会报错**，
  // 只是把整个邮箱都拉回来（或者一封都不给）。用 %20 不赌服务器怎么解。
  const query = [
    // 只取用得上的字段。不写 $select 的话 Graph 会把整封正文一起塞回来。
    `$select=${encodeURIComponent('id,conversationId,subject,bodyPreview,receivedDateTime,from,sender,toRecipients,hasAttachments')}`,
    // 用 receivedDateTime：晚到的邮件按发送时间算会直接跳过水位线，永远读不到。
    `$filter=${encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)}`,
    // 从旧到新 —— 万一中途失败，下一次的水位线还能接着走，不留空洞。
    `$orderby=${encodeURIComponent('receivedDateTime asc')}`,
    `$top=${PAGE_SIZE}`,
  ].join('&')

  let url: string | null = `${GRAPH}/me/mailFolders/${folder}/messages?${query}`
  let pages = 0

  while (url && pages < MAX_PAGES) {
    pages += 1
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'IdType="ImmutableId"' },
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '读取邮箱失败' }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // 原样带回 Microsoft 说的话 —— 「权限不够」和「令牌过期」要分得清，
      // 吞成一句「同步失败」会让排查从五分钟变成一小时。
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
    }

    const data = (await res.json()) as { value?: RawMessage[]; '@odata.nextLink'?: string }
    for (const raw of data.value ?? []) {
      const m = toMessage(raw, direction)
      if (m) messages.push(m)
    }
    url = data['@odata.nextLink'] ?? null
  }

  // 还有下一页却已经翻到上限 —— 如实说出来。静默截断会让人以为已经读全了，
  // 而漏掉的正是最新的那些信。
  return { ok: true, messages, truncated: url !== null }
}

export interface MessageText {
  subject: string | null
  /** 纯文本全文（Graph 按 `outlook.body-content-type="text"` 转好的）。 */
  body: string
  /** 第一个收件人 —— 跟 `toMessage` 对已发送邮件取 counterparty 的口径一致。 */
  firstRecipient: { address: string; name: string | null } | null
  /** 收件人 + 抄送人总数。成交识别只在「恰好一个收件人」时才敢自动：抄送/多人的信，确认句不一定是对第一个人说的。 */
  recipientCount: number
}

export type MessageTextResult = { ok: true; message: MessageText } | { ok: false; error: string; status?: number }

/**
 * 按 message id 取一封信的完整纯文本正文。
 *
 * 同步（`fetchMailSince`）刻意只带 255 字摘要；付款确认句常在摘要之后，成交识别要读全文，
 * 所以这里单独提供「只取一封」的读法 —— 调用方只对要识别的信调用，不全量落库。
 * id 必须是同步时存下的 ImmutableId（同一个 `Prefer: IdType` 才认得）。
 */
export async function fetchMessageText(accessToken: string, messageId: string): Promise<MessageTextResult> {
  const select = encodeURIComponent('subject,body,toRecipients,ccRecipients')
  const url = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=${select}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
      },
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '读取邮件全文失败' }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
  }
  const raw = (await res.json()) as {
    subject?: string | null
    body?: { content?: string | null } | null
    toRecipients?: GraphAddress[] | null
    ccRecipients?: GraphAddress[] | null
  }
  return {
    ok: true,
    message: {
      subject: raw.subject?.trim() || null,
      body: raw.body?.content ?? '',
      firstRecipient: pickAddress(raw.toRecipients?.[0]),
      recipientCount: (raw.toRecipients?.length ?? 0) + (raw.ccRecipients?.length ?? 0),
    },
  }
}

export interface FormNoticeSource {
  body: string
  /** Reply-To 里的全部地址（小写）。 */
  replyTo: string[]
  headers: Array<{ name: string; value: string }>
}

export type FormNoticeSourceResult =
  | { ok: true; source: FormNoticeSource }
  | { ok: false; error: string; status?: number }

/**
 * 取一封「网站表单通知」的识别材料：纯文本全文 + Reply-To + 邮件头（认证结果、DKIM）。
 *
 * 为什么单独写、不改 `fetchMessageText` 也不放进列表读取：列表读取每小时对所有客户
 * 邮箱都跑，邮件头很大，加进去会拖慢全部邮箱；这里只对已经初筛出的那几封单封读取。
 */
export async function fetchFormNoticeSource(
  accessToken: string,
  messageId: string,
): Promise<FormNoticeSourceResult> {
  const select = encodeURIComponent('body,replyTo,internetMessageHeaders')
  const url = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=${select}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
      },
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '读取表单通知失败' }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
  }
  const raw = (await res.json()) as {
    body?: { content?: string | null } | null
    replyTo?: GraphAddress[] | null
    internetMessageHeaders?: Array<{ name?: string | null; value?: string | null }> | null
  }
  return {
    ok: true,
    source: {
      body: raw.body?.content ?? '',
      replyTo: (raw.replyTo ?? [])
        .map((a) => a?.emailAddress?.address?.trim().toLowerCase() ?? '')
        .filter(Boolean),
      headers: (raw.internetMessageHeaders ?? []).flatMap((h) =>
        h?.name && typeof h.value === 'string' ? [{ name: h.name, value: h.value }] : [],
      ),
    },
  }
}
