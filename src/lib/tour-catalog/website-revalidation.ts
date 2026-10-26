export type WebsiteRevalidationResult = 'revalidated' | 'not_configured' | 'failed'

/** Nudge the configured public website after an explicit human publish. */
export async function revalidatePublishedTourWebsite(clientId: string): Promise<WebsiteRevalidationResult> {
  const endpoint = process.env.CTS_TOUR_CATALOG_REVALIDATE_URL?.trim()
  const secret = process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET?.trim()
  const configuredClientId = process.env.CTS_TOUR_CATALOG_CLIENT_ID?.trim()
  if (!endpoint || !secret || !configuredClientId || clientId !== configuredClientId) return 'not_configured'

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    return response.ok ? 'revalidated' : 'failed'
  } catch {
    return 'failed'
  }
}
