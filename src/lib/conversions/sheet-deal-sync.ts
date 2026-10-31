/**
 * Sheet import of deals is off unless this flag is exactly "1" or "true".
 * The CRM payment path is the deal source. Leaving the sheet on as well
 * would record the same sale twice.
 */
export function isSheetDealSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.CONVERSION_SHEET_DEAL_SYNC
  return raw === '1' || raw === 'true'
}
