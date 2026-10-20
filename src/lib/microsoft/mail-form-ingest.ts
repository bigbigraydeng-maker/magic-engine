/**
 * 网站表单通知邮件 → CRM 的接线层（识别/提取是纯函数，在 mail-form-notice.ts）。
 *
 * ## 为什么需要
 * 官网联系表单的通知邮件是**从公司自己的邮箱发给自己**的（发信服务 Resend，
 * Reply-To = 客人邮箱）。同步的 `classifySender` 看到「发件人是自家域」就整封跳过，
 * 于是真客人从网站表单来的咨询，在员工第一次回复之前 CRM 里完全看不见
 * （2026-10-19 CTS，Baker 测试单暴露；设计稿 docs/specs/2026-10-19-crm-web-form-enquiry-email-ingest-design.md）。
 *
 * ## 这一层做什么
 *  1. 初筛：收件箱方向 + 发件人就是本邮箱 + 主题以 `contact form:` 或 `tour enquiry:` 开头。
 *  2. 对候选**逐封单读**全文 / Reply-To / 邮件头（不加进每小时的列表读取），过
 *     `parseFormNotice`（认证头、Reply-To 与正文 Email 一致、只读头部区块）。
 *  3. 成功：把这封信的「对方」改写成客人，打上 `formLead`，**摘要换成不含电话/邮箱的一句话**
 *     （`storeThread` 会把 preview 原样存进库）。
 *  4. 失败：**这封不入库、不建人、不拦水位线**，只在回执里计数（原信仍在邮箱里，6 小时回看窗口
 *     内每小时会再试一次）。不存「待认人」会话 —— 存了水位线会越过它（子牙/魏征 2026-10-19 复审）。
 *  5. 单轮最多新建 FORM_NEW_PEOPLE_CAP 个新联系人，超过的按失败计数（防机器人批量提交）。
 *
 * 每轮都重新读候选，不做「已入库就不拉全文」的去重：第二轮起这封没被改写就会按
 * 自家域整条线程作废，员工后来的回复也跟着丢。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { mirrorWebFormLead } from '@/lib/crm/web-form-lead'
import { classifySender } from '@/lib/microsoft/mail-sender'
import { fetchFormNoticeSource, type FormNoticeSourceResult, type MailMessage } from '@/lib/microsoft/mail-graph'
import { isFormNoticeCandidate, parseFormNotice, type FormNoticeLead } from '@/lib/microsoft/mail-form-notice'

/** 单轮最多新建几个联系人（防机器人批量提交）。 */
export const FORM_NEW_PEOPLE_CAP = 20

/** 单轮最多对几封候选单读全文（防伪造邮件灌满邮箱后每小时串行打几千次 Graph）。 */
export const FORM_FETCH_CAP = 50

export interface FormEnquiryStats {
  /** 初筛命中几封。 */
  recognised: number
  /** 认证 + 提取成功几封。 */
  parsed: number
  /** 预计新建几个联系人（邮箱在系统里还不存在）。 */
  created: number
  /** 邮箱已属于已有联系人，只往他名下挂咨询（不改姓名；会刷新他的最后出现时间）。 */
  matched: number
  /** 表单里填的是自家域邮箱（员工测试单）—— 按「同事不建人」规则跳过。 */
  staffTest: number
  /** 没能入库几封（认证不过 / 提取失败 / 读取失败 / 超上限）。 */
  failed: number
  failedReasons: Record<string, number>
  /** 表单里填了出发时间/预算但映射不到稳定代码的封数（存 null，不乱存原文）。 */
  unknownExtras: number
}

export function emptyFormStats(): FormEnquiryStats {
  return { recognised: 0, parsed: 0, created: 0, matched: 0, staffTest: 0, failed: 0, failedReasons: {}, unknownExtras: 0 }
}

export interface FormIngestDeps {
  fetchSource: (token: string, messageId: string) => Promise<FormNoticeSourceResult>
  findContactByEmail: (clientId: string, email: string) => Promise<string | null>
}

async function defaultFindContactByEmail(clientId: string, email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id')
    .eq('client_id', clientId)
    .eq('kind', 'email')
    .eq('value', email)
    .maybeSingle()
  return (data?.contact_id as string | undefined) ?? null
}

const defaultDeps: FormIngestDeps = {
  fetchSource: fetchFormNoticeSource,
  findContactByEmail: defaultFindContactByEmail,
}

/** 入库用的一句话摘要：不含电话、不含邮箱。 */
function redactedPreview(lead: FormNoticeLead): string {
  const label = lead.kind === 'tour_enquiry' ? '网站团页表单' : '网站联系表单'
  return `${label}${lead.interest ? ` · ${lead.interest}` : ''}`
}

/** 改写成客人来信：对方是客人；摘要和主题都不含电话/邮箱/客人名。 */
function rewritten(m: MailMessage, lead: FormNoticeLead): MailMessage {
  return {
    ...m,
    subject: `${lead.kind === 'tour_enquiry' ? 'Tour enquiry' : 'Contact form'}${lead.interest ? `: ${lead.interest}` : ''}`,
    counterparty: { address: lead.email, name: lead.name },
    formLead: lead,
    preview: redactedPreview(lead),
  }
}

function bump(stats: FormEnquiryStats, reason: string): void {
  stats.failed += 1
  stats.failedReasons[reason] = (stats.failedReasons[reason] ?? 0) + 1
}

/**
 * 把一轮读回来的邮件里的「表单通知」改写成客人来信；认不出的丢掉并计数。
 * 其它邮件原样返回。
 */
export async function applyFormNotices(args: {
  token: string
  mailbox: string
  clientId: string
  ownDomains: string[]
  messages: MailMessage[]
  stats: FormEnquiryStats
  deps?: FormIngestDeps
}): Promise<MailMessage[]> {
  const deps = args.deps ?? defaultDeps
  const out: MailMessage[] = []
  let newPeople = 0
  let fetched = 0
  /** 被 Graph 限流（429/503）后本轮不再读剩余候选。 */
  let halted = false
  /** 本轮已经预估要新建的邮箱 —— 同一邮箱的第二封通知不再占名额。 */
  const newEmails = new Set<string>()

  for (const m of args.messages) {
    const candidate = isFormNoticeCandidate({
      direction: m.direction,
      subject: m.subject,
      fromAddress: m.counterparty?.address ?? null,
      mailbox: args.mailbox,
    })
    if (!candidate) {
      out.push(m)
      continue
    }
    args.stats.recognised += 1

    if (halted || fetched >= FORM_FETCH_CAP) {
      // 不读、不丢：原信仍在邮箱里，6 小时回看窗口内下一轮会再试。
      bump(args.stats, halted ? 'rate_limited_deferred' : 'fetch_cap_deferred')
      continue
    }
    fetched += 1
    const src = await deps.fetchSource(args.token, m.id)
    if (!src.ok) {
      bump(args.stats, src.status === 429 || src.status === 503 ? 'rate_limited' : 'fetch_error')
      if (src.status === 429 || src.status === 503) halted = true
      continue
    }
    const parsed = parseFormNotice({
      ownDomains: args.ownDomains,
      replyTo: src.source.replyTo,
      headers: src.source.headers,
      body: src.source.body,
    })
    if (!parsed.ok) {
      bump(args.stats, parsed.reason)
      continue
    }
    const lead = parsed.lead
    args.stats.parsed += 1
    if (lead.unknownExtras && lead.unknownExtras.length > 0) args.stats.unknownExtras += 1

    // 表单里填的是自家域邮箱 = 员工测试单：改写后交给 planMailIngest 按「同事不建人」跳过。
    const verdict = classifySender({ address: lead.email, ownDomains: args.ownDomains })
    if (verdict.kind === 'skip') {
      if (verdict.why === '公司内部邮箱') {
        args.stats.staffTest += 1
        out.push(rewritten(m, lead))
      } else {
        // 系统 / 机器人类地址（accounts@、noreply@ 等）：不是员工测试，单独计数。
        bump(args.stats, 'system_address')
      }
      continue
    }

    const existing = await deps.findContactByEmail(args.clientId, lead.email)
    if (existing) {
      args.stats.matched += 1
    } else if (newEmails.has(lead.email)) {
      // 同一邮箱本轮第二封：不重复计数，也不占名额。
      args.stats.matched += 1
    } else {
      if (newPeople >= FORM_NEW_PEOPLE_CAP) {
        bump(args.stats, 'over_cap')
        continue
      }
      newPeople += 1
      newEmails.add(lead.email)
      args.stats.created += 1
    }
    out.push(rewritten(m, lead))
  }
  return out
}

/** 触点 metadata 里附加的结构化事实：只存稳定代码，缺失的不写（不写 null、不当 0）。 */
export function formLeadMetadata(lead: FormNoticeLead): Record<string, string> | null {
  const m: Record<string, string> = {}
  if (lead.travelWindow) m.travel_window = lead.travelWindow
  if (lead.budgetBand) m.budget_band = lead.budgetBand
  return Object.keys(m).length > 0 ? m : null
}

/** 触点 raw 里放什么：兴趣 + 留言前 200 字。**不放电话、不放邮箱。** */
export function formLeadRaw(lead: FormNoticeLead): string {
  const parts = [lead.interest ? `兴趣: ${lead.interest}` : null, lead.message ? `留言: ${lead.message}` : null]
  return parts.filter(Boolean).join('\n')
}

/**
 * 给一条线程里的表单通知各建/匹配联系人并写一条 web_form 触点。
 * 复用 `mirrorWebFormLead`（reject 合并策略、不覆盖老客人姓名、按邮件 id 幂等）。
 * 只带邮箱一个身份 —— 电话不作为身份（带电话会让默认合并变危险）。
 * 返回线程该挂的联系人 id；`error` 一律抛出，让 syncMailbox 的「一条失败就停」接住。
 */
export async function mirrorFormThread(args: {
  clientId: string
  messages: Array<{ id: string; receivedAt: string; formLead?: FormNoticeLead }>
  mirror?: typeof mirrorWebFormLead
}): Promise<string | null> {
  const mirror = args.mirror ?? mirrorWebFormLead
  let contactId: string | null = null
  for (const m of args.messages) {
    if (!m.formLead) continue
    const res = await mirror({
      clientId: args.clientId,
      leadId: m.id,
      name: m.formLead.name,
      phone: null,
      email: m.formLead.email,
      message: formLeadRaw(m.formLead),
      sourceUrl: m.formLead.formUrl,
      submittedAt: m.receivedAt,
      metadata: formLeadMetadata(m.formLead),
    })
    if (res.skipped === 'error') throw new Error('网站表单咨询写入 CRM 失败')
    contactId = contactId ?? res.contactId
  }
  return contactId
}
