import type { SupabaseClient } from '@supabase/supabase-js'
import { scrapeCompetitorMetaAds } from '@/lib/apify/ad-library'
import type { MetaAdData } from '@/lib/apify/ad-library'
import { scrapeGoogleAdsTransparency } from '@/lib/apify/google-ads-transparency'
import type { GoogleAdsData } from '@/lib/apify/google-ads-transparency'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// P8.10.S2.6: Meta + Google ads-library URLs we audit; included as evidence sources.
const META_AD_LIBRARY_URL = 'https://www.facebook.com/ads/library/'
const GOOGLE_ADS_TRANSPARENCY_URL = 'https://adstransparency.google.com/'
function adsSources(): ReturnType<typeof evidenceSource>[] {
  return [evidenceSource(META_AD_LIBRARY_URL), evidenceSource(GOOGLE_ADS_TRANSPARENCY_URL)]
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Score is built from three signals (all 0–100), weighted to sum to 100:
//   • platform diversity  — running both Meta + Google beats a single platform
//   • ad volume           — count of active ads (proxy for budget commitment)
//   • creative diversity  — distinct formats (image / video / carousel / text)
const PLATFORM_WEIGHT  = 0.40
const VOLUME_WEIGHT    = 0.35
const CREATIVE_WEIGHT  = 0.25

const LOW_AD_VOLUME_THRESHOLD = 3   // < 3 active ads on a platform = weak commitment
const STRONG_AD_VOLUME        = 10  // ≥ 10 ads on a platform = full marks

export interface AdsCollectorResult extends CollectorResult {
  meta_ads: MetaAdData | null
  google_ads: GoogleAdsData | null
}

interface ClientAdHandles {
  domain: string
  brandName: string | null
  market: string  // 'AU' or 'NZ'
}

export class AdsCollector {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS,
  ) {}

  async collect(
    clientId: string,
    domain: string,
    _keywords: string[],
  ): Promise<AdsCollectorResult> {
    if (!domain) {
      return {
        score: null,
        findings: [this.makeNoDomainFinding(clientId)],
        meta_ads: null,
        google_ads: null,
      }
    }

    const handles = await this.fetchHandles(clientId, domain)
    const searchTerm = handles.brandName ?? handles.domain
    const fallback: AdsCollectorResult = { score: null, findings: [], meta_ads: null, google_ads: null }

    const timeout = new Promise<AdsCollectorResult>(resolve =>
      setTimeout(() => resolve(fallback), this.timeoutMs),
    )

    try {
      return await Promise.race([this.collectAndScore(clientId, searchTerm, handles.market), timeout])
    } catch {
      return fallback
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchHandles(clientId: string, domain: string): Promise<ClientAdHandles> {
    try {
      const { data } = await this.supabase
        .from('clients')
        .select('name, semrush_db')
        .eq('id', clientId)
        .single()
      const row = data as { name: string | null; semrush_db: string | null } | null
      // semrush_db is 'au' or 'nz' — map to ISO country code for Ad Library queries.
      const market = (row?.semrush_db ?? 'au').toUpperCase()
      return {
        domain,
        brandName: row?.name ?? null,
        market,
      }
    } catch {
      return { domain, brandName: null, market: 'AU' }
    }
  }

  private async collectAndScore(
    clientId: string,
    searchTerm: string,
    market: string,
  ): Promise<AdsCollectorResult> {
    const [metaSettled, googleSettled] = await Promise.allSettled([
      scrapeCompetitorMetaAds(searchTerm, market),
      scrapeGoogleAdsTransparency(searchTerm, market),
    ])

    const meta_ads = metaSettled.status === 'fulfilled' ? metaSettled.value : null
    const google_ads = googleSettled.status === 'fulfilled' ? googleSettled.value : null

    // If both Apify calls failed, we cannot evaluate — degrade gracefully.
    if (!meta_ads && !google_ads) {
      return { score: null, findings: [], meta_ads: null, google_ads: null }
    }

    const metaActive   = (meta_ads?.activeAdsCount ?? 0) > 0
    const googleActive = (google_ads?.activeAdsCount ?? 0) > 0
    const findings: NewFinding[] = []

    // No active ads anywhere → critical
    if (!metaActive && !googleActive) {
      findings.push(this.makeNoActiveAdsFinding(clientId, meta_ads, google_ads))
      return { score: 0, findings, meta_ads, google_ads }
    }

    // Single-platform → budget inefficiency finding (medium)
    if (metaActive !== googleActive) {
      findings.push(this.makeSinglePlatformFinding(clientId, metaActive, meta_ads, google_ads))
    }

    // Low volume on an active platform
    const metaCount   = meta_ads?.activeAdsCount ?? 0
    const googleCount = google_ads?.activeAdsCount ?? 0

    if (metaActive && metaCount < LOW_AD_VOLUME_THRESHOLD) {
      findings.push(this.makeLowVolumeFinding(clientId, 'Meta', metaCount, meta_ads))
    }
    if (googleActive && googleCount < LOW_AD_VOLUME_THRESHOLD) {
      findings.push(this.makeLowVolumeFinding(clientId, 'Google', googleCount, google_ads))
    }

    // Creative diversity — single creative format suggests under-investment in testing
    const metaTypes   = meta_ads?.adTypes.length ?? 0
    const googleFmts  = google_ads?.adFormats.length ?? 0
    if (metaActive && metaTypes <= 1) {
      findings.push(this.makeWeakCreativeFinding(clientId, 'Meta', meta_ads?.adTypes ?? []))
    }
    if (googleActive && googleFmts <= 1) {
      findings.push(this.makeWeakCreativeFinding(clientId, 'Google', google_ads?.adFormats ?? []))
    }

    const score = this.computeScore(metaActive, googleActive, metaCount, googleCount, metaTypes, googleFmts)
    return { score, findings, meta_ads, google_ads }
  }

  private computeScore(
    metaActive: boolean,
    googleActive: boolean,
    metaCount: number,
    googleCount: number,
    metaTypes: number,
    googleFmts: number,
  ): number {
    const platformScore = metaActive && googleActive ? 100 : metaActive || googleActive ? 50 : 0

    const volumeFor = (n: number): number => {
      if (n === 0) return 0
      if (n >= STRONG_AD_VOLUME) return 100
      return Math.round((n / STRONG_AD_VOLUME) * 100)
    }
    const volScores: number[] = []
    if (metaActive)   volScores.push(volumeFor(metaCount))
    if (googleActive) volScores.push(volumeFor(googleCount))
    const volumeScore = volScores.length === 0 ? 0
      : volScores.reduce((a, b) => a + b, 0) / volScores.length

    const creativeFor = (types: number): number => {
      if (types === 0) return 0
      if (types === 1) return 30
      if (types === 2) return 65
      return 100
    }
    const creativeScores: number[] = []
    if (metaActive)   creativeScores.push(creativeFor(metaTypes))
    if (googleActive) creativeScores.push(creativeFor(googleFmts))
    const creativeScore = creativeScores.length === 0 ? 0
      : creativeScores.reduce((a, b) => a + b, 0) / creativeScores.length

    const raw =
      platformScore * PLATFORM_WEIGHT +
      volumeScore   * VOLUME_WEIGHT +
      creativeScore * CREATIVE_WEIGHT
    return Math.min(100, Math.max(0, Math.round(raw)))
  }

  // ─── Findings factories ─────────────────────────────────────────────────────

  private makeNoDomainFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ads',
      finding_type: 'budget_inefficiency',
      severity: 'high',
      title: 'Client domain not configured',
      description: 'Cannot evaluate advertising activity without a domain — the Meta Ad Library and Google Ads Transparency Center both require a brand/domain search term.',
      evidence: makeEvidence({ parsed: { domain: null } }),
      recommendation: 'Open Client Settings → General and set the primary domain. Re-run diagnostic.',
      fix_type: 'fde_manual',
      priority_score: 80,
    }
  }

  private makeNoActiveAdsFinding(
    clientId: string,
    meta: MetaAdData | null,
    google: GoogleAdsData | null,
  ): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ads',
      finding_type: 'budget_inefficiency',
      severity: 'high',
      title: 'No active paid advertising detected',
      description: 'No active ads found on Meta Ad Library or Google Ads Transparency Center. Paid acquisition is a major growth lever for AU/NZ service businesses; running zero ads leaves performance entirely dependent on organic and word-of-mouth.',
      evidence: makeEvidence({
        parsed: {
          meta: meta ? { active_ads: meta.activeAdsCount, queried: meta.domain } : { error: 'fetch_failed' },
          google: google ? { active_ads: google.activeAdsCount, queried: google.advertiser } : { error: 'fetch_failed' },
        },
        raw: { meta, google },
        sources: adsSources(),
      }),
      recommendation: 'Start with a small Meta Ads test budget ($20–50/day) targeting the highest-intent audience, then layer Google Search ads once Meta proves profitable.',
      fix_type: 'fde_manual',
      priority_score: 80,
    }
  }

  private makeSinglePlatformFinding(
    clientId: string,
    metaActive: boolean,
    meta: MetaAdData | null,
    google: GoogleAdsData | null,
  ): NewFinding {
    const active   = metaActive ? 'Meta' : 'Google'
    const missing  = metaActive ? 'Google' : 'Meta'
    return {
      client_id: clientId,
      dimension: 'ads',
      finding_type: 'budget_inefficiency',
      severity: 'medium',
      title: `Running ads on ${active} only — missing ${missing}`,
      description: `Active paid advertising detected on ${active} but no ads found on ${missing}. Single-platform concentration leaves intent-based or discovery-based demand untapped and increases CAC volatility.`,
      evidence: makeEvidence({
        parsed: {
          meta: meta ? { active_ads: meta.activeAdsCount } : null,
          google: google ? { active_ads: google.activeAdsCount } : null,
        },
        raw: { meta, google },
        sources: adsSources(),
      }),
      recommendation: missing === 'Google'
        ? 'Add Google Search ads on brand + 3–5 top commercial-intent keywords to capture bottom-funnel demand.'
        : 'Add Meta Ads on Facebook + Instagram to capture top-funnel demand and retarget site visitors.',
      fix_type: 'fde_manual',
      priority_score: 60,
    }
  }

  private makeLowVolumeFinding(
    clientId: string,
    platform: 'Meta' | 'Google',
    count: number,
    raw: MetaAdData | GoogleAdsData | null,
  ): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ads',
      finding_type: 'budget_inefficiency',
      severity: 'medium',
      title: `Low ad volume on ${platform}`,
      description: `Only ${count} active ad${count === 1 ? '' : 's'} on ${platform}. Below ${LOW_AD_VOLUME_THRESHOLD} active ads severely limits creative testing and audience exploration.`,
      evidence: makeEvidence({
        parsed: { platform, active_ads: count },
        raw,
        sources: [evidenceSource(platform === 'Meta' ? META_AD_LIBRARY_URL : GOOGLE_ADS_TRANSPARENCY_URL)],
      }),
      recommendation: `Build out at least 3–5 active ${platform} ads covering different angles (offer, social proof, urgency) to enable proper A/B testing.`,
      fix_type: 'fde_manual',
      priority_score: 50,
    }
  }

  private makeWeakCreativeFinding(
    clientId: string,
    platform: 'Meta' | 'Google',
    formats: string[],
  ): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ads',
      finding_type: 'poor_landing_page_relevance',
      severity: 'medium',
      title: `Weak creative diversity on ${platform}`,
      description: `Only ${formats.length} creative format${formats.length === 1 ? '' : 's'} (${formats.join(', ') || 'none'}) detected on ${platform}. Format diversity (image + video + carousel) typically lifts CTR by 30–50% on Meta and Quality Score on Google.`,
      evidence: makeEvidence({
        parsed: { platform, formats },
        sources: [evidenceSource(platform === 'Meta' ? META_AD_LIBRARY_URL : GOOGLE_ADS_TRANSPARENCY_URL)],
      }),
      recommendation: platform === 'Meta'
        ? 'Add at least one video ad (Reels-style) and one carousel ad alongside static image ads.'
        : 'Add Responsive Search Ads, Performance Max, and at least one video campaign (YouTube) for full-funnel coverage.',
      fix_type: 'fde_manual',
      priority_score: 45,
    }
  }
}
