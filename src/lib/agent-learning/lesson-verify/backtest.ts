/**
 * 广告只读回测（第 2 层）：只支持"频次 → CPM / CTR"两类能写成单一指标的规则，
 * 其余一律"无法回测"。纯函数，不调模型、不写库；只看相关性，不代表因果。
 */
export type BacktestRule = 'freq_cpm' | 'freq_ctr'

const FREQ_RE = /\bfrequency\b|频次/i
const CPM_RE = /\bcpm\b/i
const CTR_RE = /\bctr\b|click-?through|点击率/i

const RISE_VERB_RE = /\b(rises?|rising|increases?|increasing|climbs?|grows?|raises?|goes up)\b|上升|升高|增加|上涨|变高|变贵|提高/i
const FALL_VERB_RE = /\b(falls?|falling|drops?|decreases?|decreasing|declines?|lowers?|reduces?|goes down)\b|下降|降低|减少|下跌|变低|变少/i
const RISE_ADJ_RE = /\b(higher|high)\b|越高|更高/i
const FALL_ADJ_RE = /\b(lower|low)\b|越低|更低/i
const NEGATION_RE = /\b(not|no|never|without|doesn'?t|don'?t|isn'?t|won'?t)\b|不|没|无|未/i

/** 经验对指标声明的方向；有否定、方向相反或说不清时返回 null。 */
function metricDirection(text: string, metricRe: RegExp): 'up' | 'down' | null {
  if (NEGATION_RE.test(text)) return null
  const m = metricRe.exec(text)
  // 形容词（越高/lower）只在指标之后才算对指标的描述，之前的多半在修饰频次
  const after = m ? text.slice(m.index + m[0].length) : ''
  const up = RISE_VERB_RE.test(text) || RISE_ADJ_RE.test(after)
  const down = FALL_VERB_RE.test(text) || FALL_ADJ_RE.test(after)
  if (up === down) return null
  return up ? 'up' : 'down'
}

const FREQ_UP_RE = /\b(higher|high|passes|exceeds?|above|over)\b|越高|过高|更高|超过|升高|上升|增加/i
const FREQ_DOWN_RE = /\b(lower|low|below|drops?|falls?|under)\b|越低|过低|更低|低于|下降|降低|减少/i
const METRIC_CUT_RE = /\bcpm\b|\bctr\b|click-?through|点击率/i

/** 频次自己的变化方向：只看紧贴"频次/frequency"的词（后侧截到指标词前）；只有明确"升高"才返回 true。 */
function frequencyRises(text: string): boolean {
  const m = FREQ_RE.exec(text)
  if (!m) return false
  const before = text.slice(Math.max(0, m.index - 12), m.index)
  const rawAfter = text.slice(m.index + m[0].length, m.index + m[0].length + 12)
  const cut = METRIC_CUT_RE.exec(rawAfter)
  const after = cut ? rawAfter.slice(0, cut.index) : rawAfter
  const near = `${before} ${after}`
  return FREQ_UP_RE.test(near) && !FREQ_DOWN_RE.test(near)
}

/** 只归类方向明确且与 runBacktest 预期一致的经验：频次↑→CPM↑、频次↑→CTR↓；其余 null（无法回测）。 */
export function classifyBacktest(lesson: string, rationale?: string | null): BacktestRule | null {
  const text = `${lesson} ${rationale ?? ''}`
  if (!FREQ_RE.test(text) || !frequencyRises(text)) return null
  if (CPM_RE.test(text)) return metricDirection(text, CPM_RE) === 'up' ? 'freq_cpm' : null
  if (CTR_RE.test(text)) return metricDirection(text, CTR_RE) === 'down' ? 'freq_ctr' : null
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
