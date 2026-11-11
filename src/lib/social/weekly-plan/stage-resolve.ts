/**
 * Stage from this client's own Facebook signals.
 * A missing count stays missing. It is never passed to the stage function as zero
 * unless a different, readable signal has already put the client in the starting stage.
 */

import { computeStage, STAGE_THRESHOLDS, type RecipeStage, type StageSignals } from '@/lib/social/recipe/stage'

import type { CountSignal, FlagSignal, StageSignalsInput } from './types'

export interface StageResolution {
  stage: RecipeStage | null
  reasons: string[]
  signals: StageSignals | null
}

const COUNT_KEYS = ['facts', 'assets', 'onTimeWeeks', 'receipts', 'periods'] as const

function paused(reason: string): StageResolution {
  return { stage: 'paused', reasons: [reason], signals: null }
}

function definiteStarting(input: StageSignalsInput): string[] {
  const reasons: string[] = []
  if (input.auth.state === 'ok' && !input.auth.value) {
    reasons.push('起步：Facebook 发布授权还没接上。')
  }
  if (input.facts.state === 'ok' && input.facts.value < STAGE_THRESHOLDS.minFactCount) {
    reasons.push(`起步：事实库 ${input.facts.value} 条，少于 ${STAGE_THRESHOLDS.minFactCount} 条。`)
  }
  if (input.assets.state === 'ok' && input.assets.value < STAGE_THRESHOLDS.minVerifiedAssetCount) {
    reasons.push(`起步：真实素材 ${input.assets.value} 个，少于 ${STAGE_THRESHOLDS.minVerifiedAssetCount} 个。`)
  }
  if (input.onTimeWeeks.state === 'ok' && input.onTimeWeeks.value < STAGE_THRESHOLDS.minOnTimeWeeksToLeaveStarting) {
    reasons.push(`起步：连续按时 ${input.onTimeWeeks.value} 周，少于 ${STAGE_THRESHOLDS.minOnTimeWeeksToLeaveStarting} 周。`)
  }
  return reasons
}

function unreadCount(input: StageSignalsInput): boolean {
  return COUNT_KEYS.some((key) => input[key].state === 'unreadable') || input.auth.state === 'unreadable'
}

function countOf(signal: CountSignal): number {
  return signal.state === 'ok' ? signal.value : 0
}

function flagOf(signal: FlagSignal): boolean {
  return signal.state === 'ok' ? signal.value : false
}

function toSignals(input: StageSignalsInput): StageSignals {
  return {
    platform: 'facebook',
    hasPublishAuth: flagOf(input.auth),
    publishAuthLost: flagOf(input.authLost),
    factCount: countOf(input.facts),
    verifiedAssetCount: countOf(input.assets),
    consecutiveOnTimeWeeks: countOf(input.onTimeWeeks),
    receiptsPerFormatMax: countOf(input.receipts),
    consecutivePeriodsAtThreshold: countOf(input.periods),
    circuitBreakerTripped: flagOf(input.circuitBreaker),
    complaintSpike: flagOf(input.complaintSpike),
  }
}

function unreadNotes(input: StageSignalsInput): string[] {
  const notes: string[] = []
  if (input.onTimeWeeks.state === 'unreadable') notes.push('连续按时周数读不到，没有按 0 周计算。')
  if (input.receipts.state === 'unreadable') notes.push('回执读不到，没有按 0 条计算。')
  if (input.periods.state === 'unreadable') notes.push('连续达标期数读不到，没有按 0 期计算。')
  if (input.facts.state === 'unreadable') notes.push('事实库条数读不到，没有按 0 条计算。')
  if (input.assets.state === 'unreadable') notes.push('真实素材个数读不到，没有按 0 个计算。')
  if (input.auth.state === 'unreadable') notes.push('发布授权读不到，没有当成没授权。')
  return notes
}

export function resolveStage(input: StageSignalsInput): StageResolution {
  if (input.circuitBreaker.state === 'ok' && input.circuitBreaker.value) {
    return paused('暂停：熔断已经触发，这周不出新稿。')
  }
  if (input.complaintSpike.state === 'ok' && input.complaintSpike.value) {
    return paused('暂停：投诉明显变多，这周不出新稿。')
  }
  if (input.authLost.state === 'ok' && input.authLost.value) {
    return paused('暂停：发布授权中途断了，这周不出新稿。')
  }
  const starting = definiteStarting(input)
  if (starting.length > 0) {
    return { stage: 'starting', reasons: [...starting, ...unreadNotes(input)], signals: toSignals(input) }
  }
  if (unreadCount(input)) {
    return {
      stage: null,
      reasons: ['阶段没有下结论：还有信号读不到，没有把客户打回起步，也没有当成已经做稳。', ...unreadNotes(input)],
      signals: null,
    }
  }
  const signals = toSignals(input)
  const computed = computeStage(signals)
  return { stage: computed.stage, reasons: stageSentence(computed.stage), signals }
}

function stageSentence(stage: RecipeStage): string[] {
  if (stage === 'starting') return ['起步：事实、素材或按时周数还没过起步线。']
  if (stage === 'growing') return ['成长：起步线过了，还没到连续做稳。']
  if (stage === 'mature') return ['成熟：连续按时和回执都过了线。社媒仍不追数字目标。']
  return ['暂停：这周不出新稿。']
}
