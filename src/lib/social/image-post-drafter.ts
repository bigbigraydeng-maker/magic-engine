/**
 * Drafts a single Facebook image post for a client's daily plan.
 *
 * Pure orchestrator: tour rotation → image selection → AI copy → fact check → outbound scan.
 * All side-effectful deps (AI, DB) are injected via ImagePostDrafterDeps.
 */
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
import type { CampaignDailyPostDraft } from '@/lib/campaign/daily-plan'
import type { FactCheckResult, FactCheckInput } from '@/lib/social/weekly-loop/fact-check'
import type { ClaimHit } from '@/lib/social/outbound-claims'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImagePostDrafterInput {
  clientId: string
  date: string // YYYY-MM-DD
  tours: PublishedTourFact[]
  assets: RankableAssetRow[]
  recentTourSlugs: string[] // slugs used in the last 7 days
  ctaBaseUrl: string // e.g. "https://www.ctstours.co.nz/tours"
}

export interface ImagePostDrafterDeps {
  generateCopy: (
    tour: PublishedTourFact,
    asset: RankableAssetRow,
  ) => Promise<{ hook: string; body: string; cta: string }>
  checkFacts: (input: FactCheckInput) => FactCheckResult
  scanOutboundClaims: (text: string) => ClaimHit[]
}

export type ImagePostDraftResult =
  | { ok: true; draft: CampaignDailyPostDraft; tourSlug: string; factCheck: FactCheckResult }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

export function hashCode(s: string): number {
  let h = 0
  for (const c of s) h = ((h << 5) - h + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

export function pickTour(
  tours: PublishedTourFact[],
  recentSlugs: string[],
  date: string,
): PublishedTourFact | null {
  const eligible = tours.filter((t) => t.isActive && !t.soldOut)
  if (eligible.length === 0) return null

  const recentSet = new Set(recentSlugs)
  const fresh = eligible.filter((t) => !recentSet.has(t.slug))

  const pool = fresh.length > 0 ? fresh : eligible
  return pool[hashCode(date) % pool.length]
}

export function pickImage(
  assets: RankableAssetRow[],
  tourDestination: string,
  tourSlug: string,
  date: string,
): RankableAssetRow | null {
  if (assets.length === 0) return null

  const destLower = tourDestination.toLowerCase()
  const slugLower = tourSlug.toLowerCase()
  const matched = assets.filter((a) => {
    const fn = (a.original_filename ?? '').toLowerCase()
    return fn.includes(destLower) || fn.includes(slugLower)
  })

  const pool = matched.length > 0 ? matched : assets
  return pool[hashCode(date + tourSlug) % pool.length]
}

// ---------------------------------------------------------------------------
// Outbound claims filter
// ---------------------------------------------------------------------------

function outboundClaimsOk(
  hits: ClaimHit[],
  tour: PublishedTourFact,
): { pass: true } | { pass: false; reason: string } {
  if (hits.length === 0) return { pass: true }

  const ungrounded = hits.filter((h) => {
    if (h.kind === 'price' && tour.displayPriceText) return false
    if (h.kind === 'duration' && tour.durationText) return false
    return true
  })

  if (ungrounded.length === 0) return { pass: true }
  return { pass: false, reason: `outbound_claim:${ungrounded[0].kind}` }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function draftImagePost(
  input: ImagePostDrafterInput,
  deps: ImagePostDrafterDeps,
): Promise<ImagePostDraftResult> {
  const { tours, assets, recentTourSlugs, date, ctaBaseUrl } = input

  // 1. Pick tour
  const tour = pickTour(tours, recentTourSlugs, date)
  if (!tour) return { ok: false, reason: 'no_eligible_tour' }

  // 2. Pick image
  const image = pickImage(assets, tour.destination, tour.slug, date)
  if (!image) return { ok: false, reason: 'no_eligible_image' }

  // 3. Generate copy via injected AI
  const copy = await deps.generateCopy(tour, image)

  // 4. Build full text for checks
  const fullText = [copy.hook, copy.body, copy.cta].join('\n\n')
  const ctaUrl = `${ctaBaseUrl}/${tour.slug}`

  // 5. Fact check
  const factInput: FactCheckInput = {
    texts: { overlay: null, caption: fullText, firstComment: null },
    linkUrl: ctaUrl,
    tours,
    aliasesByTourId: {},
    catalogVersion: 0,
    today: date,
  }
  const factCheck = deps.checkFacts(factInput)
  if (factCheck.verdict !== 'pass') {
    return { ok: false, reason: `fact_check_${factCheck.verdict}` }
  }

  // 6. Outbound claims scan
  const claims = deps.scanOutboundClaims(fullText)
  const claimResult = outboundClaimsOk(claims, tour)
  if (!claimResult.pass) {
    return { ok: false, reason: claimResult.reason }
  }

  // 7. Assemble draft
  const draft: CampaignDailyPostDraft = {
    hook: copy.hook,
    body: copy.body,
    cta: copy.cta,
    image_asset_id: image.id,
    cta_url: ctaUrl,
  }

  return { ok: true, draft, tourSlug: tour.slug, factCheck }
}
