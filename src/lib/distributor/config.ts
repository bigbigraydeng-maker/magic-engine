import type { CommissionRules } from './types'

/**
 * First product rule set: "AI digital-human steward" subscription.
 * Every number here is configuration agreed with the PM on 2026-11-10;
 * a different product gets its own CommissionRules object, not code changes.
 * Intermediate team steps (15k–750k) and the premier upgrade rule were
 * proposed by the agent and are expected to be tuned.
 */
export const AI_STEWARD_RULES_V1: CommissionRules = {
  version: 'ai-steward-2026-11-10',
  currency: 'NZD',
  retailRateBp: { standard: 2000, tier1: 3000, premier: 3500 },
  peerRateBp: 500,
  teamRateSteps: [
    { minTeamSalesCents: 5_000_000, rateBp: 600 },
    { minTeamSalesCents: 15_000_000, rateBp: 800 },
    { minTeamSalesCents: 30_000_000, rateBp: 1000 },
    { minTeamSalesCents: 50_000_000, rateBp: 1200 },
    { minTeamSalesCents: 75_000_000, rateBp: 1400 },
    { minTeamSalesCents: 100_000_000, rateBp: 1600 },
  ],
  refundWindowDays: 14,
  teamInactivityDays: 90,
  upgrade: {
    // 20 months / 30 months of the 799 plan, converted to money so that
    // every plan size counts fairly.
    tier1SingleSelfPurchaseCents: 20 * 79_900,
    tier1CumulativeDirectSalesCents: 30 * 79_900,
    premierMonthlyTeamSalesCents: 15_000_000,
    premierConsecutiveMonths: 3,
    premierMinDirectTier1: 2,
  },
  catalog: {
    plans: [
      { code: 'videos-6', videosPerMonth: 6, monthlyCents: 39_900 },
      { code: 'videos-16', videosPerMonth: 16, monthlyCents: 79_900 },
      { code: 'videos-30', videosPerMonth: 30, monthlyCents: 129_900 },
      { code: 'videos-60', videosPerMonth: 60, monthlyCents: 219_900 },
    ],
    includedAvatars: 3,
    extraAvatarOneTimeCents: 10_000,
  },
}
