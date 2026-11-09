/**
 * 客户知识库 —— 确认邀请邮件 + 确认回执邮件（issue #1646）。
 *
 * 结构照 `portal-invite.ts`：同一个 Resend 客户端、同一个 `meMailFrom()` 发
 * 件人（`hello@magicengine.cloud`，2026-07-24 事故后统一的已验证域名地址）、
 * 同一个可注入的 `EmailSender` 抽象，好让测试不用真发信。不另起一套发信机制。
 *
 * 🔴 文案约束（design doc §9.10，板桥的客户体验修正）：
 *   - 收件人是客户公司的老板/经理，不是技术人员。整封信里不出现任何字段名。
 *   - 每条说法用「AI 以后会这样回复顾客：……」开头，让他一眼知道自己在确认
 *     的是"AI 会对顾客说什么"，不是"数据库里某条记录"。
 *   - 按钮旁边固定一句责任说明，逐字用设计稿给的那句，不重写。
 */

import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'

/** §9.10 逐字采用的责任说明。页面和邮件共用同一个常量，避免两处措辞各自漂移。 */
export const CONFIRMATION_RESPONSIBILITY_NOTE =
  '确认后 AI 会按这个说法回复顾客。价格有变请在这里改，改之前 AI 会继续用这个价。'

/** §9.10：客户改了内容要回 ME 再批一次，页面和邮件都要把这句话说清楚。 */
export const CONFIRMATION_CHANGE_LEAD_TIME_NOTE = '改动约 1 个工作日后生效。'

/**
 * §9.10「对客一句话」——设计稿逐字给定，之前只落进了责任说明附近的代码
 * 注释里，没有真的出现在客户看到的页面或邮件正文上（板桥客户体验复审
 * 2026-09-14 抓到）。这里补上，页面和邀请邮件共用同一个常量。
 */
export const CONFIRMATION_QUALITY_ASSURANCE_NOTE =
  'AI 客服报的价跟你们最好的员工一样准，每个价格都经过你点头；报价口径乱了，我们先提醒你。'

export interface KnowledgeConfirmationEmailInput {
  to: string
  clientName: string
  /** 客户要确认的那几句话（已经是给顾客看的说法，不含任何字段名）。 */
  statements: string[]
  /** 完整确认链接（含一次性令牌）。 */
  confirmUrl: string
  expiresAt: string
}

export interface KnowledgeEmailResult {
  sent: boolean
  reason?: string
}

function sanitizeHeader(s: string, maxLen = 120): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDay(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  const d = new Date(parsed)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// ── 1. 确认邀请 ──────────────────────────────────────────────────────────────

function requestText(input: KnowledgeConfirmationEmailInput): string {
  return [
    '你好：',
    '',
    `我们整理了 ${input.statements.length} 条「AI 以后会怎么回复顾客」的说法，想请你过一遍。`,
    '每一条你都可以单独说「对」或者「要改」。没确认的那几条，AI 遇到会转给你们的人，不会自己乱答。',
    '',
    '点这个链接打开确认页（打开只是看，点了页面上的按钮才算数）：',
    input.confirmUrl,
    '',
    `这个链接 ${formatDay(input.expiresAt)} 前有效。`,
    '',
    CONFIRMATION_RESPONSIBILITY_NOTE,
    '',
    CONFIRMATION_QUALITY_ASSURANCE_NOTE,
    '',
    '有问题直接回这封邮件。',
    '',
    '— Magic Engine',
  ].join('\n')
}

function requestHtml(input: KnowledgeConfirmationEmailInput): string {
  const preview = input.statements
    .slice(0, 5)
    .map((s) => `<li style="margin-bottom:8px">AI 以后会这样回复顾客：${escapeHtml(s)}</li>`)
    .join('')
  const more =
    input.statements.length > 5
      ? `<p style="color:#666;font-size:13px">还有 ${input.statements.length - 5} 条，都在确认页上。</p>`
      : ''
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
<p>你好：</p>
<p>我们整理了 <strong>${input.statements.length} 条</strong>「AI 以后会怎么回复顾客」的说法，想请你过一遍。每一条你都可以单独说「对」或者「要改」。</p>
<ul style="padding-left:20px">${preview}</ul>
${more}
<p style="margin:24px 0">
  <a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#B8863A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">打开确认页 →</a>
</p>
<p style="color:#666;font-size:13px">打开只是看一眼，点了页面上的按钮才算确认。链接 ${escapeHtml(formatDay(input.expiresAt))} 前有效。</p>
<p style="color:#2a2a2a;font-size:13px;background:#faf6ef;border-left:3px solid #B8863A;padding:10px 12px">${escapeHtml(CONFIRMATION_RESPONSIBILITY_NOTE)}</p>
<p style="color:#2a2a2a;font-size:13px;background:#faf6ef;border-left:3px solid #B8863A;padding:10px 12px">${escapeHtml(CONFIRMATION_QUALITY_ASSURANCE_NOTE)}</p>
<p style="color:#888;font-size:13px;margin-top:32px">有问题直接回这封邮件。<br>— Magic Engine</p>
</body></html>`
}

export async function sendKnowledgeConfirmationRequest(
  input: KnowledgeConfirmationEmailInput,
  deps: { resendApiKey?: string; sender?: EmailSender } = {},
): Promise<KnowledgeEmailResult> {
  if (!input.confirmUrl) return { sent: false, reason: 'confirmUrl is required' }
  const sender = resolveSender(deps)
  if (!sender) return { sent: false, reason: 'RESEND_API_KEY not configured' }

  const { error } = await sender.send({
    from: meMailFrom('Magic Engine'),
    to: input.to,
    subject: `请确认：${sanitizeHeader(input.clientName)} 的 AI 回复说法（${input.statements.length} 条）`,
    text: requestText(input),
    html: requestHtml(input),
  })
  if (error) return { sent: false, reason: error }
  return { sent: true }
}

// ── 2. 确认回执 ──────────────────────────────────────────────────────────────

export interface KnowledgeConfirmationReceiptInput {
  to: string
  clientName: string
  confirmedStatements: string[]
  /** 客户点了「需要修改」的那几条。 */
  changeRequestedStatements: string[]
  /** 发链接之后被我们改过、这次没收进去的那几条 —— 我们会重发一条新链接。 */
  needsFreshLinkCount: number
  confirmedAt: string
}

function receiptLines(input: KnowledgeConfirmationReceiptInput): string[] {
  const lines = ['你好：', '', `这是你刚才在 ${input.clientName} 确认页上的操作回执，留个底。`, '']
  if (input.confirmedStatements.length > 0) {
    lines.push(`✅ 你确认了 ${input.confirmedStatements.length} 条，AI 从现在起会按这些说法回复顾客：`)
    input.confirmedStatements.forEach((s) => lines.push(`   · ${s}`))
    lines.push('')
  }
  if (input.changeRequestedStatements.length > 0) {
    lines.push(`✏️ 你提出 ${input.changeRequestedStatements.length} 条需要改。这几条 AI 不会说，遇到会转给你们的人：`)
    input.changeRequestedStatements.forEach((s) => lines.push(`   · ${s}`))
    lines.push(`   ${CONFIRMATION_CHANGE_LEAD_TIME_NOTE}`)
    lines.push('')
  }
  if (input.needsFreshLinkCount > 0) {
    lines.push(
      `⏳ 有 ${input.needsFreshLinkCount} 条在你打开链接之后我们这边改动过，为了不让你确认到你没看过的版本，这次没有收进去。我们会重发一条新链接给你。`,
    )
    lines.push('')
  }
  lines.push('想改主意随时回这封邮件说一声，我们改回来。', '', '— Magic Engine')
  return lines
}

export async function sendKnowledgeConfirmationReceipt(
  input: KnowledgeConfirmationReceiptInput,
  deps: { resendApiKey?: string; sender?: EmailSender } = {},
): Promise<KnowledgeEmailResult> {
  const sender = resolveSender(deps)
  if (!sender) return { sent: false, reason: 'RESEND_API_KEY not configured' }

  const text = receiptLines(input).join('\n')
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px"><pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre></body></html>`

  const { error } = await sender.send({
    from: meMailFrom('Magic Engine'),
    to: input.to,
    subject: `确认回执：${sanitizeHeader(input.clientName)}（${input.confirmedStatements.length} 条已确认）`,
    text,
    html,
  })
  if (error) return { sent: false, reason: error }
  return { sent: true }
}

// ── Sender 抽象（照抄 portal-invite.ts，让测试不用真发信）─────────────────────

export interface EmailSender {
  send(params: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ error?: string }>
}

function resolveSender(deps: { resendApiKey?: string; sender?: EmailSender }): EmailSender | null {
  if (deps.sender) return deps.sender
  const apiKey = deps.resendApiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new ResendSender(apiKey)
}

class ResendSender implements EmailSender {
  private readonly client: Resend
  constructor(apiKey: string) {
    // SDK 客户端在函数内部初始化，不在模块顶层（CLAUDE.md §7）。
    this.client = new Resend(apiKey)
  }
  async send(params: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }): Promise<{ error?: string }> {
    const { error } = await this.client.emails.send(params)
    if (error) return { error: error.message ?? String(error) }
    return {}
  }
}
