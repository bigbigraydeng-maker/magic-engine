import type { EfficiencyRates } from './types';

export function efficiencyFromTotals(
  spend: number | null,
  impressions: number | null,
  linkClicks: number | null,
): EfficiencyRates {
  const ctrPercent =
    impressions !== null && impressions > 0 && linkClicks !== null
      ? (linkClicks / impressions) * 100
      : null;
  const cpc =
    linkClicks !== null && linkClicks > 0 && spend !== null && spend >= 0 ? spend / linkClicks : null;
  const cpm =
    impressions !== null && impressions > 0 && spend !== null && spend >= 0
      ? (spend / impressions) * 1000
      : null;
  return { ctrPercent, cpc, cpm };
}
