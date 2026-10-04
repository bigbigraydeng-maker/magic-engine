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
  /** pages whose path contains "thank": views in `events`, people in `users` (people NOT de-duplicated across paths) */
  thankYouByPath: PathCounts[]
  /** de-duplicated people / views across every matched thank-you page */
  thankYouTotal: EventCounts
}

export interface FormFunnelSummary {
  /** One plain sentence first — the number below is a rough proxy, not an exact abandonment rate. */
  plain: string
  period: { start: string; end: string }
  formStart: EventCounts
  formSubmit: EventCounts
  /** reported for transparency only — known to over-fire, never used in the proxy */
  generateLeadUntrusted: EventCounts
  thankYou: EventCounts
  /** people who started a form minus people who reached a thank-you page (≥0), or null when not comparable */
  startedNotReachedThankYou: number | null
  /** startedNotReachedThankYou / form-start people (0..1), or null when not comparable. ROUGH ONLY — see plain / notes. */
  roughAbandonShare_ROUGH_ONLY: number | null
  startByPath: PathCounts[]
  thankYouByPath: PathCounts[]
  notes: string[]
}

const ZERO: EventCounts = { events: 0, users: 0 }

/** Paths can carry odd text; keep what is shown short. */
const clip = (p: PathCounts): PathCounts => ({ ...p, path: p.path.split('?')[0].slice(0, 80) })

export function summariseFormFunnel(raw: FormFunnelRaw): FormFunnelSummary {
  const formStart = raw.events.form_start ?? ZERO
  const formSubmit = raw.events.form_submit ?? ZERO
  const generateLead = raw.events.generate_lead ?? ZERO
  const thankYou: EventCounts = raw.thankYouTotal
  const notes: string[] = [
    '这是粗估，方向不确定，不是精确放弃率。会抬高估算的：form_start 在站内所有表单都会触发（搜索框、订阅框、登录框），这些人本来就不会去感谢页。会压低估算的：路径里含 thank 的页面都算"到过感谢页"（订阅感谢页、预订确认页、名字里带 thank 的文章）；跨设备的人也可能对不上。两边偏差方向相反，净结果无法预判。',
    '请核对下面列出的每个感谢页路径是不是真的"提交成功页"；不是的话这个数不能用。',
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
  const plain = rate === null
    ? `这段时间无法给出放弃的粗估（开始填表约 ${formStart.users} 人，到过感谢页约 ${thankYou.users} 人，两个数对不上，见说明）。`
    : `粗估：开始填表约 ${formStart.users} 人，到过感谢页约 ${thankYou.users} 人，约 ${Math.round(rate * 100)}% 的人动了表单但没到感谢页——方向不确定，不是精确放弃率。`
  return {
    plain,
    period: { start: raw.periodStart, end: raw.periodEnd },
    formStart, formSubmit, generateLeadUntrusted: generateLead, thankYou,
    startedNotReachedThankYou: started, roughAbandonShare_ROUGH_ONLY: rate,
    startByPath: raw.startByPath.map(clip), thankYouByPath: raw.thankYouByPath.map(clip), notes,
  }
}
