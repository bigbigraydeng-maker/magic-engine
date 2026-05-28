/**
 * Google Indexing API client — P14.B.7
 *
 * Submits a URL_UPDATED notification to Google's Indexing API so Google
 * crawls the freshly published page sooner than the natural crawl schedule.
 *
 * Requirements:
 *   - OAuth scope: https://www.googleapis.com/auth/indexing
 *   - The client's site must be verified in Google Search Console
 *   - Indexing API must be enabled in Google Cloud Console (same project as OAuth)
 *
 * Quota: 200 requests/day per project (Google default). Sufficient for normal
 * publishing workflows.
 *
 * Reference: https://developers.google.com/search/apis/indexing-api/v3/quickstart
 */

const INDEXING_API_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish'

export interface IndexingResult {
  ok:       boolean
  /** Set when ok = true; echoes back the submitted URL. */
  url?:     string
  /** Set when ok = false. 'NEEDS_REAUTH' means token lacks the indexing scope. */
  errorCode?: 'NEEDS_REAUTH' | 'QUOTA_EXCEEDED' | 'NOT_VERIFIED' | 'API_ERROR' | 'NETWORK_ERROR'
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

  // 403 with 'insufficient authentication scopes' → token lacks indexing scope.
  if (res.status === 403) {
    if (body.toLowerCase().includes('insufficient') || body.toLowerCase().includes('scope')) {
      return { ok: false, errorCode: 'NEEDS_REAUTH', errorMsg: 'Token missing indexing scope — re-authorise Google connection' }
    }
    // 403 without scope mention → site not verified in GSC for this token.
    return { ok: false, errorCode: 'NOT_VERIFIED', errorMsg: `Site not verified in Google Search Console (403): ${body.slice(0, 200)}` }
  }

  if (res.status === 429) {
    return { ok: false, errorCode: 'QUOTA_EXCEEDED', errorMsg: 'Indexing API daily quota exceeded (200/day)' }
  }

  return { ok: false, errorCode: 'API_ERROR', errorMsg: `Indexing API error (${res.status}): ${body.slice(0, 200)}` }
}
