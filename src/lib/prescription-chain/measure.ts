import { computeGoalPace } from '@/lib/ads-strategy/goal-pace'
import { nzToday } from '@/lib/ads-strategy/promo-window'
import type { ChainFacts, GoalFact, OutcomeFact, PrescriptionFact, StrategyFact } from './types'
import { chainStep, unreadStep } from './steps'

function moneyText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  return String(rounded)
}

function sameMoney(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100)
}

function costConflict(config: number | null, written: number[]): string | null {
  const unique = Array.from(new Set(written.map((amount) => Math.round(amount * 100))))
  if (unique.length > 1) return '处方里的目标成本不只一个，对不上，不取平均。'
  if (config === null || unique.length === 0) return null
  if (!sameMoney(config, unique[0] / 100)) {
    return `目标线索成本对不上：设置里是 ${moneyText(config)}，处方里是 ${moneyText(unique[0] / 100)}。不取平均。`
  }
  return null
}

function paceDetail(goal: GoalFact, cap: number | null, today: string): { kind: 'ready' | 'wait' | 'bad'; detail: string } {
  if (goal.targetValue === null || goal.baselineValue === null) {
    return { kind: 'bad', detail: '目标值或基线还没填，量不出来。' }
  }
  if (!goal.periodStart || !goal.periodEnd) {
    return { kind: 'bad', detail: '目标起止日期还没填，配速线算不出来。' }
  }
  const pace = computeGoalPace({
    targetValue: goal.targetValue,
    baselineValue: goal.baselineValue,
    periodStart: goal.periodStart,
    periodEnd: goal.periodEnd,
    today,
    actualToDate: goal.currentValue,
    dailyCapCents: cap,
    medianCostPerResultCents7d: null,
  })
  if (pace.verdict === 'unknown' && pace.reason === '目标期日期无效') {
    return { kind: 'bad', detail: '目标起止日期读不懂，配速线算不出来。' }
  }
  if (pace.verdict === 'unknown') return { kind: 'wait', detail: pace.reason }
  return { kind: 'ready', detail: pace.reason }
}

function missingMoney(cap: number | null, cost: number | null): string | null {
  if (cap === null && cost === null) return '每天预算上限和目标线索成本都还没定。'
  if (cap === null) return '每天预算上限还没定。'
  if (cost === null) return '目标线索成本还没定。'
  return null
}

function judgeMeasure(
  rx: PrescriptionFact,
  goal: GoalFact,
  outcome: OutcomeFact,
  strategy: StrategyFact,
  nowIso: string,
): ReturnType<typeof chainStep> {
  const personal = rx.intake?.personalIp === true
  if (personal) {
    // 个人 IP：不要求目标线索成本；有广告打法时仍要每天预算上限。
    if (rx.adPlayCount > 0 && strategy.dailyCapCents === null) {
      return chainStep('measure', 'blocked', '每天预算上限还没定。')
    }
  } else {
    const missing = missingMoney(strategy.dailyCapCents, outcome.targetCostPerPrimary)
    if (!outcome.configured || missing) {
      return chainStep('measure', 'blocked', missing ?? '目标线索成本还没定。')
    }
    const conflict = costConflict(outcome.targetCostPerPrimary, rx.targetCosts)
    if (conflict) return chainStep('measure', 'blocked', conflict)
  }
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) return unreadStep('measure')
  const pace = paceDetail(goal, strategy.dailyCapCents, nzToday(now))
  if (pace.kind === 'bad') return chainStep('measure', 'blocked', pace.detail)
  const review = rx.reviewAnchor ? '' : '复盘日还没写在处方里。'
  if (pace.kind === 'wait') return chainStep('measure', 'active', `${pace.detail}${review}`)
  if (personal) return chainStep('measure', 'done', `配速读得到（个人 IP 不要求目标线索成本）。${pace.detail}${review}`)
  return chainStep('measure', 'done', `目标成本、每天上限和配速都读得到。${pace.detail}${review}`)
}

export function deriveMeasure(facts: ChainFacts): ReturnType<typeof chainStep> {
  if (facts.prescription.read !== 'ok' || facts.prescription.value === null) return unreadStep('measure')
  const rx = facts.prescription.value
  if (!rx.goalId) return chainStep('measure', 'blocked', '这份处方没有挂目标，量不出配速。')
  if (facts.goal.read !== 'ok' || facts.outcome.read !== 'ok' || facts.strategy.read !== 'ok') {
    return unreadStep('measure')
  }
  if (facts.goal.value === null) return chainStep('measure', 'blocked', '处方挂的目标不在了，量不出来。')
  if (facts.outcome.value === null || facts.strategy.value === null) return unreadStep('measure')
  return judgeMeasure(rx, facts.goal.value, facts.outcome.value, facts.strategy.value, facts.nowIso)
}
