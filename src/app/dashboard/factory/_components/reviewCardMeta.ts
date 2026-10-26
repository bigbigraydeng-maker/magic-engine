// 审片卡片的纯展示辅助:把工单 angle 拆成「团名 / 第几条 / 钩子」,格式化时长与创建时间。
// 只读展示用,不碰任何状态流转。团名不写死:取 angle 里「#序号」前面的文字,
// 换客户 / 换行业只要 angle 沿用同一写法就能自动分组。

export const OTHER_GROUP = '其它'

export interface AngleParts {
  group: string // 团名(英文原文);认不出 = OTHER_GROUP
  seq: number | null
  hook: string
  title: string // 给 PM 看的标题:团名 · 第N条 · 钩子
}

const ANGLE_RE = /^(.*?)\s*#\s*(\d+)\s*[:：]\s*(.*)$/

export function parseAngle(angle: string | null | undefined): AngleParts {
  const raw = (angle ?? '').trim()
  const m = ANGLE_RE.exec(raw)
  if (!m || !m[1].trim()) {
    return { group: OTHER_GROUP, seq: null, hook: raw, title: raw || '(未命名角度)' }
  }
  const group = m[1].trim()
  const seq = Number(m[2])
  const hook = m[3].trim()
  return { group, seq, hook, title: `${group} · 第${seq}条${hook ? ` · ${hook}` : ''}` }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 取 ISO 串里的日期时间(按存储时区),避免服务端 / 浏览器时区不同造成水合差异
export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })
}

export interface GroupCount { group: string; count: number }

// 按首次出现顺序汇总团名,「其它」永远排最后
export function groupCounts(angles: Array<string | null | undefined>): GroupCount[] {
  const m = new Map<string, number>()
  for (const a of angles) {
    const g = parseAngle(a).group
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  const list = [...m.entries()].map(([group, count]) => ({ group, count }))
  return [...list.filter(g => g.group !== OTHER_GROUP), ...list.filter(g => g.group === OTHER_GROUP)]
}
