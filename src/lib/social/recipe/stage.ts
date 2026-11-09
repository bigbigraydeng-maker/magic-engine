import type { RecipePlatform } from './platform-rules'

export type RecipeStage = 'starting' | 'growing' | 'mature' | 'paused'

export const STAGE_THRESHOLDS = {
  minFactCount: 20,
  minVerifiedAssetCount: 15,
  minOnTimeWeeksToLeaveStarting: 4,
  matureOnTimeWeeks: 12,
  minReceiptsPerFormat: 10,
  matureConsecutivePeriods: 2,
} as const

export interface StageSignals {
  platform: RecipePlatform
  hasPublishAuth: boolean
  /**
   * true only when publish auth existed before and has since broken
   * (revoked/expired). A client that never had auth is hasPublishAuth=false
   * and publishAuthLost unset.
   */
  publishAuthLost?: boolean
  factCount: number
  verifiedAssetCount: number
  consecutiveOnTimeWeeks: number
  /** the highest number of comparable read-back receipts of any single format (per group) */
  receiptsPerFormatMax: number
  /** consecutive periods in which at least one format had receipts >= minReceiptsPerFormat */
  consecutivePeriodsAtThreshold: number
  circuitBreakerTripped: boolean
  complaintSpike: boolean
}

export interface StageResult {
  stage: RecipeStage
  reasons: string[]
}

/** Treat non-finite or negative numbers as 0. */
function safeCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return value
}

function pausedReasons(signals: StageSignals): string[] {
  const reasons: string[] = []
  if (signals.circuitBreakerTripped) {
    reasons.push('Paused: the circuit breaker is tripped.')
  }
  if (signals.complaintSpike) {
    reasons.push('Paused: a complaint spike was detected.')
  }
  if (signals.publishAuthLost === true) {
    reasons.push('Paused: publish auth was lost (revoked or expired).')
  }
  return reasons
}

function startingReasons(signals: StageSignals): string[] {
  const reasons: string[] = []
  if (!signals.hasPublishAuth) {
    reasons.push('Starting: publish auth is not connected yet.')
  }
  const factCount = safeCount(signals.factCount)
  if (factCount < STAGE_THRESHOLDS.minFactCount) {
    reasons.push(
      `Starting: fact count is ${factCount}, below the threshold of ${STAGE_THRESHOLDS.minFactCount}.`,
    )
  }
  const assetCount = safeCount(signals.verifiedAssetCount)
  if (assetCount < STAGE_THRESHOLDS.minVerifiedAssetCount) {
    reasons.push(
      `Starting: verified asset count is ${assetCount}, below the threshold of ${STAGE_THRESHOLDS.minVerifiedAssetCount}.`,
    )
  }
  const onTimeWeeks = safeCount(signals.consecutiveOnTimeWeeks)
  if (onTimeWeeks < STAGE_THRESHOLDS.minOnTimeWeeksToLeaveStarting) {
    reasons.push(
      `Starting: consecutive on-time weeks is ${onTimeWeeks}, below the threshold of ${STAGE_THRESHOLDS.minOnTimeWeeksToLeaveStarting}.`,
    )
  }
  return reasons
}

function matureUnmetReasons(signals: StageSignals): string[] {
  const reasons: string[] = []
  const onTimeWeeks = safeCount(signals.consecutiveOnTimeWeeks)
  if (onTimeWeeks < STAGE_THRESHOLDS.matureOnTimeWeeks) {
    reasons.push(
      `Growing: consecutive on-time weeks is ${onTimeWeeks}, below the mature threshold of ${STAGE_THRESHOLDS.matureOnTimeWeeks}.`,
    )
  }
  const receipts = safeCount(signals.receiptsPerFormatMax)
  if (receipts < STAGE_THRESHOLDS.minReceiptsPerFormat) {
    reasons.push(
      `Growing: receipts per format max is ${receipts}, below the mature threshold of ${STAGE_THRESHOLDS.minReceiptsPerFormat}.`,
    )
  }
  const periods = safeCount(signals.consecutivePeriodsAtThreshold)
  if (periods < STAGE_THRESHOLDS.matureConsecutivePeriods) {
    reasons.push(
      `Growing: consecutive periods at threshold is ${periods}, below the mature threshold of ${STAGE_THRESHOLDS.matureConsecutivePeriods}.`,
    )
  }
  return reasons
}

export function computeStage(signals: StageSignals): StageResult {
  const paused = pausedReasons(signals)
  if (paused.length > 0) {
    return { stage: 'paused', reasons: paused }
  }

  const starting = startingReasons(signals)
  if (starting.length > 0) {
    return { stage: 'starting', reasons: starting }
  }

  const unmet = matureUnmetReasons(signals)
  if (unmet.length === 0) {
    return {
      stage: 'mature',
      reasons: [
        'Mature: on-time weeks, receipts per format and consecutive periods all meet the mature thresholds.',
      ],
    }
  }

  return { stage: 'growing', reasons: unmet }
}
