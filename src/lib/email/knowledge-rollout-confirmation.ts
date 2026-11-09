/**
 * 客户知识库 —— 阶段切换确认邀请邮件（issue #1648）。
 *
 * 结构照 `knowledge-confirmation.ts`（issue #1646）：同一个 Resend 客户端、
 * 同一个 `meMailFrom()` 发件人、同一个可注入的 `EmailSender` 抽象。这封信比
 * 那封简单很多——只有一件事要客户确认（"要不要往下走一段"），不是一批
 * 条目逐条确认，所以不需要 §9.10 那一整套分组/冲突提示逻辑。
 *
 * 🔴 板桥客户体验复审明确要求（issue #1648）："阶段号别裸给客户看"——邮件
 * 正文只用 `ROLLOUT_STAGE_LABELS` 给的大白话名字，绝不出现 "stage 1" /
 * "阶段 1" 这种代号。
 */

import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'
import type { KnowledgeRolloutStage } from '@/lib/knowledge/rollout'
import { ROLLOUT_STAGE_LABELS } from '@/lib/knowledge/rollout'

export interface KnowledgeRolloutConfirmationEmailInput {
  to: string
  clientName: string
  fromStage: KnowledgeRolloutStage
  toStage: KnowledgeRolloutStage
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

function requestText(input: KnowledgeRolloutConfirmationEmailInput): string {
  const fromLabel = ROLLOUT_STAGE_LABELS[input.fromStage]
  const toLabel = ROLLOUT_STAGE_LABELS[input.toStage]
  return [
    '你好：',
    '',
    `我们想把「${input.clientName}」的 AI 客服从${fromLabel}推进到${toLabel}，需要你确认一下才能往下走。`,
    '',
    '点这个链接打开确认页（打开只是看，点了页面上的按钮才算数）：',
    input.confirmUrl,
    '',
    `这个链接 ${formatDay(input.expiresAt)} 前有效。`,
    '',
    '有问题直接回这封邮件。',
    '',
    '— Magic Engine',
  ].join('\n')
}

function requestHtml(input: KnowledgeRolloutConfirmationEmailInput): string {
  const fromLabel = ROLLOUT_STAGE_LABELS[input.fromStage]
  const toLabel = ROLLOUT_STAGE_LABELS[input.toStage]
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
<p>你好：</p>
<p>我们想把「${escapeHtml(input.clientName)}」的 AI 客服从<strong>${escapeHtml(fromLabel)}</strong>推进到<strong>${escapeHtml(toLabel)}</strong>，需要你确认一下才能往下走。</p>
<p style="margin:24px 0">
  <a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#B8863A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">打开确认页 →</a>
</p>
<p style="color:#666;font-size:13px">打开只是看一眼，点了页面上的按钮才算确认。链接 ${escapeHtml(formatDay(input.expiresAt))} 前有效。</p>
<p style="color:#888;font-size:13px;margin-top:32px">有问题直接回这封邮件。<br>— Magic Engine</p>
</body></html>`
}

export async function sendKnowledgeRolloutConfirmationRequest(
  input: KnowledgeRolloutConfirmationEmailInput,
  deps: { resendApiKey?: string; sender?: EmailSender } = {},
): Promise<KnowledgeEmailResult> {
  if (!input.confirmUrl) return { sent: false, reason: 'confirmUrl is required' }
  const sender = resolveSender(deps)
  if (!sender) return { sent: false, reason: 'RESEND_API_KEY not configured' }

  const { error } = await sender.send({
    from: meMailFrom('Magic Engine'),
    to: input.to,
    subject: `请确认：${sanitizeHeader(input.clientName)} 的 AI 客服阶段切换`,
    text: requestText(input),
    html: requestHtml(input),
  })
  if (error) return { sent: false, reason: error }
  return { sent: true }
}

// ── Sender 抽象（照抄 knowledge-confirmation.ts，让测试不用真发信）─────────

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
