/**
 * 手机外勤页（今天要联系）的数据整理：只读，把 GET /crm/today 的返回
 * 变成手机上一行一个人的列表。不重新判断「该联系谁」——分桶和排序全由 today 接口负责。
 *
 * 手机上只显示「要人做的」两层（客人在等你 / 还没搭上话）；「先放着」只给个数字。
 */

export interface TodayPerson {
  contactId?: unknown
  name?: unknown
  reason?: unknown
  lastBy?: unknown
  doneToday?: unknown
  handledWhy?: unknown
  doNotContact?: unknown
  doNotCall?: unknown
  phoneUnusable?: unknown
  phone?: unknown
  stageLabel?: unknown
}

export interface TodayBucket {
  segment?: unknown
  layer?: unknown
  label?: unknown
  total?: unknown
  people?: unknown
}

export interface FieldRow {
  contactId: string
  name: string
  reason: string
  lastBy: string | null
  done: boolean
  /** 手机页第一刀不打电话，但要先把「打不了」的原因说清楚，后面几刀的按钮直接用。 */
  callBlock: 'none' | 'no_phone' | 'bad_phone' | 'do_not_call'
  stageLabel: string | null
}

export interface FieldSection {
  layer: 'waiting' | 'acted'
  title: string
  hint: string
  rows: FieldRow[]
  /** 这一层一共几人（接口每桶封顶后可能比 rows 多）。 */
  total: number
}

export interface FieldView {
  sections: FieldSection[]
  /** 「先放着，系统盯着」那一层的人数，手机上只显示数字。 */
  queuedCount: number
}

const LAYER_TEXT: Record<'waiting' | 'acted', { title: string; hint: string }> = {
  waiting: { title: '客人在等你', hint: '今天必须有人回。' },
  acted: { title: '还没搭上话', hint: '新进来的、和打过一次没接上的。' },
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function toRow(p: TodayPerson): FieldRow | null {
  const contactId = str(p.contactId)
  if (!contactId) return null
  // 别再联系的人不该出现在今天名单里；万一出现，手机页宁可不显示，也不给员工一个能点的人。
  if (p.doNotContact === true) return null
  let callBlock: FieldRow['callBlock'] = 'none'
  if (p.doNotCall === true) callBlock = 'do_not_call'
  else if (!str(p.phone)) callBlock = 'no_phone'
  else if (p.phoneUnusable === true) callBlock = 'bad_phone'
  const done = p.doneToday === true
  return {
    contactId,
    name: str(p.name) ?? '（没有名字）',
    reason: (done ? str(p.handledWhy) : null) ?? str(p.reason) ?? '',
    lastBy: str(p.lastBy),
    done,
    callBlock,
    stageLabel: str(p.stageLabel),
  }
}

export function buildFieldView(payload: unknown): FieldView {
  const buckets = (payload as { buckets?: unknown } | null)?.buckets
  const list: TodayBucket[] = Array.isArray(buckets) ? (buckets as TodayBucket[]) : []
  const sections: FieldSection[] = (['waiting', 'acted'] as const).map((layer) => ({
    layer,
    ...LAYER_TEXT[layer],
    rows: [],
    total: 0,
  }))
  let queuedCount = 0
  for (const b of list) {
    const total = typeof b.total === 'number' ? b.total : 0
    if (b.layer === 'queued') {
      queuedCount += total
      continue
    }
    const section = sections.find((s) => s.layer === b.layer)
    if (!section) continue
    section.total += total
    const people = Array.isArray(b.people) ? (b.people as TodayPerson[]) : []
    for (const p of people) {
      const row = toRow(p)
      if (row) section.rows.push(row)
    }
  }
  // 今天还没处理的排前面，处理过的沉到本层最后；同组内保持接口给的顺序。
  for (const s of sections) s.rows = [...s.rows.filter((r) => !r.done), ...s.rows.filter((r) => r.done)]
  return { sections, queuedCount }
}
