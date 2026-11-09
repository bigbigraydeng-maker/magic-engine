/**
 * Shared Meta Graph transport constants and pagination machinery.
 *
 * Split out of client.ts so every insights module shares ONE base URL and ONE
 * page-walk implementation. The version lives here and nowhere else.
 */

/** Single source of truth for the Graph API version. */
export const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** Hard cap on pagination follows — a runaway-loop backstop, not a real limit. */
export const MAX_INSIGHT_PAGES = 25

/**
 * The rows a page walk gathered, plus whether it actually reached the end.
 *
 * `complete: false` is the difference between "this account ran no ads" and
 * "Meta rate-limited us on page 3" — indistinguishable from an empty array, and
 * the distinction is what stops a half-fetched backfill from being mistaken for
 * a finished one and leaving a permanent hole in the series.
 */
export interface InsightPageWalk<T> {
  rows:     T[]
  complete: boolean
}

/**
 * Walk an /insights cursor, parsing each page.
 *
 * Keeps the rows gathered SO FAR on any transport/HTTP error rather than
 * throwing or discarding them, but flags the walk incomplete so the caller can
 * decide whether partial data is usable. `label` only shapes the log line so
 * campaign- and ad-level failures stay distinguishable in Render.
 */
export async function fetchInsightPages<Raw, Out>(
  firstUrl: string,
  label: string,
  parse: (row: Raw) => Out | null,
): Promise<InsightPageWalk<Out>> {
  let url: string | undefined = firstUrl
  const rows: Out[] = []

  for (let page = 0; page < MAX_INSIGHT_PAGES && url; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error(`[meta/client] ${label} fetch error:`, err)
      return { rows, complete: false }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/client] ${label} HTTP ${res.status}:`, body.slice(0, 300))
      return { rows, complete: false }
    }

    const json = await res.json() as { data?: Raw[]; paging?: { next?: string } }

    for (const raw of json.data ?? []) {
      const parsed = parse(raw)
      if (parsed) rows.push(parsed)
    }

    url = json.paging?.next
  }

  // Loop ended with a cursor still in hand: the page cap truncated us. Silent
  // truncation would look exactly like a finished walk (25 × 500 = 12,500 rows,
  // reachable at ad level on a 30-day backfill of a busy account).
  if (url) {
    console.warn(`[meta/client] ${label} hit the ${MAX_INSIGHT_PAGES}-page cap — result truncated`)
    return { rows, complete: false }
  }

  return { rows, complete: true }
}
