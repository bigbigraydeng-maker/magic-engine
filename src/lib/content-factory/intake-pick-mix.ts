import type { ViralRef } from './topic-agent'

/**
 * Mix heat-ordered social virals with time-ordered news before rewrite.
 * At most one news slot. When rewriteCount is 1, social takes that slot if any
 * social candidate exists; otherwise an unseen news item can use it.
 */
export function mixIntakePicks(
  heatOrderedVirals: ViralRef[],
  timeOrderedNews: ViralRef[],
  rewriteCount: number,
): ViralRef[] {
  const n = Math.max(1, rewriteCount)
  const newsCap = n > 1 || heatOrderedVirals.length === 0 ? 1 : 0
  const newsSlots = Math.min(timeOrderedNews.length, newsCap)
  const viralSlots = Math.max(0, n - newsSlots)
  return [...timeOrderedNews.slice(0, newsSlots), ...heatOrderedVirals.slice(0, viralSlots)]
}
