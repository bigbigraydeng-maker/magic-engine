/**
 * Form funnel from GA4: how many people started a form vs how many reached the
 * thank-you page. Pure summarising; the GA4 reads live in client.ts.
 *
 * The proxy is deliberately labelled a proxy: GA4 cannot join "started" to "submitted"
 * per person, and `generate_lead` has been shown to fire on pages with no form (CTS,
 * 2026-08-04: 341 "leads" vs 86 form starts), so it is reported but never used.
 */

export interface EventCounts {
  events: number
  users: number
}

export interface PathCounts {
  path: string
  events: number
  users: number
}

export interface FormFunnelRaw {
  periodStart: string
  periodEnd: string
  /** eventName → counts, for form_start / form_submit / generate_lead */
  events: Record<string, EventCounts>
  startByPath: PathCounts[]
  /** pages whose path contains "thank": views in `events`, people in `users` */
  thankYouByPath: PathCounts[]
}

export interface FormFunnelSummary {
  period: { start: string; end: string }
  formStart: EventCounts
  formSubmit: EventCounts
  /** reported for transparency only — known to over-fire, never used in the proxy */
  generateLeadUntrusted: EventCounts
  thankYou: EventCounts
  /** people who started a form minus people who reached a thank-you page (≥0), or null when not comparable */
  startedNotReachedThankYou: number | null
  /** startedNotReachedThankYou / form-start people (0..1), or null when not comparable */
  proxyAbandonRate: number | null
  startByPath: PathCounts[]
  thankYouByPath: PathCounts[]
  notes: string[]
}

const ZERO: EventCounts = { events: 0, users: 0 }

export function summariseFormFunnel(raw: FormFunnelRaw): FormFunnelSummary {
  const formStart = raw.events.form_start ?? ZERO
  const formSubmit = raw.events.form_submit ?? ZERO
  const generateLead = raw.events.generate_lead ?? ZERO
  const thankYou: EventCounts = raw.thankYouByPath.reduce(
    (acc, p) => ({ events: acc.events + p.events, users: acc.users + p.users }),
    { events: 0, users: 0 },
  )
  const notes: string[] = [
    '这是代理估算，不是精确放弃率：谷歌分析没法把"开始填表的人"和"到感谢页的人"逐人对上；到感谢页但没触发开始填表（比如换设备、别的入口）会让估算偏乐观。',
    'generate_lead（产生线索）事件在本站曾被证实在没有表单的页面也触发，只列出，不参与计算。',
  ]
  let started: number | null = null
  let rate: number | null = null
  if (formStart.users === 0) {
    notes.push('这段时间没有 form_start 记录：可能没人动表单，也可能网站没开"增强测量"的表单事件，不能当作"没人放弃"。')
  } else if (thankYou.users > formStart.users) {
    notes.push('到过感谢页的人比开始填表的人还多，两个数不能直接相减（有表单没触发开始填表事件，或感谢页被别的流程访问）。')
  } else {
    started = formStart.users - thankYou.users
    rate = started / formStart.users
  }
  return {
    period: { start: raw.periodStart, end: raw.periodEnd },
    formStart, formSubmit, generateLeadUntrusted: generateLead, thankYou,
    startedNotReachedThankYou: started, proxyAbandonRate: rate,
    startByPath: raw.startByPath, thankYouByPath: raw.thankYouByPath, notes,
  }
}
