/**
 * 广告只读回测（第 2 层）：只支持"频次 → CPM / CTR"两类能写成单一指标、
 * 且不带数字门槛的规则，其余一律"无法回测"。
 * 纯函数，不调模型、不写库；只看相关性，不代表因果。
 * 带门槛的句子（频次超过 3、frequency passes 3）不回测：全量相关性核验不了"跨过这道线之后"。
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

const FREQ_UP_RE = /越高|更高|过高|超过|\b(?:higher|passes|passing|exceeds?|exceeding)\b/i
const FREQ_DOWN_RE = /越低|更低|过低|\b(?:lower|drops?|dropping)\b/i
const FREQ_LEAD_RE = /(越高|更高|过高|超过|越低|更低|过低|\b(?:higher|lower)\b)\s*$/i
const FREQ_TRAIL_RE = /^\s*(?:is|are|gets|becomes|会|变)?\s*(越高|更高|过高|超过|越低|更低|过低|\b(?:higher|lower|passes|passing|drops?|dropping|exceeds?|exceeding)\b)/i

/** 经验对指标声明的方向。调用前先去掉紧贴频次的方向词。有否定、两个方向或说不清时返回 null。 */
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

/** 只认紧贴「频次 / frequency」的方向词，并把它从指标文本里拿掉。两边冲突或没有则无法判断。 */
function frequencyClaim(text: string): { direction: 'up' | 'down' | null; metricText: string } {
  const freq = FREQ_RE.exec(text)
  if (!freq) return { direction: null, metricText: text }
  const before = text.slice(0, freq.index)
  const after = text.slice(freq.index + freq[0].length)
  const lead = before.match(FREQ_LEAD_RE)
  const trail = after.match(FREQ_TRAIL_RE)
  const span = `${lead?.[1] ?? ''} ${trail?.[1] ?? ''}`
  const up = FREQ_UP_RE.test(span)
  const down = FREQ_DOWN_RE.test(span)
  const cutStart = lead ? freq.index - lead[0].length : freq.index
  const cutEnd = freq.index + freq[0].length + (trail ? trail[0].length : 0)
  return {
    direction: up === down ? null : up ? 'up' : 'down',
    metricText: `${text.slice(0, cutStart)} ${text.slice(cutEnd)}`,
  }
}

const THRESHOLD_NUM = String.raw`\d+(?:\.\d+)?`
const THRESHOLD_MARK = String.raw`超过|高于|大于|低于|小于|不少于|不多于|至少|不到|达到|多于|少于|(?:passes|passing|exceeds|exceeding|above|over|under|below|drops|dropping|greater|less|higher|lower|more|at)\b`
const THRESHOLD_LINK = String.raw`(?:\s*(?:than|above|below|over|under|least|most|了))?`
const THRESHOLD_AFTER_RE = new RegExp(
  `^\\s*(?:一旦|会|变|一|is|are|gets|becomes|was|were|goes)?\\s*(?:${THRESHOLD_MARK})${THRESHOLD_LINK}\\s*${THRESHOLD_NUM}`,
  'i',
)
const THRESHOLD_THAN_RE = new RegExp(`^\\s*than\\s*${THRESHOLD_NUM}`, 'i')
const THRESHOLD_OP_RE = new RegExp(`^\\s*(?:>=|<=|≥|≤|>|<)\\s*${THRESHOLD_NUM}`)
const THRESHOLD_BEFORE_RE = new RegExp(
  `(?:${THRESHOLD_MARK})${THRESHOLD_LINK}\\s*${THRESHOLD_NUM}\\s*(?:的|次)?\\s*$`,
  'i',
)

/** 频次紧旁边有明确数字（超过 3、passes 3、higher than 3）。全量相关性核验不了这个前提。 */
function hasFrequencyThreshold(text: string): boolean {
  for (const match of text.matchAll(/频次|\bfrequency\b/gi)) {
    const at = match.index ?? 0
    const after = text.slice(at + match[0].length)
    const before = text.slice(0, at)
    if (THRESHOLD_AFTER_RE.test(after) || THRESHOLD_THAN_RE.test(after) || THRESHOLD_OP_RE.test(after)) return true
    if (THRESHOLD_BEFORE_RE.test(before)) return true
  }
  return false
}

/** 频次与 CPM 同向、频次与 CTR 反向，且没有数字门槛，才归类；缺失、矛盾、带门槛或覆盖不到返回 null。 */
export function classifyBacktest(lesson: string, rationale?: string | null): BacktestRule | null {
  const text = `${lesson} ${rationale ?? ''}`
  if (hasFrequencyThreshold(text)) return null
  const claim = frequencyClaim(text)
  if (!claim.direction) return null
  if (CPM_RE.test(text)) {
    return metricDirection(claim.metricText, CPM_RE) === claim.direction ? 'freq_cpm' : null
  }
  if (CTR_RE.test(text)) {
    const metric = metricDirection(claim.metricText, CTR_RE)
    return metric !== null && metric !== claim.direction ? 'freq_ctr' : null
  }
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
