/**
 * 广告只读回测（第 2 层）：只支持"频次 → CPM / CTR"两类能写成单一指标的规则，
 * 其余一律"无法回测"。纯函数，不调模型、不写库；只看相关性，不代表因果。
 */
export type BacktestRule = 'freq_cpm' | 'freq_ctr'

const FREQ_RE = /\bfrequency\b|频次/i
const CPM_RE = /\bcpm\b/i
const CTR_RE = /\bctr\b|click-?through|点击率/i

export function classifyBacktest(lesson: string, rationale?: string | null): BacktestRule | null {
  const text = `${lesson} ${rationale ?? ''}`
  if (!FREQ_RE.test(text)) return null
  if (CPM_RE.test(text)) return 'freq_cpm'
  if (CTR_RE.test(text)) return 'freq_ctr'
  return null
}

export interface InsightRow {
  frequency: number | null
  cpm: number | null
  ctr: number | null
  impressions: number | null
}

export type BacktestVerdict = 'support' | 'against' | 'insufficient'
export interface BacktestResult {
  verdict: BacktestVerdict
  rows: number
  r: number | null
}

export const MIN_BACKTEST_ROWS = 30
export const BACKTEST_DAYS = 90
const MIN_ABS_R = 0.2

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

/** freq_cpm 预期正相关（频次越高 CPM 越高）；freq_ctr 预期负相关（频次越高 CTR 越低）。 */
export function runBacktest(rule: BacktestRule, data: InsightRow[]): BacktestResult {
  const pairs: Array<[number, number]> = []
  for (const d of data) {
    if ((d.impressions ?? 0) <= 0 || d.frequency == null) continue
    const y = rule === 'freq_cpm' ? d.cpm : d.ctr
    if (y == null) continue
    const pair: [number, number] = [Number(d.frequency), Number(y)]
    if (Number.isFinite(pair[0]) && Number.isFinite(pair[1])) pairs.push(pair)
  }
  if (pairs.length < MIN_BACKTEST_ROWS) return { verdict: 'insufficient', rows: pairs.length, r: null }
  const r = pearson(pairs.map(p => p[0]), pairs.map(p => p[1]))
  if (r === null) return { verdict: 'insufficient', rows: pairs.length, r: null }
  const aligned = rule === 'freq_cpm' ? r : -r
  return { verdict: aligned >= MIN_ABS_R ? 'support' : 'against', rows: pairs.length, r }
}

export function describeBacktest(res: BacktestResult): string {
  const tail = '只看相关性，不代表照做一定变好。'
  if (res.verdict === 'insufficient') {
    return `回测：该客户过去 ${BACKTEST_DAYS} 天数据不够（有效数据 ${res.rows} 条，至少需要 ${MIN_BACKTEST_ROWS} 条）。${tail}`
  }
  const word = res.verdict === 'support' ? '支持' : '不支持'
  return `回测：该客户过去 ${BACKTEST_DAYS} 天数据${word}这条经验（${res.rows} 条数据）。${tail}`
}
