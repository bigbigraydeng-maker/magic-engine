/**
 * GSC URL Inspection (22.E.S15 后半 · R5 收录检查).
 *
 * Asks Google whether a URL is indexed. Uses the same token resolution
 * chain as fetchGscSnapshot; siteUrl MUST be the property identifier stored
 * on the client's GSC connector (config.site_url) verbatim — sc-domain: and
 * https:// properties are different strings and mixing them 404s (魏征 m5).
 *
 * Quota: 2000 inspections/day/property — the caller batches ~20/client/day.
 */

import { resolveAccessToken } from './client'

const INSPECT_ENDPOINT =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

export interface InspectionResult {
  /** Google's coverageState verbatim, e.g. "Submitted and indexed",
   *  "Discovered - currently not indexed". */
  coverageState: string
  /** PASS / NEUTRAL / FAIL / VERDICT_UNSPECIFIED */
  verdict: string
  indexed: boolean
}

/** coverageState → is this URL actually in Google's index? */
export function isIndexedState(verdict: string, coverageState: string): boolean {
  if (verdict === 'PASS') return true
  return /\bindexed\b/i.test(coverageState) && !/not indexed/i.test(coverageState)
}

export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  clientId: string,
): Promise<InspectionResult | null> {
  const token = await resolveAccessToken(clientId)
  if (!token) return null

  const res = await fetch(INSPECT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  })

  if (res.status === 429) {
    // Quota exhausted — stop the batch for today, don't hammer.
    throw new InspectQuotaError(siteUrl)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`URL inspection failed (${res.status}): ${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    inspectionResult?: {
      indexStatusResult?: { coverageState?: string; verdict?: string }
    }
  }

  const status = json.inspectionResult?.indexStatusResult
  const coverageState = status?.coverageState ?? 'UNKNOWN'
  const verdict = status?.verdict ?? 'VERDICT_UNSPECIFIED'

  return { coverageState, verdict, indexed: isIndexedState(verdict, coverageState) }
}

export class InspectQuotaError extends Error {
  constructor(siteUrl: string) {
    super(`URL inspection quota exhausted for ${siteUrl}`)
    this.name = 'InspectQuotaError'
  }
}
