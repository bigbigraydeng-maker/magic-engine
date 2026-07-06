/**
 * Prospect rule-based audit orchestrator — Step 2 of the outbound pipeline.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting).
 *
 * Cost per prospect: one free homepage fetch + one DataForSEO OnPage
 * instant audit (~$0.003). No AI calls — qualification happens on rules
 * (score.ts) so only high-opportunity prospects reach the paid AI step.
 */

import { getOnPageInstant, type OnPageResult } from '@/lib/dataforseo/onpage'
import { detectTrackingSignals, type TrackingSignals } from './tracking-detector'

export interface ProspectAudit {
  fetched_at:  string
  final_url:   string | null
  /** true = https homepage responded 2xx/3xx; false = unreachable over https. */
  https_ok:    boolean
  tracking:    TrackingSignals | null
  onpage:      OnPageResult | null
}

const FETCH_TIMEOUT_MS = 10_000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function normaliseUrl(raw: string): string {
  let u = raw.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  parsed.protocol = 'https:'
  return parsed.href
}

async function fetchHomepage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return { html: await res.text(), finalUrl: res.url }
  } catch {
    return null
  }
}

/**
 * Run the zero-AI audit for one prospect website.
 *
 * @param websiteUrl  URL (or bare domain) from the business listing.
 */
export async function runProspectAudit(websiteUrl: string): Promise<ProspectAudit> {
  const url = normaliseUrl(websiteUrl)

  const [page, onpage] = await Promise.all([
    fetchHomepage(url),
    getOnPageInstant(url).catch(() => null),
  ])

  return {
    fetched_at: new Date().toISOString(),
    final_url:  page?.finalUrl ?? null,
    https_ok:   page !== null,
    tracking:   page ? detectTrackingSignals(page.html) : null,
    onpage,
  }
}
