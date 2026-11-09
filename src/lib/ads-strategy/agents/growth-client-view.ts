/**
 * 广告健康页「经营视图」的客户版（2026-09-27 子牙在 PR 2084 实施审里发现：接口对付费客户放行，
 * 却把 ads_growth_states 整行原样发到浏览器，D11「受众池断供、建议加钱」这类内部结论客户也看得到）。
 *
 * 🔴 白名单投影，fail-closed：只挑下面列出的字段，payload 将来新加的任何字段默认不给客户。
 * 🔴 单条广告结论只走 Magic Bridge 已经审过的那一条路：selectRuleFindings（clientVisible === true、
 *    连续 ≥2 次、数据齐、够新、这个账户真的检查过）→ toClientFinding 客户话术 → buildRuleCards。
 *    给客户看的门槛不能比给 PM 看的松（patrol-findings.ts 顶部注释）。
 * 🔴 「没检查」绝不说成「没发现」；机会（O*）全部是内部结论，客户版不出这一栏。
 * 纯函数，不读库。
 */

import { selectRuleFindings } from '@/lib/meta/ai/rule-findings'
import { buildRuleCards, type RuleCards } from '@/lib/meta/ai/rule-cards'
import {
  NONE_REASON_TEXT,
  RULE_SECTION_TITLE,
  renderRuleSection,
  type ClientRuleFinding,
  type RuleSectionInput,
} from '@/lib/ads-strategy/rules/client-copy'
import type { GrowthStateRow } from '@/lib/ads-strategy/rules/patrol-findings'
import type { GoalPaceVerdict } from '@/lib/ads-strategy/goal-pace'
import { isGoalProgressPending } from '@/lib/ads-strategy/goal-progress-display'

/** 客户版往回读几行（连续命中要看前几天；跟 Magic Bridge 的 14 天回看同量级） */
export const CLIENT_GROWTH_LOOKBACK_ROWS = 14

/** 路由读出来的一行。payload 故意是 unknown 形状——客户版只信自己挑出来并校验过的字段。 */
export interface GrowthRowForClient {
  client_id: string
  date: string
  data_completeness: string | null
  goal_pace: unknown
  payload: unknown
}

export interface ClientGoalView {
  title: string
  label: string
  target: number
  dayIndex: number
  totalDays: number
  /** 定金/成交等尚未接入进度条时为 true；不下发指标 key */
  progressPending: boolean
}

export interface ClientGoalPaceView {
  expectedToDate: number | null
  actualToDate: number | null
  gapPct: number | null
  projectedEnd: number | null
  verdict: GoalPaceVerdict
  /** 客户口吻的中性说法；内部 reason（含「日预算上限」这类加钱暗示）不下发 */
  reason: string
}

export interface ClientGrowthView {
  viewer: 'client'
  date: string
  goal: ClientGoalView | null
  goal_pace: ClientGoalPaceView | null
  /** 有需要留意的广告时的卡片；没有就是 null，看 adNote */
  adCards: RuleCards | null
  /** 没有卡片时说清楚是「检查过没发现」还是「没检查」；有卡片但部分账户没检查时也在这里补一句 */
  adNote: string | null
}

const VERDICTS: ReadonlySet<string> = new Set(['on_track', 'behind', 'unreachable_within_caps', 'unknown'])

const CLIENT_PACE_REASON: Record<GoalPaceVerdict, string> = {
  on_track: '目前按节奏在走。',
  behind: '目前比预定节奏慢一些。',
  unreachable_within_caps: '按现在的速度，到期可能达不到目标。',
  unknown: '数据还不够，暂时判断不了进度。',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function pickGoal(payload: unknown): ClientGoalView | null {
  if (!isRecord(payload) || !isRecord(payload.goal)) return null
  const g = payload.goal
  const target = finiteOrNull(g.target)
  const dayIndex = finiteOrNull(g.dayIndex)
  const totalDays = finiteOrNull(g.totalDays)
  if (typeof g.title !== 'string' || typeof g.label !== 'string') return null
  if (target === null || dayIndex === null || totalDays === null) return null
  const metricKey = typeof g.primaryMetricKey === 'string' ? g.primaryMetricKey : null
  return {
    title: g.title,
    label: g.label,
    target,
    dayIndex,
    totalDays,
    progressPending: isGoalProgressPending(metricKey),
  }
}

function pickGoalPace(raw: unknown): ClientGoalPaceView | null {
  if (!isRecord(raw)) return null
  const verdict = (typeof raw.verdict === 'string' && VERDICTS.has(raw.verdict) ? raw.verdict : 'unknown') as GoalPaceVerdict
  return {
    expectedToDate: finiteOrNull(raw.expectedToDate),
    actualToDate: finiteOrNull(raw.actualToDate),
    gapPct: finiteOrNull(raw.gapPct),
    projectedEnd: finiteOrNull(raw.projectedEnd),
    verdict,
    reason: CLIENT_PACE_REASON[verdict],
  }
}

function coverageAccounts(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.adLevelCoverage)) return null
  return payload.adLevelCoverage
    .map((c) => (isRecord(c) && typeof c.adAccountId === 'string' ? c.adAccountId : null))
    .filter((id): id is string => id !== null)
}

/** renderRuleSection 的正文（去掉报告里的小标题），让看板和 Magic Bridge 说同一句话。 */
function sectionText(input: RuleSectionInput): string {
  return renderRuleSection(input).replace(`${RULE_SECTION_TITLE}\n`, '')
}

type NoneReason = Extract<RuleSectionInput, { source: 'none' }>['reason']

/** 一个都没检查：说清楚是几个账户、各自为什么（不拿第一个账户的原因代表全部）。 */
function noneNote(reasons: readonly NoneReason[], accountCount: number): string {
  const texts = [...new Set(reasons)].map((r) => NONE_REASON_TEXT[r])
  return accountCount <= 1
    ? `你的广告账户这次没有逐条检查：${texts.join('；')}。`
    : `你的 ${accountCount} 个广告账户这次都没有逐条检查：${texts.join('；')}。`
}

function ruleArgs(adAccountId: string, now: Date) {
  return { adAccountId, now, currency: null, deliveringAdIds: null, campaignFrequency: () => null }
}

function toPatrolRow(r: GrowthRowForClient): GrowthStateRow {
  return { client_id: r.client_id, date: r.date, payload: isRecord(r.payload) ? (r.payload as GrowthStateRow['payload']) : null }
}

function adSection(rows: readonly GrowthRowForClient[], now: Date): Pick<ClientGrowthView, 'adCards' | 'adNote'> {
  const newest = rows[0]
  const patrolRows = rows.map(toPatrolRow)
  // 没有账户清单时也走 selectRuleFindings：它先判「数据没齐 / 太旧」再判「准备中 / 没接入」，顺序跟 Magic Bridge 一致。
  const accounts = coverageAccounts(newest.payload) ?? []
  const probe = accounts.length > 0 ? accounts : ['']

  const findings: ClientRuleFinding[] = []
  const noneReasons: NoneReason[] = []
  let adsChecked = 0
  let checkedAccounts = 0
  for (const adAccountId of probe) {
    const r = selectRuleFindings(patrolRows, ruleArgs(adAccountId, now))
    if (r.section.source === 'none') {
      noneReasons.push(r.section.reason)
      continue
    }
    checkedAccounts += 1
    adsChecked += r.section.adsChecked
    findings.push(...r.findings)
  }

  if (checkedAccounts === 0) return { adCards: null, adNote: noneNote(noneReasons, accounts.length) }
  const skipped = accounts.length - checkedAccounts
  const skippedNote = skipped > 0 ? `另外有 ${skipped} 个广告账户这次没有逐条检查，上面不包含它们。` : null
  const section: RuleSectionInput = { source: 'patrol', dataDate: newest.date, adsChecked, findings }
  if (findings.length === 0) {
    return { adCards: null, adNote: [sectionText(section), skippedNote].filter(Boolean).join('') }
  }
  const { cards } = buildRuleCards(section, null, now.toISOString().slice(0, 10))
  return { adCards: cards, adNote: skippedNote }
}

/** rows = 同一客户的 ads_growth_states 行（任意顺序）。没有行 → null（页面显示「今天还没巡察」）。 */
export function toClientGrowthView(rows: readonly GrowthRowForClient[], now: Date): ClientGrowthView | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const newest = sorted[0]
  return {
    viewer: 'client',
    date: newest.date,
    goal: pickGoal(newest.payload),
    goal_pace: pickGoalPace(newest.goal_pace),
    ...adSection(sorted, now),
  }
}
