/**
 * When a client has not chosen which stage records a deal, only the stage
 * key `won` does. A marketing action named won is not enough: that would
 * open the amount panel for a paid-in-full step and record a second purchase.
 * A saved choice replaces the fallback. No client id is involved.
 */
export const UNCONFIGURED_DEAL_STAGE = 'won'

export function stageCountsAsDeal(configuredStageKey: string | null, stageKey: string): boolean {
  if (configuredStageKey != null) return configuredStageKey === stageKey
  return stageKey === UNCONFIGURED_DEAL_STAGE
}
