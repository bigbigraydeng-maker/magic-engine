import { getKeywordsForSite } from '@/lib/dataforseo/labs'
import type { LabsKeyword } from '@/lib/dataforseo/labs'
import { getBacklinkSummary, getSerpRankings } from '@/lib/dataforseo/client'
import type { BacklinkSummary, SerpRanking } from '@/lib/dataforseo/client'
import { auditTechnicalSeo } from '@/lib/diagnostic/technical-seo'
import type { TechnicalSeoSignals } from '@/lib/diagnostic/technical-seo'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// P8.10.S2.6: helper for source URL referencing the audited domain.
function domainSources(domain: string): ReturnType<typeof evidenceSource>[] {
  if (!domain) return []
  const url = domain.startsWith('http') ? domain : `https://${domain}`
  return [evidenceSource(url)]
}

// ─── Scoring weights (must sum to 100) ───────────────────────────────────────
const KW_COVERAGE_WEIGHT  = 50   // was 70; reduced to make room for technical
const AUTHORITY_WEIGHT    = 25   // was 30
const TECHNICAL_WEIGHT    = 25   // new: Jina homepage audit signals
const LOW_AUTHORITY_THRESHOLD = 20
const ORGANIC_KW_LIMIT    = 200

// P8.10.S2.1: backlink + SERP thresholds (informational findings, do not affect score)
const LOW_REFERRING_DOMAINS_THRESHOLD = 10
const BURIED_POSITION_THRESHOLD = 30
const SERP_SAMPLE_KEYWORDS = 10   // max target keywords to query SERP for (cost cap)

export class SeoCollector {
  private readonly timeoutMs: number

  constructor(timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  async collect(
    clientId: string,
    clientDomain: string,
    keywords: string[],
    gscQueries: string[] = [],
  ): Promise<CollectorResult> {
    // Use approved target keywords first; fall back to real GSC queries when
    // no target keywords are configured but the client has authorised GSC.
    const effectiveKeywords = keywords.length > 0 ? keywords : gscQueries

    if (effectiveKeywords.length === 0) {
      return {
        score: null,
        findings: [this.makeKeywordsNotConfiguredFinding(clientId)],
      }
    }

    const fallback: CollectorResult = { score: null, findings: [] }
    const timeout = new Promise<CollectorResult>(resolve =>
      setTimeout(() => resolve(fallback), this.timeoutMs),
    )

    try {
      return await Promise.race([this.fetchAndScore(clientId, clientDomain, effectiveKeywords), timeout])
    } catch {
      return fallback
    }
  }

  private async fetchAndScore(
    clientId: string,
    domain: string,
    keywords: string[],
  ): Promise<CollectorResult> {
    // Map SEMRUSH_DB region env var to DataForSEO location code (AU=2036, NZ=2554).
    const locationCode = process.env.SEMRUSH_DB === 'nz' ? 2554 : 2036
    const db = process.env.SEMRUSH_DB ?? 'au'
    const serpKeywords = keywords.slice(0, SERP_SAMPLE_KEYWORDS)

    // getKeywordsForSite is critical — let it throw so the outer catch degrades gracefully.
    // Backlink + SERP calls are optional — failures return fallback values.
    const [rankedKwData, technical, backlinks, serpRankings] = await Promise.all([
      getKeywordsForSite(domain, locationCode, ORGANIC_KW_LIMIT),
      auditTechnicalSeo(domain),
      getBacklinkSummary(domain).catch((): BacklinkSummary | null => null),
      getSerpRankings(domain, serpKeywords, db).catch(() => [] as SerpRanking[]),
    ])

    // Derive authority score from DataForSEO backlink rank (0–1000 → 0–100).
    const authorityScore = backlinks ? Math.round(backlinks.rank / 10) : 0

    const rankedSet = new Set(rankedKwData.map((k: LabsKeyword) => k.keyword.toLowerCase()))
    const matched = keywords.filter(k => rankedSet.has(k.toLowerCase())).length
    const total = keywords.length
    const coverageRatio = matched / total

    return this.buildResult(clientId, domain, authorityScore, coverageRatio, total, matched, technical, backlinks, serpRankings)
  }

  private buildResult(
    clientId: string,
    domain: string,
    authorityScore: number,
    coverageRatio: number,
    total: number,
    matched: number,
    technical: TechnicalSeoSignals,
    backlinks: BacklinkSummary | null,
    serpRankings: SerpRanking[],
  ): CollectorResult {
    const sources = domainSources(domain)
    const authority = Math.min(100, Math.max(0, authorityScore))
    const raw =
      coverageRatio * KW_COVERAGE_WEIGHT +
      (authority / 100) * AUTHORITY_WEIGHT +
      (technical.score / 100) * TECHNICAL_WEIGHT
    const score = Math.min(100, Math.max(0, Math.round(raw)))

    const findings: NewFinding[] = []

    // ── Keyword findings ──────────────────────────────────────────────────────
    if (total > 0 && coverageRatio === 0) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'keyword_gap_critical',
        severity: 'critical',
        title: 'No target keywords found in organic rankings',
        description: `None of the ${total} target keywords appear in the top ${ORGANIC_KW_LIMIT} organic rankings.`,
        evidence: makeEvidence({ parsed: { total_keywords: total, matched_keywords: matched }, sources }),
        recommendation: 'Create targeted content for each keyword and build topical authority.',
        fix_type: 'fde_manual',
        priority_score: 95,
      })
    }

    // ── Authority finding ─────────────────────────────────────────────────────
    if (authorityScore < LOW_AUTHORITY_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'low_domain_rank',
        severity: 'high',
        title: 'Low domain authority score',
        description: `Domain authority is ${authorityScore}/100 — below the healthy threshold of ${LOW_AUTHORITY_THRESHOLD}.`,
        evidence: makeEvidence({ parsed: { authority_score: authorityScore }, sources }),
        recommendation: 'Build quality backlinks through digital PR and content partnerships.',
        fix_type: 'fde_manual',
        priority_score: 75,
      })
    }

    // ── Technical findings ────────────────────────────────────────────────────
    for (const issue of technical.issues) {
      const f = this.makeTechnicalFinding(clientId, issue, sources)
      if (f) findings.push(f)
    }

    // ── P8.10.S2.1: Backlink findings ─────────────────────────────────────────
    if (backlinks && backlinks.referring_domains < LOW_REFERRING_DOMAINS_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'low_referring_domains',
        severity: backlinks.referring_domains < 3 ? 'high' : 'medium',
        title: 'Thin backlink profile',
        description: `Only ${backlinks.referring_domains} referring domains linking to the site (healthy threshold: ${LOW_REFERRING_DOMAINS_THRESHOLD}+).`,
        evidence: makeEvidence({
          parsed: {
            referring_domains: backlinks.referring_domains,
            total_backlinks: backlinks.total_backlinks,
            rank: backlinks.rank,
            broken_backlinks: backlinks.broken_backlinks,
          },
          sources: [evidenceSource(`https://${domain}`, backlinks.fetched_at)],
        }),
        recommendation: 'Run digital PR, guest posting, and partnerships to grow referring domain count to 30+ within 6 months.',
        fix_type: 'fde_manual',
        priority_score: backlinks.referring_domains < 3 ? 70 : 50,
      })
    }

    // ── P8.10.S2.1: SERP ranking findings ─────────────────────────────────────
    if (serpRankings.length > 0) {
      const ranked = serpRankings.filter(r => r.position !== null)
      const fetched_at = serpRankings[0]?.fetched_at

      if (ranked.length === 0) {
        findings.push({
          client_id: clientId,
          dimension: 'seo',
          finding_type: 'serp_invisible',
          severity: 'high',
          title: 'No target keywords visible in Google top 100',
          description: `Sampled ${serpRankings.length} target keywords on Google — none ranked in the top 100 SERP positions.`,
          evidence: makeEvidence({
            parsed: {
              sampled: serpRankings.length,
              ranked: 0,
              keywords: serpRankings.map(r => r.keyword),
            },
            sources: fetched_at ? [evidenceSource(`https://${domain}`, fetched_at)] : sources,
          }),
          recommendation: 'Build dedicated landing pages for each priority keyword with on-page SEO and internal linking before broader strategy.',
          fix_type: 'fde_manual',
          priority_score: 85,
        })
      } else {
        const avgPosition = Math.round(
          ranked.reduce((s, r) => s + (r.position ?? 0), 0) / ranked.length,
        )
        if (avgPosition > BURIED_POSITION_THRESHOLD) {
          findings.push({
            client_id: clientId,
            dimension: 'seo',
            finding_type: 'serp_buried',
            severity: 'medium',
            title: 'Target keywords ranking deep in SERP',
            description: `Ranked target keywords average position ${avgPosition} (healthy: top 30). Few users reach results past page 3.`,
            evidence: makeEvidence({
              parsed: {
                avg_position: avgPosition,
                ranked_count: ranked.length,
                sampled_count: serpRankings.length,
                positions: ranked.map(r => ({ keyword: r.keyword, position: r.position, url: r.url })),
              },
              sources: fetched_at
                ? ranked
                    .filter(r => r.url)
                    .map(r => evidenceSource(r.url as string, fetched_at))
                : sources,
            }),
            recommendation: 'Identify the highest-volume buried keywords and rebuild the corresponding landing pages with stronger on-page SEO + internal links.',
            fix_type: 'fde_manual',
            priority_score: 60,
          })
        }
      }
    }

    return { score, findings }
  }

  private makeTechnicalFinding(
    clientId: string,
    issue: TechnicalSeoSignals['issues'][number],
    sources: ReturnType<typeof evidenceSource>[],
  ): NewFinding | null {
    const base = { client_id: clientId, dimension: 'seo' as const, fix_type: 'fde_manual' as const }
    const ev = (parsed: Record<string, unknown> | null) =>
      makeEvidence({ parsed, sources })
    switch (issue) {
      case 'missing_meta_title':
        return { ...base, finding_type: 'missing_meta_title', severity: 'high', title: 'Page title is missing', description: 'The homepage has no <title> tag. This is a critical SEO signal for search engines and appears in search result snippets.', evidence: ev({ subtype: 'missing_meta_title' }), recommendation: 'Add a descriptive title tag (50–70 characters) including the primary keyword and brand name.', priority_score: 80 }
      case 'short_meta_title':
        // finding_type reuses 'missing_meta_title' (no separate type in schema);
        // distinguished by evidence.parsed.subtype for downstream filtering.
        return { ...base, finding_type: 'missing_meta_title', severity: 'medium', title: 'Page title length is not optimal', description: 'The homepage title is outside the ideal 30–70 character range for search snippet display.', evidence: ev({ subtype: 'short_meta_title' }), recommendation: 'Revise the title to be 50–70 characters, leading with the primary keyword.', priority_score: 45 }
      case 'missing_h1':
        return { ...base, finding_type: 'missing_h1', severity: 'high', title: 'Homepage missing H1 heading', description: 'No H1 heading found on the homepage. H1 is a primary on-page SEO signal and helps search engines understand page topic.', evidence: ev({ subtype: 'missing_h1' }), recommendation: 'Add a single H1 tag to the homepage that includes the primary keyword.', priority_score: 72 }
      case 'multiple_h1':
        // finding_type reuses 'missing_h1' (H1 is not correct); subtype distinguishes.
        return { ...base, finding_type: 'missing_h1', severity: 'medium', title: 'Multiple H1 headings detected', description: 'More than one H1 tag found on the homepage. Each page should have exactly one H1 to clearly signal the primary topic.', evidence: ev({ subtype: 'multiple_h1' }), recommendation: 'Consolidate to a single H1 tag; demote secondary headings to H2/H3.', priority_score: 40 }
      case 'thin_content':
        return { ...base, finding_type: 'thin_content', severity: 'medium', title: 'Homepage has thin content', description: 'The homepage contains fewer than 300 words of content. Thin pages rank poorly and provide little value to visitors.', evidence: ev({ subtype: 'thin_content' }), recommendation: 'Expand the homepage with service descriptions, value propositions, and local context (at least 400–600 words).', priority_score: 55 }
      case 'few_internal_links':
        return { ...base, finding_type: 'broken_internal_links', severity: 'low', title: 'Few internal links on homepage', description: 'Fewer than 5 internal links detected on the homepage, limiting link equity flow to key pages.', evidence: ev({ subtype: 'few_internal_links' }), recommendation: 'Add contextual internal links to main category and service pages.', priority_score: 30 }
      default:
        return null
    }
  }

  private makeKeywordsNotConfiguredFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'seo',
      finding_type: 'keywords_not_configured',
      severity: 'high',
      title: 'Target keywords not configured',
      description: 'No target keywords are configured for this client, so SEO performance cannot be measured. Add 10–20 priority keywords (mix of brand, category, and long-tail) to enable visibility tracking.',
      evidence: makeEvidence({ parsed: { configured_keywords: 0 } }),
      recommendation: 'Open Client Settings → SEO Keywords and add 10–20 keywords prioritising local intent ("flooring brisbane", "vinyl flooring qld"). Re-run diagnostic afterwards.',
      fix_type: 'fde_manual',
      priority_score: 90,
    }
  }
}
