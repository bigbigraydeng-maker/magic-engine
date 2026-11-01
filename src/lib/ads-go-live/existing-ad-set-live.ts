/**
 * An existing ad set counts as live only from its effective status.
 * The id being present is not delivery: a paused or archived parent blocks the new ad.
 */
export function existingAdSetCountsAsLive(effectiveStatus: string | null | undefined): boolean {
  return effectiveStatus === 'ACTIVE'
}
