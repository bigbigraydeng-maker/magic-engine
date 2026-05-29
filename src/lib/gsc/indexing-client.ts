/**
 * Google Indexing API client — P14.B.7
 *
 * ⚠️ KNOWN LIMITATION (discovered 2026-05-29):
 *   Google's Indexing API is officially restricted to pages that contain
 *   either JobPosting or BroadcastEvent structured data — and to those
 *   ONLY. For any other page type (e.g. blog posts) the API accepts the
 *   request with HTTP 200 but Google silently drops the notification at
 *   the backend, so it does NOT trigger a crawl. The `urlNotifications/metadata`
 *   endpoint returns 404 for those URLs, confirming the drop.
 *
 *   Source: https://developers.google.com/search/apis/indexing-api/v3/quickstart#restrictions
 *
 *   For ordinary blog posts, prefer `sitemap-ping.ts` (forces Google to
 *   re-read the sitemap) plus a "Inspect in GSC" UI button as a manual
 *   fallback. Keep this client around for future JobPosting / BroadcastEvent
 *   integrations.
 *
 * Requirements when used for a supported page type:
 *   - OAuth scope: https://www.googleapis.com/auth/indexing
 *   - The site URL must be a verified GSC property for the OAuth identity
 *   - Indexing API must be enabled in the GCP project
 *
 * Quota: 200 requests/day per project.
 *
 * Reference: https://developers.google.com/search/apis/indexing-api/v3/quickstart
 */

const INDEXING_API_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish'

export interface IndexingResult {
  ok:       boolean
  /** Set when ok = true; echoes back the submitted URL. */
  url?:     string
  /**
   * Set when ok = false.
   *   NEEDS_REAUTH           — token lacks the indexing scope; PM must reconnect.
   *   SERVICE_DISABLED       — Indexing API not enabled in the Google Cloud project (one-time fix).
   *   NOT_VERIFIED           — Site URL is not a verified GSC property for this token.
   *   QUOTA_EXCEEDED         — 200/day project quota hit.
   *   NOT_SUPPORTED_BY_API   — API accepted the request (HTTP 200) but Google silently drops
   *                            it because the URL is not a JobPosting / BroadcastEvent page.
   *                            This is a Google policy limitation, not a configuration issue.
   *   API_ERROR / NETWORK_ERROR — other unrecoverable failures.
   */
  errorCode?:
    | 'NEEDS_REAUTH'
    | 'SERVICE_DISABLED'
    | 'NOT_VERIFIED'
    | 'QUOTA_EXCEEDED'
    | 'NOT_SUPPORTED_BY_API'
    | 'API_ERROR'
    | 'NETWORK_ERROR'
  errorMsg?:  string
}

/**
 * Submit a URL_UPDATED indexing request to Google.
 *
 * @param url         - Fully-qualified URL of the published page, e.g. https://example.com/my-post/
 * @param accessToken - OAuth2 access token with the `indexing` scope
 */
export async function requestIndexing(
  url: string,
  accessToken: string,
): Promise<IndexingResult> {
  let res: Response
  try {
    res = await fetch(INDEXING_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    })
  } catch (err) {
    return {
      ok:        false,
      errorCode: 'NETWORK_ERROR',
      errorMsg:  err instanceof Error ? err.message : 'Network error',
    }
  }

  if (res.ok) {
    return { ok: true, url }
  }

  const body = await res.text()

  // 403 — disambiguate the three possible reasons:
  //   a) SERVICE_DISABLED  — Indexing API not enabled in GCP project
  //   b) NEEDS_REAUTH      — token lacks indexing scope
  //   c) NOT_VERIFIED      — site URL not owned by this token (fallback)
  if (res.status === 403) {
    const lower = body.toLowerCase()
    if (
      lower.includes('has not been used') ||
      lower.includes('service_disabled') ||
      lower.includes('is disabled')
    ) {
      return {
        ok: false,
        errorCode: 'SERVICE_DISABLED',
        errorMsg:  'Web Search Indexing API not enabled in Google Cloud project — enable at https://console.developers.google.com/apis/api/indexing.googleapis.com/overview',
      }
    }
    if (lower.includes('insufficient') || lower.includes('scope')) {
      return { ok: false, errorCode: 'NEEDS_REAUTH', errorMsg: 'Token missing indexing scope — re-authorise Google connection' }
    }
    return { ok: false, errorCode: 'NOT_VERIFIED', errorMsg: `Site URL is not a verified property for this Google account (403): ${body.slice(0, 200)}` }
  }

  if (res.status === 429) {
    return { ok: false, errorCode: 'QUOTA_EXCEEDED', errorMsg: 'Indexing API daily quota exceeded (200/day)' }
  }

  return { ok: false, errorCode: 'API_ERROR', errorMsg: `Indexing API error (${res.status}): ${body.slice(0, 200)}` }
}
