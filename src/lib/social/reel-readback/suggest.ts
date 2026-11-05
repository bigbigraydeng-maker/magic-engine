/**
 * Weekly "what to make more / less of" suggestion from measured 72-hour engagement. Pure, suggestion only: nothing here changes a setting.
 * Engagement (likes + comments + shares) is NOT inquiries; organic reel → DM / form cannot be attributed yet, and the text says so.
 */
import type { ReelReadbackItem } from './report'

export const SUGGEST_LIMITS = { minGroup: 3, minTotal: 6, moreRatio: 1.5, lessRatio: 0.5 } as const

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
  measured: number
  overall_avg: number | null
  groups: GroupResult[]
  lines: string[]
}

const DIM_ZH: Record<Dimension, string> = { template: '模板', pillar: '内容类型' }
const round1 = (n: number): number => Math.round(n * 10) / 10

function measuredValues(items: readonly ReelReadbackItem[]): Array<{ item: ReelReadbackItem; value: number }> {
  const out: Array<{ item: ReelReadbackItem; value: number }> = []
  for (const item of items) if (item.status === 'measured' && item.engagement.kind === 'value') out.push({ item, value: item.engagement.value })
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
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    const ratio = overall > 0 ? avg / overall : null
    const verdict = ratio === null ? 'keep' : ratio >= SUGGEST_LIMITS.moreRatio ? 'more' : ratio <= SUGGEST_LIMITS.lessRatio ? 'less' : 'keep'
    out.push({ dimension, key, n: vals.length, avg: round1(avg), ratio: ratio === null ? null : round1(ratio), verdict })
  }
  return out.sort((a, b) => b.avg - a.avg)
}

export function buildSuggestion(items: readonly ReelReadbackItem[]): Suggestion {
  const rows = measuredValues(items)
  if (rows.length < SUGGEST_LIMITS.minTotal) {
    return { status: 'not_enough_data', measured: rows.length, overall_avg: null, groups: [], lines: [`满 72 小时、读到数的 Reel 只有 ${rows.length} 条（至少要 ${SUGGEST_LIMITS.minTotal} 条），样本太少，这周不给配比建议。`] }
  }
  const overall = rows.reduce((a, r) => a + r.value, 0) / rows.length
  const groups = [...groupsOf(rows, 'template', overall), ...groupsOf(rows, 'pillar', overall)]
  const lines = groups
    .filter((g) => g.verdict !== 'keep')
    .map((g) => `${DIM_ZH[g.dimension]}「${g.key}」平均互动 ${g.avg}（${g.n} 条），是整体平均 ${round1(overall)} 的 ${g.ratio} 倍：建议${g.verdict === 'more' ? '多做' : '少做或换做法'}。`)
  if (lines.length === 0) lines.push('各类内容的互动差不多，这周没有明显该多做或少做的类型。')
  return { status: 'ok', measured: rows.length, overall_avg: round1(overall), groups, lines }
}
