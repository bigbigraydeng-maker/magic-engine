/**
 * When a client has not chosen which stage records a deal, the historical
 * won step still does. A saved choice replaces that fallback. No client id
 * is involved.
 */
export const UNCONFIGURED_DEAL_STAGE = 'won'

export function stageCountsAsDeal(
  configuredStageKey: string | null,
  stageKey: string,
  marketingAction?: string | null,
): boolean {
  if (configuredStageKey != null) return configuredStageKey === stageKey
  return stageKey === UNCONFIGURED_DEAL_STAGE || marketingAction === 'won'
}
