// Port of website/functions/api/report.js email parts.
// Every interpolated value goes through safe()/escapeHtml; no links come from site content.

import { meMailFrom } from '@/lib/email/sender'
import { defangLinks, escapeHtml } from './guards'
import type { StoredFindings } from './leads'

const LAB_URL = 'https://magicengine.com.au/cn/lab/'

const SEVERITY: Record<'en' | 'zh', Record<'NOW' | 'GAP' | 'GOOD', [string, string]>> = {
  en: { NOW: ['#E07B39', 'Act now'], GAP: ['#BE8A2E', 'Gap found'], GOOD: ['#1F7A55', 'Looking good'] },
  zh: { NOW: ['#E07B39', '先改这条'], GAP: ['#BE8A2E', '可以补上'], GOOD: ['#1F7A55', '做得好'] },
}

function siteLabel(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

/** Text from the site or the model: links defanged (mail clients auto-link bare domains), then HTML-escaped. */
function safe(value: unknown): string {
  return escapeHtml(defangLinks(value))
}

interface EmailCopy {
  subject: string
  hello: string
  intro: string
  heading: string
  outro: string
  footer: string
  html: string
}

function copyFor(lang: 'en' | 'zh', site: string, fromAnswers: boolean, count: number): EmailCopy {
  if (lang === 'zh') {
    return {
      subject: `你的网站诊断结果：共 ${count} 条建议 · Magic Engine`,
      hello: '你好，', 
      intro: fromAnswers
        ? '这是 Magic Engine 根据你填写的业务介绍写的免费建议（我们没有看过网站），按重要程度排好了。'
        : `这是 Magic Engine 对 ${safe(site)} 首页的免费诊断，按「最影响客户联系你」的顺序排好了。`,
      heading: '诊断结果',
      outro: '看完不知道先改哪条？直接回复这封邮件跟我们聊，可以用中文。',
      footer: `你收到这封邮件，是因为你在 Magic Engine 工具实验室（${LAB_URL}）用了免费网站诊断。`,
      html: 'zh-CN',
    }
  }
  return {
    subject: `Your website check — ${count} findings · Magic Engine`,
    hello: 'Hi there,',
    intro: fromAnswers
      ? "Here is Magic Engine's free advice based on the business details you entered (we did not look at a website)."
      : `Here is Magic Engine's free check of the ${safe(site)} homepage, most important first.`,
    heading: 'Your findings',
    outro: 'Not sure where to start? Just reply to this email.',
    footer: 'You received this because you ran the free website check at magicengine.com.au.',
    html: 'en',
  }
}

function renderItems(findings: StoredFindings['findings'], lang: 'en' | 'zh'): string {
  const sev = SEVERITY[lang]
  return findings.map((x) => {
    const [colour, label] = sev[x.severity] ?? sev.GAP
    const where = x.where
      ? `<div style="font-size:12px;color:#888;margin-top:6px;">${lang === 'zh' ? '在哪里看到：' : 'Seen on: '}${safe(x.where)}</div>`
      : ''
    return `<div style="border:1px solid rgba(22,24,29,.08);border-radius:12px;padding:16px 18px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:${colour};margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:15px;font-weight:700;color:#16181D;margin-bottom:6px;">${safe(x.title)}</div>
      <div style="font-size:14px;color:#555;line-height:1.65;">${safe(x.desc)}</div>
      ${x.fix ? `<div style="font-size:14px;color:#16181D;line-height:1.65;margin-top:8px;"><strong>${lang === 'zh' ? '怎么改：' : 'What to do: '}</strong>${safe(x.fix)}</div>` : ''}
      ${where}
    </div>`
  }).join('')
}

function renderBody(t: EmailCopy, summary: string, items: string): string {
  return `<!DOCTYPE html>
<html lang="${t.html}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Magic Engine</title></head>
<body style="margin:0;padding:0;background:#F0EFE9;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFE9;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#16181D;border-radius:18px 18px 0 0;padding:28px 36px;"><div style="font-size:22px;font-weight:700;color:#FBFAF7;">Magic Engine</div></td></tr>
<tr><td style="background:#FBFAF7;padding:32px 36px;border-radius:0 0 18px 18px;">
<p style="font-size:15px;color:#16181D;margin:0 0 8px;">${t.hello}</p>
<p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 24px;">${t.intro}</p>
${summary}
<h2 style="font-size:18px;font-weight:700;color:#16181D;margin:0 0 14px;">${t.heading}</h2>
${items}
<p style="font-size:15px;color:#16181D;line-height:1.7;margin:24px 0 0;">${t.outro}</p>
<hr style="border:none;border-top:1px solid rgba(22,24,29,.08);margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.6;margin:0;">${escapeHtml(t.footer)}</p>
</td></tr></table></td></tr></table></body></html>`
}

/** Exported for tests. Every interpolated value goes through safe()/escapeHtml; no links come from site content. */
export function buildEmail(lead: { url: string; findings: StoredFindings }): { subject: string; body: string } {
  const f = lead.findings
  const lang: 'en' | 'zh' = f.lang === 'zh' ? 'zh' : 'en'
  const findings = Array.isArray(f.findings) ? f.findings : []
  const site = siteLabel(lead.url) || (lang === 'zh' ? '你的业务' : 'your business')
  const fromAnswers = f.source === 'answers'
  const t = copyFor(lang, site, fromAnswers, findings.length)
  const summary = f.summary
    ? `<div style="background:#FBF5E8;border-radius:12px;padding:16px 20px;margin-bottom:24px;font-size:14px;color:#9A6F1E;line-height:1.65;">${safe(f.summary)}</div>`
    : ''
  const items = renderItems(findings, lang)
  return { subject: t.subject, body: renderBody(t, summary, items) }
}

export interface SendReportEmailInput {
  to: string
  subject: string
  html: string
  idempotencyKey: string
}

export async function sendReportEmail({ to, subject, html, idempotencyKey }: SendReportEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('email not configured')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    // One email per lead even if we retry after an ambiguous failure (provider-side de-duplication).
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': `site-check-report-${idempotencyKey}`,
    },
    body: JSON.stringify({ from: meMailFrom('Magic Engine'), to, subject, html, reply_to: 'hello@magicengine.cloud' }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`email ${res.status}`)
}
