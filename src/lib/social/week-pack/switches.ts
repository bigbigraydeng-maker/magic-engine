/**
 * Weekly pack switches. Both default off: merging this code publishes nothing.
 * Live only when the value is exactly the string `true` (same rule as Story auto-publish).
 */

export interface WeekPackEnv {
  WEEKLY_PACK_APPROVAL_ENABLED?: string
  WEEKLY_PACK_REEL_GO_PUBLIC?: string
}

export function weeklyPackApprovalEnabled(env: WeekPackEnv): boolean {
  return env.WEEKLY_PACK_APPROVAL_ENABLED === 'true'
}

/** Reel go-public-on-approve. Stays off until the draft-vs-published fix has landed. */
export function reelGoPublicOnApproveEnabled(env: WeekPackEnv): boolean {
  return env.WEEKLY_PACK_REEL_GO_PUBLIC === 'true'
}

export function readWeekPackEnv(env: NodeJS.ProcessEnv = process.env): WeekPackEnv {
  return {
    WEEKLY_PACK_APPROVAL_ENABLED: env.WEEKLY_PACK_APPROVAL_ENABLED,
    WEEKLY_PACK_REEL_GO_PUBLIC: env.WEEKLY_PACK_REEL_GO_PUBLIC,
  }
}
