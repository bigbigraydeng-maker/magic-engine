/**
 * Client weekly browsing summary — delivery.
 *
 * Fail-closed by construction: this module can ONLY send to the internal
 * Magic Engine inbox as a "waiting for review" draft. Sending to a client is a
 * separate, explicitly authorised step that does not exist here yet — a
 * generated report never reaches a client on its own.
 */

import { Resend } from 'resend'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { renderWeeklyReportZh, type WeeklySummary } from './build'

export interface DraftReceipt {
  status: 'sent_to_internal_review' | 'not_configured' | 'failed'
  requestId: string
  clientLabel: string
  windowStart: string
  windowEnd: string
  /** Always true: nothing here ever publishes to a client. */
  noClientSend: true
  createdAt: string
  detail?: string
}

function errorDetail(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function sendWeeklyReportDraftToInternalReview(
  summary: WeeklySummary,
  requestId: string,
): Promise<DraftReceipt> {
  const { input } = summary
  const base: Omit<DraftReceipt, 'status' | 'detail'> = {
    requestId,
    clientLabel: input.clientLabel,
    windowStart: input.window.start,
    windowEnd: input.window.end,
    noClientSend: true,
    createdAt: new Date().toISOString(),
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ...base, status: 'not_configured', detail: 'RESEND_API_KEY missing' }

  const text = renderWeeklyReportZh(summary)
  const html =
    `<p><b>待审草稿：以下内容尚未发给客户。</b>审过后由人决定是否发出。</p>` +
    `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: meMailFrom('Magic Engine 客户周报'),
      to: [ME_MAIL_TO_ADDRESS],
      subject: `[待审] ${input.clientLabel.replace(/\s+/g, ' ')} 每周浏览总结 ${input.window.start} 至 ${input.window.end}`,
      html,
      text: `待审草稿：以下内容尚未发给客户。\n\n${text}`,
    })
    if (error) return { ...base, status: 'failed', detail: errorDetail(error) }
    return { ...base, status: 'sent_to_internal_review' }
  } catch (e) {
    return { ...base, status: 'failed', detail: errorDetail(e) }
  }
}
