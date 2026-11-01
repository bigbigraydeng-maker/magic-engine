import type { ViralRef } from './topic-agent'

/**
 * Mix heat-ordered social virals with time-ordered news before rewrite.
 * Reserves at most one slot for the freshest news when rewriteCount > 1.
 */
export function mixIntakePicks(
  heatOrderedVirals: ViralRef[],
  timeOrderedNews: ViralRef[],
  rewriteCount: number,
): ViralRef[] {
  const n = Math.max(1, rewriteCount)
  const newsSlots = n > 1 ? Math.min(timeOrderedNews.length, 1) : 0
  const viralSlots = Math.max(0, n - newsSlots)
  return [...timeOrderedNews.slice(0, newsSlots), ...heatOrderedVirals.slice(0, viralSlots)]
}
