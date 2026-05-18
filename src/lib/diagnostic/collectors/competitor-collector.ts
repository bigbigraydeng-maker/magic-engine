import { getDomainMetrics } from '@/lib/semrush/client'
import { getCompetitorDomains } from '@/lib/dataforseo/client'
import type { CompetitorDomain } from '@/lib/dataforseo/client'
import { scrapeCompetitorMetaAds } from '@/lib/apify/ad-library'
import type { MetaAdData } from '@/lib/apify/ad-library'
import { analyzeCompetitorSite } from '@/lib/diagnostic/competitor-site-analyzer'
import type { CompetitorSiteSignals } from '@/lib/diagnostic/competitor-site-analyzer'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'

function urlFor(domain: string): string {
  return domain.startsWith('http') ? domain : `https://${domain}`
}

// ---------------------------------------------------------------------------
// Extended return type
// ---------------------------------------------------------------------------

export interface CompetitorEntry extends CompetitorDomain {
  meta_ads?: MetaAdData
  site_signals?: CompetitorSiteSignals  // P8.10.S2.2
}

// P8.10.S2.2: emit content_gap when competitor avg CTA count is ≥2x client's
const CONTENT_GAP_RATIO = 2

export interface CompetitorCollectorResult extends CollectorResult {
  competitorList: CompetitorEntry[]
}

// ---------------------------------------------------------------------------
// CompetitorCollector
// ---------------------------------------------------------------------------

export class CompetitorCollector {
  async collect(
    clientId: string,
    domain: string,
    _keywords: string[],
  ): Promise<CompetitorCollectorResult> {
    // 1. Get competitor domains from DataForSEO
    let competitors: CompetitorDomain[]
    try {
      competitors = await getCompetitorDomains(domain, 5)
    } catch {
      competitors = []
    }

    // P8.5.21: insufficient competitor data → score is unknowable, not "average"
    if (competitors.length < 3) {
      return {
        score: null,
        findings: [this.makeCompetitorDataInsufficientFinding(clientId, competitors.length)],
        competitorList: competitors as CompetitorEntry[],
      }
    }

    // 2. Fetch SEMrush domain_ranks for client + all competitors concurrently
    const allDomains = [domain, ...competitors.map(c => c.domain)]
    const metricsResults = await Promise.allSettled(
      allDomains.map(d => getDomainMetrics(d)),
    )

    const clientMetrics =
      metricsResults[0].status === 'fulfilled' ? metricsResults[0].value : null

    const competitorList: CompetitorEntry[] = competitors
      .map((comp, i) => {
        const settled = metricsResults[i + 1]
        const traffic =
          settled.status === 'fulfilled'
            ? settled.value.organic_traffic
            : comp.organic_traffic
        const authorityScore =
          settled.status === 'fulfilled'
            ? settled.value.authority_score
            : comp.authority_score
        return { ...comp, organic_traffic: traffic, authority_score: authorityScore }
      })
      .sort((a, b) => b.overlap_score - a.overlap_score)

    // 3. Scrape Meta Ads for top 3 competitors — serial to respect rate limits
    const top3 = competitorList.slice(0, 3)
    for (const comp of top3) {
      try {
        comp.meta_ads = await scrapeCompetitorMetaAds(comp.domain)
      } catch {
        // non-fatal: proceed without ad data for this competitor
      }
    }

    // 3b. P8.10.S2.2: Fetch homepage signals for client + top 3 competitors in parallel
    const [clientSignals, ...competitorSignals] = await Promise.all([
      analyzeCompetitorSite(domain).catch(() => null),
      ...top3.map(c => analyzeCompetitorSite(c.domain).catch(() => null)),
    ])
    top3.forEach((comp, i) => {
      const sig = competitorSignals[i]
      if (sig) comp.site_signals = sig
    })

    // 4. Compute score
    const clientTraffic = clientMetrics?.organic_traffic ?? 0
    const avgCompetitorTraffic =
      competitorList.reduce((sum, c) => sum + c.organic_traffic, 0) / competitorList.length

    const ratio = avgCompetitorTraffic > 0 ? clientTraffic / avgCompetitorTraffic : 1
    const score = Math.min(100, Math.round(ratio * 100))

    // 5. Generate findings
    const findings: NewFinding[] = []

    if (ratio < 0.1) {
      findings.push({
        client_id: clientId,
        dimension: 'competitor',
        finding_type: 'traffic_gap_large',
        severity: 'critical',
        title: 'Large Organic Traffic Gap vs Competitors',
        description: `Your organic traffic is only ${Math.round(ratio * 100)}% of the average competitor traffic. This represents a significant competitive disadvantage.`,
        evidence: makeEvidence({
          parsed: {
            client_traffic: clientTraffic,
            avg_competitor_traffic: Math.round(avgCompetitorTraffic),
            ratio: Math.round(ratio * 1000) / 1000,
            top_competitors: competitorList.slice(0, 3).map(c => ({
              domain: c.domain,
              traffic: c.organic_traffic,
            })),
          },
          sources: [
            evidenceSource(urlFor(domain)),
            ...competitorList.slice(0, 3).map(c => evidenceSource(urlFor(c.domain))),
          ],
        }),
        recommendation:
          'Invest in content marketing and SEO to close the traffic gap. Focus on high-intent keywords where competitors rank but you do not.',
        fix_type: 'fde_manual',
        priority_score: 90,
      })
    }

    // P8.10.S2.2: Content gap — competitors carry significantly more CTAs than client
    if (clientSignals && competitorSignals.filter(Boolean).length >= 2) {
      const competitorCtas = competitorSignals
        .filter((s): s is CompetitorSiteSignals => s !== null)
        .map(s => s.cta_count)
      const avgCompCta = competitorCtas.reduce((a, b) => a + b, 0) / competitorCtas.length
      if (clientSignals.cta_count > 0 && avgCompCta >= clientSignals.cta_count * CONTENT_GAP_RATIO) {
        findings.push({
          client_id: clientId,
          dimension: 'competitor',
          finding_type: 'competitor_content_gap',
          severity: 'medium',
          title: 'Competitors run richer conversion paths',
          description: `Top competitors expose ~${Math.round(avgCompCta)} call-to-action links on their homepage vs your ${clientSignals.cta_count}. Visitors arriving from search have ${Math.round((avgCompCta / Math.max(1, clientSignals.cta_count)) * 100) / 100}× more conversion entry points.`,
          evidence: makeEvidence({
            parsed: {
              client_cta_count: clientSignals.cta_count,
              client_cta_examples: clientSignals.cta_examples,
              avg_competitor_cta_count: Math.round(avgCompCta * 10) / 10,
              competitor_signals: competitorSignals
                .filter((s): s is CompetitorSiteSignals => s !== null)
                .map(s => ({
                  domain: s.domain,
                  cta_count: s.cta_count,
                  cta_examples: s.cta_examples.slice(0, 3),
                  landing_page_type: s.landing_page_type,
                })),
            },
            sources: [
              evidenceSource(urlFor(domain)),
              ...competitorSignals
                .filter((s): s is CompetitorSiteSignals => s !== null)
                .map(s => evidenceSource(urlFor(s.domain))),
            ],
          }),
          recommendation: 'Audit homepage and key landing pages — add primary CTAs (Book / Enquire / Get a quote) above the fold and in the footer. Aim for 5–8 distinct conversion paths.',
          fix_type: 'fde_manual',
          priority_score: 55,
        })
      }
    }

    return { score, findings, competitorList }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private makeCompetitorDataInsufficientFinding(
    clientId: string,
    found: number,
  ): NewFinding {
    return {
      client_id: clientId,
      dimension: 'competitor',
      finding_type: 'competitor_data_insufficient',
      severity: 'high',
      title:
        found === 0
          ? 'No organic competitors detected'
          : `Only ${found} organic competitor${found === 1 ? '' : 's'} detected (minimum 3 required)`,
      description:
        found === 0
          ? 'DataForSEO returned zero competitor domains. The domain likely has no organic keyword rankings yet, so the competitive landscape cannot be measured.'
          : `Only ${found} competitor domain${found === 1 ? '' : 's'} found — not enough signal to score the competitive landscape (minimum 3 needed for meaningful comparison).`,
      evidence: makeEvidence({ parsed: { competitors_found: found, competitors_required: 3 } }),
      recommendation:
        found === 0
          ? 'Get the site indexed and earn organic keyword rankings first (see SEO dimension). Re-run competitor analysis once any keywords rank in top 100.'
          : 'Run SEMrush competitive research manually to identify a broader competitive set; supplement with industry-known competitors via Client Settings → Competitors.',
      fix_type: found === 0 ? 'fde_manual' : 'me_auto',
      priority_score: found === 0 ? 70 : 50,
    }
  }
}
