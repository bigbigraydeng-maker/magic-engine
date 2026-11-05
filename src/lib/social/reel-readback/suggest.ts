/**
 * Weekly "what to make more / less of" suggestion from measured 72-hour engagement. Pure, suggestion only: nothing here changes a setting.
 * Engagement (likes + comments + shares) is NOT inquiries; organic reel → DM / form cannot be attributed yet, and the text says so.
 */
import type { ReelReadbackItem } from './report'

/** Median, not mean, so one hit reel cannot make a whole group look good; minGap stops "2x of almost nothing" from counting. */
export const SUGGEST_LIMITS = { minGroup: 3, minTotal: 6, moreRatio: 1.5, lessRatio: 0.5, minGap: 2 } as const

export type Dimension = 'template' | 'pillar'

export interface GroupResult {
  dimension: Dimension
  key: string
  n: number
  avg: number
  /** avg / overall average; null when the overall average is 0. */
  ratio: number | null
  verdict: 'more' | 'less' | 'keep'
}

export interface Suggestion {
  status: 'ok' | 'not_enough_data'
  /** Enough reels were read but every one had zero engagement: nothing to compare, and worth a person's look. */
  all_zero?: true
  measured: number
  /** Median of all measured reels' engagement (name kept for stored receipts). */
  overall_avg: number | null
  groups: GroupResult[]
  lines: string[]
}

const DIM_ZH: Record<Dimension, string> = { template: '模板', pillar: '内容类型' }
const round1 = (n: number): number => Math.round(n * 10) / 10

function median(vals: readonly number[]): number {
  const v = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function measuredValues(items: readonly ReelReadbackItem[]): Array<{ item: ReelReadbackItem; value: number }> {
  const out: Array<{ item: ReelReadbackItem; value: number }> = []
  const seen = new Set<string>()
  // One work order can be published more than once; it counts once (the newest, items come newest first).
  for (const item of items) {
    if (item.status !== 'measured' || item.engagement.kind !== 'value' || seen.has(item.work_order_id)) continue
    seen.add(item.work_order_id)
    out.push({ item, value: item.engagement.value })
  }
  return out
}

function groupsOf(rows: ReturnType<typeof measuredValues>, dimension: Dimension, overall: number): GroupResult[] {
  const by = new Map<string, number[]>()
  for (const r of rows) {
    const key = r.item[dimension]
    if (key === null) continue
    by.set(key, [...(by.get(key) ?? []), r.value])
  }
  const out: GroupResult[] = []
  for (const [key, vals] of by) {
    if (vals.length < SUGGEST_LIMITS.minGroup) continue
    const mid = median(vals)
    const ratio = overall > 0 ? mid / overall : null
    const gap = Math.abs(mid - overall)
    const verdict = ratio === null || gap < SUGGEST_LIMITS.minGap ? 'keep' : ratio >= SUGGEST_LIMITS.moreRatio ? 'more' : ratio <= SUGGEST_LIMITS.lessRatio ? 'less' : 'keep'
    out.push({ dimension, key, n: vals.length, avg: round1(mid), ratio: ratio === null ? null : round1(ratio), verdict })
  }
  return out.sort((a, b) => b.avg - a.avg)
}

export function buildSuggestion(items: readonly ReelReadbackItem[]): Suggestion {
  const rows = measuredValues(items)
  if (rows.length < SUGGEST_LIMITS.minTotal) {
    return { status: 'not_enough_data', measured: rows.length, overall_avg: null, groups: [], lines: [`满 72 小时、读到数的 Reel 只有 ${rows.length} 条（至少要 ${SUGGEST_LIMITS.minTotal} 条），样本太少，这周不给配比建议。`] }
  }
  const overall = median(rows.map((r) => r.value))
  if (overall === 0 && rows.every((r) => r.value === 0)) {
    return { status: 'not_enough_data', all_zero: true, measured: rows.length, overall_avg: 0, groups: [], lines: [`读到数的 ${rows.length} 条 Reel 互动全是 0，没法比较哪类好，这周不给配比建议（先查是不是真的没人互动）。`] }
  }
  const groups = [...groupsOf(rows, 'template', overall), ...groupsOf(rows, 'pillar', overall)]
  const lines = groups
    .filter((g) => g.verdict !== 'keep')
    .map((g) => `${DIM_ZH[g.dimension]}「${g.key}」互动中位数 ${g.avg}（${g.n} 条），是整体中位数 ${round1(overall)} 的 ${g.ratio} 倍：建议${g.verdict === 'more' ? '多做' : '少做或换做法'}。`)
  if (lines.length === 0) lines.push('各类内容的互动差不多，这周没有明显该多做或少做的类型。')
  return { status: 'ok', measured: rows.length, overall_avg: round1(overall), groups, lines }
}
