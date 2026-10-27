import type { TouchpointLike } from './segments'
import { FORM_CHANNELS, humanizeFormCode, formatDay, type ReturningLead } from './returning-lead'

/** 一条触点 + 它带的「团意向」（表单下拉的原始代码）。 */
export type JourneyTouch = TouchpointLike & { tour?: string | null }

export type JourneyActor = 'customer' | 'us'
export type JourneyKind =
  | 'form'
  | 'message'
  | 'click'
  | 'email'
  | 'phone'
  | 'phone_unanswered'
  | 'messenger'
  | 'whatsapp'
  | 'other'

export interface JourneyNode {
  /** 这一组里最早一条的 ISO 时间。 */
  at: string
  /** 「今天 / 昨天 / M月D日」，给界面直接显示。 */
  dayLabel: string
  actor: JourneyActor
  kind: JourneyKind
  /** 一句中文，例如「客人填表」「我们发了邮件」。不含次数。 */
  label: string
  /** 补充信息：表单节点放「想选：<人话团名>」，其余 null。 */
  detail: string | null
  /** 同一天、同一方、同一种动作合并后的次数，至少 1。 */
  count: number
  /** 是不是「这次回头填的那张表」（整条路线里最晚的一张表）。 */
  highlight: boolean
}

export type JourneyItem =
  | { type: 'node'; node: JourneyNode }
  | { type: 'gap'; days: number; label: string }
  | { type: 'omitted'; count: number; label: string }

export interface Journey {
  items: JourneyItem[]
  /** 合并之后一共多少个节点（省略之前）。 */
  totalNodes: number
  /** 「为什么说他热」的小标签，从事实推出来，没有分数。 */
  reasons: string[]
  /** 这次选的团和上次表单选的不一样时给出来；否则 null。 */
  tourChange: { from: string; to: string } | null
}

const DEFAULT_TIME_ZONE = 'Pacific/Auckland'
const DEFAULT_MAX_NODES = 12
const DAY_MS = 86_400_000
const GAP_THRESHOLD_DAYS = 14
const SILENCE_THRESHOLD_DAYS = 30

/** 把天数说成人话：60 天以内按天，否则按月。 */
function span(days: number): string {
  if (days < 60) return `${days} 天`
  return `约 ${Math.round(days / 30)} 个月`
}

/** 用指定时区取日历日（en-CA 输出 YYYY-MM-DD）。 */
function calendarDay(iso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date(iso))
}

/** 判断这条触点是否要丢掉。 */
function isDropped(touch: JourneyTouch): boolean {
  if (Number.isNaN(Date.parse(touch.occurredAt))) return true
  if (touch.engagement === 'open') return true
  if (touch.action != null) return true
  if (touch.direction === 'outbound' && touch.automated === true) return true
  return false
}

interface Mapped {
  actor: JourneyActor
  kind: JourneyKind
  label: string
}

/** 把 inbound 触点映射成 (actor, kind, label)。 */
function mapInbound(touch: JourneyTouch): Mapped {
  if (FORM_CHANNELS.has(touch.channel) && touch.engagement == null) {
    return { actor: 'customer', kind: 'form', label: '客人填表' }
  }
  if (touch.engagement === 'click') {
    return { actor: 'customer', kind: 'click', label: '客人点了我们邮件里的链接' }
  }
  switch (touch.channel) {
    case 'email':
      return { actor: 'customer', kind: 'message', label: '客人回了邮件' }
    case 'messenger':
      return { actor: 'customer', kind: 'message', label: '客人发了私信' }
    case 'whatsapp':
      return { actor: 'customer', kind: 'message', label: '客人发了 WhatsApp' }
    case 'phone':
      return { actor: 'customer', kind: 'message', label: '客人打来电话' }
    default:
      return { actor: 'customer', kind: 'message', label: '客人来了消息' }
  }
}

/** 把 outbound 触点映射成 (actor, kind, label)。 */
function mapOutbound(touch: JourneyTouch): Mapped {
  if (touch.channel === 'phone') {
    if (touch.unansweredCall === true) {
      return { actor: 'us', kind: 'phone_unanswered', label: '我们拨了电话，没接' }
    }
    return { actor: 'us', kind: 'phone', label: '我们打了电话' }
  }
  switch (touch.channel) {
    case 'email':
      return { actor: 'us', kind: 'email', label: '我们发了邮件' }
    case 'messenger':
      return { actor: 'us', kind: 'messenger', label: '我们回了私信' }
    case 'whatsapp':
      return { actor: 'us', kind: 'whatsapp', label: '我们发了 WhatsApp' }
    default:
      return { actor: 'us', kind: 'other', label: '我们联系了客人' }
  }
}

function mapTouch(touch: JourneyTouch): Mapped {
  return touch.direction === 'inbound' ? mapInbound(touch) : mapOutbound(touch)
}

interface Kept {
  touch: JourneyTouch
  mapped: Mapped
  time: number
}

/** 过滤 + 映射，得到保留下来的触点。 */
function keepTouches(touches: readonly JourneyTouch[]): Kept[] {
  const out: Kept[] = []
  for (const touch of touches) {
    if (isDropped(touch)) continue
    out.push({ touch, mapped: mapTouch(touch), time: Date.parse(touch.occurredAt) })
  }
  return out
}

interface Group {
  day: string
  actor: JourneyActor
  kind: JourneyKind
  label: string
  earliest: number
  earliestIso: string
  count: number
  latestFormTour: string | null
  latestFormTime: number
}

/** 按 (日历日, actor, kind) 合并。 */
function mergeGroups(kept: Kept[], timeZone: string): Group[] {
  const map = new Map<string, Group>()
  for (const k of kept) {
    const day = calendarDay(k.touch.occurredAt, timeZone)
    const key = `${day}|${k.mapped.actor}|${k.mapped.kind}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        day,
        actor: k.mapped.actor,
        kind: k.mapped.kind,
        label: k.mapped.label,
        earliest: k.time,
        earliestIso: k.touch.occurredAt,
        count: 1,
        latestFormTour: k.mapped.kind === 'form' ? k.touch.tour ?? null : null,
        latestFormTime: k.mapped.kind === 'form' ? k.time : -Infinity,
      })
      continue
    }
    existing.count += 1
    if (k.time < existing.earliest) {
      existing.earliest = k.time
      existing.earliestIso = k.touch.occurredAt
    }
    if (k.mapped.kind === 'form' && k.time >= existing.latestFormTime) {
      existing.latestFormTour = k.touch.tour ?? null
      existing.latestFormTime = k.time
    }
  }
  return Array.from(map.values())
}

/** 把分组变成节点（含 highlight 标记）。 */
function toNodes(groups: Group[], now: Date, timeZone: string): JourneyNode[] {
  const nodes: JourneyNode[] = groups.map((g) => {
    const tourText = g.kind === 'form' ? humanizeFormCode(g.latestFormTour) : null
    return {
      at: g.earliestIso,
      dayLabel: formatDay(g.earliestIso, now, timeZone),
      actor: g.actor,
      kind: g.kind,
      label: g.label,
      detail: tourText ? `想选：${tourText}` : null,
      count: g.count,
      highlight: false,
    }
  })
  nodes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let latestFormIdx = -1
  let latestFormTime = -Infinity
  nodes.forEach((n, i) => {
    if (n.kind !== 'form') return
    const t = Date.parse(n.at)
    if (t > latestFormTime) {
      latestFormTime = t
      latestFormIdx = i
    }
  })
  if (latestFormIdx >= 0) nodes[latestFormIdx].highlight = true
  return nodes
}

/** 归一化团名，用于比较。 */
function normalizeTour(raw: string | null | undefined): string {
  const human = humanizeFormCode(raw)
  if (!human) return ''
  return human.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '')
}

/** 计算 reasons 与 tourChange。 */
function computeReasons(
  kept: Kept[],
  info: ReturningLead | null,
): { reasons: string[]; tourChange: { from: string; to: string } | null } {
  if (info == null) return { reasons: [], tourChange: null }
  const reasons: string[] = ['主动再填表']

  const hasClick = kept.some(
    (k) => k.touch.direction === 'inbound' && k.touch.engagement === 'click',
  )
  if (hasClick) reasons.push('点过我们邮件里的链接')

  const latestFormTime = Date.parse(info.latestFormAt)
  let latestInboundBefore: number | null = null
  for (const k of kept) {
    if (k.touch.direction !== 'inbound') continue
    if (k.time >= latestFormTime) continue
    if (latestInboundBefore == null || k.time > latestInboundBefore) {
      latestInboundBefore = k.time
    }
  }
  if (latestInboundBefore != null) {
    const d = Math.floor((latestFormTime - latestInboundBefore) / DAY_MS)
    if (d >= SILENCE_THRESHOLD_DAYS) reasons.push(`隔了 ${span(d)} 又回来`)
  }

  let tourChange: { from: string; to: string } | null = null
  const forms = kept
    .filter((k) => k.mapped.kind === 'form')
    .sort((a, b) => a.time - b.time)
  if (forms.length >= 2) {
    const latest = forms[forms.length - 1]
    const prev = forms[forms.length - 2]
    const fromNorm = normalizeTour(prev.touch.tour)
    const toNorm = normalizeTour(latest.touch.tour)
    if (fromNorm && toNorm && fromNorm !== toNorm) {
      tourChange = {
        from: humanizeFormCode(prev.touch.tour) as string,
        to: humanizeFormCode(latest.touch.tour) as string,
      }
      reasons.push('这次选的团和上次不一样')
    }
  }

  if (info.ourContacts >= 2) {
    reasons.push(`我们联系过 ${info.ourContacts} 次，他仍主动回来`)
  }

  return { reasons, tourChange }
}

/** 在相邻节点之间插入 gap。 */
function interleaveGaps(nodes: JourneyNode[]): JourneyItem[] {
  const items: JourneyItem[] = []
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) {
      const prev = nodes[i - 1]
      const cur = nodes[i]
      const days = Math.floor((Date.parse(cur.at) - Date.parse(prev.at)) / DAY_MS)
      if (days >= GAP_THRESHOLD_DAYS) {
        items.push({ type: 'gap', days, label: `隔了 ${span(days)}` })
      }
    }
    items.push({ type: 'node', node: nodes[i] })
  }
  return items
}

/** 超过上限时保留首 2 + 尾 N，中间用 omitted 代替。 */
function capNodes(nodes: JourneyNode[], maxNodes: number): JourneyItem[] {
  if (nodes.length <= maxNodes) return interleaveGaps(nodes)
  const head = nodes.slice(0, 2)
  const tail = nodes.slice(nodes.length - (maxNodes - 2))
  const omittedCount = nodes.length - maxNodes
  const items: JourneyItem[] = []
  for (let i = 0; i < head.length; i++) {
    if (i > 0) {
      const days = Math.floor((Date.parse(head[i].at) - Date.parse(head[i - 1].at)) / DAY_MS)
      if (days >= GAP_THRESHOLD_DAYS) {
        items.push({ type: 'gap', days, label: `隔了 ${span(days)}` })
      }
    }
    items.push({ type: 'node', node: head[i] })
  }
  items.push({ type: 'omitted', count: omittedCount, label: `中间省略 ${omittedCount} 步` })
  for (let i = 0; i < tail.length; i++) {
    if (i > 0) {
      const days = Math.floor((Date.parse(tail[i].at) - Date.parse(tail[i - 1].at)) / DAY_MS)
      if (days >= GAP_THRESHOLD_DAYS) {
        items.push({ type: 'gap', days, label: `隔了 ${span(days)}` })
      }
    }
    items.push({ type: 'node', node: tail[i] })
  }
  return items
}

export function buildJourney(
  touches: readonly JourneyTouch[],
  info: ReturningLead | null,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
  maxNodes: number = DEFAULT_MAX_NODES,
): Journey {
  const kept = keepTouches(touches)
  const groups = mergeGroups(kept, timeZone)
  const nodes = toNodes(groups, now, timeZone)
  const { reasons, tourChange } = computeReasons(kept, info)
  const items = capNodes(nodes, maxNodes)
  return { items, totalNodes: nodes.length, reasons, tourChange }
}
