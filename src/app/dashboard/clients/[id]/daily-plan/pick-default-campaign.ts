export interface CampaignForSelection {
  id: string
}

/**
 * Picks which campaign the Daily Plan page should show by default.
 * Prefers the `?campaign=` id from the link the user arrived on (e.g. from
 * a specific Campaign card), falling back to the first active campaign so
 * the page never renders empty when a campaign list exists.
 */
export function pickDefaultCampaignId(
  campaigns: CampaignForSelection[],
  requestedId: string | null
): string | null {
  if (requestedId && campaigns.some(c => c.id === requestedId)) {
    return requestedId
  }
  return campaigns[0]?.id ?? null
}
