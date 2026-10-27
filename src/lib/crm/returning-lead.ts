import type { TouchpointLike } from './segments'

/** 哪些渠道算「客人自己填的咨询表单」。 */
export const FORM_CHANNELS: ReadonlySet<string> = new Set(['meta_lead_form', 'web_form'])

/** 两次入站至少隔多久，才算「之前就咨询过」（防同一天重复提交被当成回头客）。 */
export const MIN_GAP_MS = 24 * 3_600_000

export interface ReturningLead {
  /** 最早一次客人主动来找我们（表单 / 消息 / 点了我们邮件里的链接）。ISO。 */
  firstEnquiryAt: string
  /** 这次回头填的那张表。ISO。 */
  latestFormAt: string
  /** 我们（真人）最后一次联系他。ISO。 */
  ourLastContactAt: string
  /** 我们（真人）联系过他几次，不含机器发的、不含没人接的电话。 */
  ourContacts: number
  /** 这次之前他还填过几次表。 */
  earlierForms: number
}

export interface EngagementOverview {
  ours: {
    email: number
    phone: number
    phoneUnanswered: number
    messenger: number
    whatsapp: number
    other: number
    total: number
    lastAt: string | null
  }
  theirs: {
    forms: number
    messages: number
    clicks: number
    firstAt: string | null
    latestFormAt: string | null
    /** 他最近一次主动动作（表单 / 消息 / 点链接）。AI 概况比它旧，就要提醒「以最新为准」。 */
    lastAt: string | null
  }
}

/** 解析 ISO 时间，非法返回 NaN（调用方需自行过滤）。 */
function timeOf(t: TouchpointLike): number {
  return new Date(t.occurredAt).getTime()
}

/** 「真人动作」：没有 engagement、不是没人接的电话、不是按钮操作。 */
function isReal(t: TouchpointLike): boolean {
  if (t.engagement) return false
  if (t.unansweredCall) return false
  if (t.action) return false
  return true
}

/** 入站且算「客人主动」：真人动作，或点了我们邮件里的链接。 */
function isTheirsActive(t: TouchpointLike): boolean {
  if (t.direction !== 'inbound') return false
  return isReal(t) || t.engagement === 'click'
}

export function detectReturningLead(touches: readonly TouchpointLike[]): ReturningLead | null {
  // 1. 所有「真人填的表」
  const forms = touches.filter(
    (t) => isReal(t) && t.direction === 'inbound' && FORM_CHANNELS.has(t.channel) && !Number.isNaN(timeOf(t)),
  )
  if (forms.length === 0) return null

  let latestForm = forms[0]
  for (const f of forms) {
    if (timeOf(f) > timeOf(latestForm)) latestForm = f
  }
  const F = timeOf(latestForm)

  // 2. 我们（真人）发出的联系
  const ourReal = touches.filter(
    (t) => isReal(t) && t.direction === 'outbound' && !t.automated && !Number.isNaN(timeOf(t)),
  )
  if (ourReal.length === 0) return null

  let lastContact = ourReal[0]
  for (const o of ourReal) {
    if (timeOf(o) > timeOf(lastContact)) lastContact = o
  }
  const L = timeOf(lastContact)

  // 3. 表必须晚于我们最后一次联系
  if (F <= L) return null

  // 4. 之前是否有过更早的主动接触（表单 / 消息 / 点链接）
  const cutoff = F - MIN_GAP_MS
  const earlier = touches.filter((t) => isTheirsActive(t) && !Number.isNaN(timeOf(t)) && timeOf(t) <= cutoff)
  if (earlier.length === 0) return null

  let firstMs = timeOf(earlier[0])
  for (const e of earlier) {
    const ms = timeOf(e)
    if (ms < firstMs) firstMs = ms
  }

  // 5. 之前填过几次表（严格早于这次）
  const earlierForms = forms.filter((f) => timeOf(f) < F).length

  return {
    firstEnquiryAt: new Date(firstMs).toISOString(),
    latestFormAt: new Date(F).toISOString(),
    ourLastContactAt: new Date(L).toISOString(),
    ourContacts: ourReal.length,
    earlierForms,
  }
}

/** 归类我们发出的真人联系渠道。 */
function classifyOurs(channel: string, unanswered: boolean): keyof EngagementOverview['ours'] | null {
  if (channel === 'email') return 'email'
  if (channel === 'phone') return unanswered ? 'phoneUnanswered' : 'phone'
  if (channel === 'messenger') return 'messenger'
  if (channel === 'whatsapp') return 'whatsapp'
  return 'other'
}

export function summariseEngagement(touches: readonly TouchpointLike[]): EngagementOverview {
  const ours: EngagementOverview['ours'] = {
    email: 0,
    phone: 0,
    phoneUnanswered: 0,
    messenger: 0,
    whatsapp: 0,
    other: 0,
    total: 0,
    lastAt: null,
  }
  const theirs: EngagementOverview['theirs'] = {
    forms: 0,
    messages: 0,
    clicks: 0,
    firstAt: null,
    latestFormAt: null,
    lastAt: null,
  }

  let theirsLastMs = -Infinity
  let oursLastMs = -Infinity
  let theirsFirstMs = Infinity
  let latestFormMs = -Infinity

  for (const t of touches) {
    const ms = timeOf(t)
    const valid = !Number.isNaN(ms)

    // 我们发出的：非机器、非 engagement、非按钮
    if (t.direction === 'outbound' && !t.automated && !t.engagement && !t.action) {
      const key = classifyOurs(t.channel, t.unansweredCall === true)
      if (key) {
        ours[key] += 1
        ours.total += 1
        if (valid && ms > oursLastMs) oursLastMs = ms
      }
    }

    // 客人主动：入站真人动作，或点链接
    if (isTheirsActive(t)) {
      if (FORM_CHANNELS.has(t.channel)) {
        theirs.forms += 1
        if (valid && ms > latestFormMs) latestFormMs = ms
      } else if (t.engagement !== 'click') {
        // 点链接单独计数（下面），不能同时被算成「一条消息」
        theirs.messages += 1
      }
      if (valid && ms < theirsFirstMs) theirsFirstMs = ms
      if (valid && ms > theirsLastMs) theirsLastMs = ms
    }

    // 点链接单独计数（入站 + engagement click）
    if (t.direction === 'inbound' && t.engagement === 'click') {
      theirs.clicks += 1
    }
  }

  ours.lastAt = oursLastMs === -Infinity ? null : new Date(oursLastMs).toISOString()
  theirs.firstAt = theirsFirstMs === Infinity ? null : new Date(theirsFirstMs).toISOString()
  theirs.latestFormAt = latestFormMs === -Infinity ? null : new Date(latestFormMs).toISOString()
  theirs.lastAt = theirsLastMs === -Infinity ? null : new Date(theirsLastMs).toISOString()

  return { ours, theirs }
}

/** 取指定时区下的日历日（YYYY-MM-DD）。 */
function calendarDay(iso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date(iso))
}

/** 把 ISO 转成「今天 / 昨天 / M月D日」。 */
function formatDay(iso: string, now: Date, timeZone: string): string {
  const target = calendarDay(iso, timeZone)
  const today = calendarDay(now.toISOString(), timeZone)
  if (target === today) return '今天'

  const yesterday = new Date(now.getTime() - 24 * 3_600_000)
  if (target === calendarDay(yesterday.toISOString(), timeZone)) return '昨天'

  const [, m, d] = target.split('-')
  return `${Number(m)}月${Number(d)}日`
}

/** 一句话理由，给「今天要联系」列表用。 */
export function returningReason(info: ReturningLead, now: Date, timeZone = 'Pacific/Auckland'): string {
  const first = formatDay(info.firstEnquiryAt, now, timeZone)
  const latest = formatDay(info.latestFormAt, now, timeZone)
  return `回头了：${first}就咨询过，我们联系过 ${info.ourContacts} 次，${latest}又填了表，意向很强`
}

/** 抽屉顶部那条故事线，几个短句，按时间顺序。 */
export function returningStory(
  info: ReturningLead,
  overview: EngagementOverview,
  now: Date,
  timeZone = 'Pacific/Auckland',
): string[] {
  const lines: string[] = []

  const first = formatDay(info.firstEnquiryAt, now, timeZone)
  const extra = info.earlierForms > 0 ? `（之前填过 ${info.earlierForms} 次表）` : ''
  lines.push(`${first}就咨询过${extra}`)

  const o = overview.ours
  const parts: string[] = []
  if (o.email > 0) parts.push(`邮件 ${o.email} 封`)
  // 「拨过电话」而不是「电话 N 次」：历史导入的电话记录没带「没接」标记（2026-10-27 查一个真实客人时
  // 发现，6/15 那通其实没人接，却被数成了普通电话），写「电话 1 次」会让人以为通过话。
  // 「拨过」不管接没接都是对的。
  if (o.phone > 0) parts.push(`拨过电话 ${o.phone} 次`)
  if (o.phoneUnanswered > 0) parts.push(`电话没接 ${o.phoneUnanswered} 次`)
  if (o.messenger > 0) parts.push(`私信 ${o.messenger} 次`)
  if (o.whatsapp > 0) parts.push(`WhatsApp ${o.whatsapp} 次`)
  if (!(o.total === 0 && o.phoneUnanswered === 0) && parts.length > 0) {
    lines.push(`我们联系过：${parts.join('、')}`)
  }

  if (overview.theirs.clicks > 0) {
    lines.push(`他点过我们邮件里的链接 ${overview.theirs.clicks} 次`)
  }

  const latest = formatDay(info.latestFormAt, now, timeZone)
  lines.push(`🔥 ${latest}又填了表`)

  return lines
}

/** 表单下拉的原始代码 → 人话。 */
export function humanizeFormCode(code: string | null | undefined): string | null {
  if (code == null) return null
  const trimmed = code.trim()
  if (trimmed === '') return null

  if (!trimmed.includes('_')) {
    // 已经是人话（含空格）或单个词，原样返回
    return trimmed
  }

  const spaced = trimmed.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  if (spaced === '') return null
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** 把一整句里「· best_of_china_–_15_days」这种尾巴里的代码也翻成人话。 */
export function humanizeFormSummary(text: string | null | undefined): string | null {
  if (text == null) return null
  const trimmed = text.trim()
  if (trimmed === '') return null

  const sep = ' · '
  const idx = trimmed.lastIndexOf(sep)
  if (idx === -1) return trimmed

  const head = trimmed.slice(0, idx)
  const tail = trimmed.slice(idx + sep.length)
  if (!tail.includes('_') || tail.includes(' ')) return trimmed

  const human = humanizeFormCode(tail)
  if (human == null) return trimmed
  return `${head}${sep}${human}`
}

/**
 * 「往来一览」一行字，抽屉顶部用 —— 让人不用滚到最底下的往来记录，就知道**我们有没有联系过他**、
 * 他有没有回应（PM 2026-10-27：「看不出来我们是否发了邮件，但 AI 摘要里说的确实我们发过」）。
 *
 * 只写非零的项；两边都没有就返回 null（不显示，不凑一句空话）。
 */
export function engagementLine(overview: EngagementOverview): string | null {
  const o = overview.ours
  const ours: string[] = []
  if (o.email > 0) ours.push(`邮件 ${o.email} 封`)
  if (o.phone > 0) ours.push(`拨过电话 ${o.phone} 次`)
  if (o.phoneUnanswered > 0) ours.push(`电话没接 ${o.phoneUnanswered} 次`)
  if (o.messenger > 0) ours.push(`私信 ${o.messenger} 次`)
  if (o.whatsapp > 0) ours.push(`WhatsApp ${o.whatsapp} 次`)
  if (o.other > 0) ours.push(`其他 ${o.other} 次`)

  const t = overview.theirs
  const theirs: string[] = []
  if (t.forms > 0) theirs.push(`填过 ${t.forms} 次表`)
  if (t.messages > 0) theirs.push(`来过 ${t.messages} 次消息`)
  if (t.clicks > 0) theirs.push(`点过邮件链接 ${t.clicks} 次`)

  const parts: string[] = []
  if (ours.length > 0) parts.push(`我们联系过：${ours.join('、')}`)
  else parts.push('我们还没联系过')
  if (theirs.length > 0) parts.push(`他：${theirs.join('、')}`)
  if (ours.length === 0 && theirs.length === 0) return null
  return parts.join(' ｜ ')
}
