import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'
import type { StrategyItem } from '@/lib/strategy/types'
import type {
  WebsiteGrowthAction,
  WebsiteGrowthAgentInput,
  WebsiteGrowthLane,
  WebsiteGrowthMeasurement,
  WebsiteGrowthPlan,
  WebsitePageSignal,
} from './types'

interface Candidate {
  lane: WebsiteGrowthLane
  baseScore: number
  actionType: string
  whyNow: string
  evidenceRefs: string[]
  effort: 'low' | 'medium' | 'high'
  executionMode: 'in_house' | 'external_manual'
  executableBy: string | null
  suggestionKey: string
  measurement: WebsiteGrowthMeasurement
  metadata: Record<string, unknown>
}

const PAGE_CLICK_MEASUREMENT: WebsiteGrowthMeasurement = {
  metric_key: 'seo.gsc.page_clicks',
  scope: 'page',
  success_direction: 'increase',
  starts_after: 'pr_merged',
}

const GEO_MEASUREMENT: WebsiteGrowthMeasurement = {
  metric_key: 'geo.query.mention_rate',
  scope: 'query',
  success_direction: 'increase',
  starts_after: 'pr_merged',
}

const DOMAIN_TRAFFIC_MEASUREMENT: WebsiteGrowthMeasurement = {
  metric_key: 'seo.domain.organic_traffic',
  scope: 'domain',
  success_direction: 'increase',
  starts_after: 'published',
}

export function planWebsiteGrowth(input: WebsiteGrowthAgentInput): WebsiteGrowthPlan {
  const candidates = [
    ...input.pages.flatMap(pageCandidates),
    ...input.strategyItems.flatMap((item) => strategyCandidates(item, input.pages)),
  ]

  const feedback = input.feedback
  const suppressed = new Set([
    ...(feedback?.dismissed_keys ?? []),
    ...(feedback?.irrelevant_keys ?? []),
  ])
  let suppressedSuggestions = 0

  const scored = dedupeCandidates(candidates)
    .flatMap((candidate): WebsiteGrowthAction[] => {
      if (
        suppressed.has(candidate.suggestionKey) ||
        suppressed.has(candidate.actionType)
      ) {
        suppressedSuggestions += 1
        return []
      }

      const learned = learningAdjustment(candidate, input)
      const score = clamp(candidate.baseScore + learned.adjustment, 0, 100)
      const impact = score >= 85 ? 'high' : score >= 65 ? 'medium' : 'low'

      return [{
        rank: 0,
        dimension: candidate.lane === 'ai_visibility' ? 'ai_visibility' : 'seo',
        action_type: candidate.actionType,
        why_now: candidate.whyNow,
        evidence_refs: candidate.evidenceRefs,
        expected_impact: impact,
        effort: candidate.effort,
        execution_mode: candidate.executionMode,
        executable_by: candidate.executableBy,
        metadata: {
          ...candidate.metadata,
          agent: 'website_growth',
          suggestion_key: candidate.suggestionKey,
          expected_metric: candidate.measurement.metric_key,
        },
        lane: candidate.lane,
        score,
        suggestion_key: candidate.suggestionKey,
        learning_adjustment: learned.adjustment,
        learning_reasons: learned.reasons,
        measurement: candidate.measurement,
      }]
    })
    .filter((action) => action.evidence_refs.length > 0)
    .sort((a, b) => b.score - a.score || a.suggestion_key.localeCompare(b.suggestion_key))
    .slice(0, clamp(input.maxActions ?? 3, 1, 5))
    .map((action, index) => ({ ...action, rank: index + 1 }))

  return {
    agent: 'website_growth',
    client_id: input.clientId,
    domain: input.domain,
    generated_at: (input.now ?? new Date()).toISOString(),
    mode: 'proposal_only',
    baseline: {
      pages_scanned: input.pages.length,
      strategy_items_scanned: input.strategyItems.length,
      broken_pages: input.pages.filter((p) => isBroken(p.status_code)).length,
      thin_commercial_pages: input.pages.filter(isThinCommercialPage).length,
      pages_without_geo_block: input.pages.filter((p) => !p.has_geo_block).length,
    },
    learning: {
      memory_loaded: input.memory?.has_content ?? false,
      feedback_events_sampled: feedback?.total ?? 0,
      suppressed_suggestions: suppressedSuggestions,
    },
    actions: scored,
    guardrails: [
      'No production change is made by planning this run.',
      'Content and metadata changes require review through the execution queue and a GitHub pull request.',
      'Measurement starts only after publish or PR merge; the agent must not claim uplift before an attributed outcome exists.',
    ],
  }
}

function pageCandidates(page: WebsitePageSignal): Candidate[] {
  const out: Candidate[] = []
  const urlKey = canonicalKey(page.url)
  const pageEvidence = `client_site_pages:${page.id}`
  const keyword = page.primary_keyword?.trim() || page.url

  if (isBroken(page.status_code)) {
    out.push({
      lane: 'technical_seo',
      baseScore: 100,
      actionType: 'website.repair_broken_page',
      whyNow: `${page.url} returned HTTP ${page.status_code}; repair or redirect it before investing in content.` ,
      evidenceRefs: [pageEvidence, `status_code:${page.status_code}`],
      effort: 'medium',
      executionMode: 'external_manual',
      executableBy: null,
      suggestionKey: `website:repair:${urlKey}`,
      measurement: PAGE_CLICK_MEASUREMENT,
      metadata: { page_id: page.id, page_url: page.url, keyword },
    })
  }

  if (!page.title?.trim()) {
    out.push({
      lane: 'technical_seo',
      baseScore: 92,
      actionType: CMS_ACTION_TYPE.META_UPDATE,
      whyNow: `${page.url} has no crawlable title, weakening relevance and search-result clarity.`,
      evidenceRefs: [pageEvidence, 'title:missing'],
      effort: 'low',
      executionMode: 'in_house',
      executableBy: null,
      suggestionKey: `website:title:${urlKey}`,
      measurement: PAGE_CLICK_MEASUREMENT,
      metadata: { page_id: page.id, page_url: page.url, keyword, field: 'metaTitle' },
    })
  }

  if (isThinCommercialPage(page)) {
    out.push({
      lane: 'content_intent',
      baseScore: 84,
      actionType: CMS_ACTION_TYPE.UPDATE_EXISTING,
      whyNow: `${page.url} is a ${page.page_type} page with only ${page.word_count ?? 0} words; strengthen intent coverage before creating another page.`,
      evidenceRefs: [pageEvidence, `word_count:${page.word_count ?? 0}`, `page_type:${page.page_type}`],
      effort: 'medium',
      executionMode: 'in_house',
      executableBy: null,
      suggestionKey: `website:upgrade:${urlKey}`,
      measurement: PAGE_CLICK_MEASUREMENT,
      metadata: { page_id: page.id, page_url: page.url, keyword },
    })
  }

  if (isCommercialPage(page) && !page.primary_keyword?.trim()) {
    out.push({
      lane: 'content_intent',
      baseScore: 78,
      actionType: CMS_ACTION_TYPE.UPDATE_EXISTING,
      whyNow: `${page.url} is a commercial page without a primary search intent mapped to it.`,
      evidenceRefs: [pageEvidence, 'primary_keyword:missing', `page_type:${page.page_type}`],
      effort: 'medium',
      executionMode: 'in_house',
      executableBy: null,
      suggestionKey: `website:intent:${urlKey}`,
      measurement: PAGE_CLICK_MEASUREMENT,
      metadata: { page_id: page.id, page_url: page.url, keyword },
    })
  }

  // GEO remains in the loop, but below broken pages and commercial-intent gaps.
  // It earns priority only when the page is already a meaningful service/landing page.
  if (isCommercialPage(page) && !page.has_geo_block) {
    out.push({
      lane: 'ai_visibility',
      baseScore: 58,
      actionType: 'geo.enrich_existing_page',
      whyNow: `${page.url} lacks an answer-ready GEO block; add it after core technical and intent issues are handled.`,
      evidenceRefs: [pageEvidence, 'has_geo_block:false'],
      effort: 'medium',
      executionMode: 'in_house',
      executableBy: null,
      suggestionKey: `website:geo:${urlKey}`,
      measurement: GEO_MEASUREMENT,
      metadata: { page_id: page.id, page_url: page.url, keyword },
    })
  }

  return out
}

function strategyCandidates(item: StrategyItem, pages: WebsitePageSignal[]): Candidate[] {
  if (item.status === 'dismissed' || item.status === 'done') return []

  const page = item.source_page_id
    ? pages.find((candidate) => candidate.id === item.source_page_id)
    : undefined
  const key = item.source_keyword?.trim() || item.id
  const baseScore = clamp(Math.round(item.priority_score * 0.9), 45, 90)

  if (item.action_type === 'upgrade_page') {
    return [{
      lane: item.content_mode === 'geo_only' ? 'ai_visibility' : 'content_intent',
      baseScore: item.content_mode === 'geo_only' ? baseScore * 0.72 : baseScore,
      actionType: item.content_mode === 'geo_only'
        ? 'geo.enrich_existing_page'
        : CMS_ACTION_TYPE.UPDATE_EXISTING,
      whyNow: item.rationale,
      evidenceRefs: [`content_strategy_items:${item.id}`],
      effort: 'medium',
      executionMode: 'in_house',
      executableBy: null,
      suggestionKey: `website:strategy:${item.id}`,
      measurement: item.content_mode === 'geo_only' ? GEO_MEASUREMENT : PAGE_CLICK_MEASUREMENT,
      metadata: {
        strategy_item_id: item.id,
        page_id: item.source_page_id,
        page_url: page?.url ?? null,
        keyword: key,
        content_mode: item.content_mode,
      },
    }]
  }

  if (item.action_type === 'new_blog') {
    return [{
      lane: item.content_mode === 'geo_only' ? 'ai_visibility' : 'content_intent',
      baseScore: item.content_mode === 'geo_only' ? baseScore * 0.72 : baseScore,
      actionType: 'seo.publish_blog',
      whyNow: item.rationale,
      evidenceRefs: [`content_strategy_items:${item.id}`],
      effort: 'medium',
      executionMode: 'in_house',
      executableBy: 'luban.generate_blog_post',
      suggestionKey: `website:strategy:${item.id}`,
      measurement: DOMAIN_TRAFFIC_MEASUREMENT,
      metadata: {
        strategy_item_id: item.id,
        keyword: key,
        proposed_title: item.proposed_title,
        content_mode: item.content_mode,
      },
    }]
  }

  return []
}

function learningAdjustment(candidate: Candidate, input: WebsiteGrowthAgentInput) {
  let adjustment = 0
  const reasons: string[] = []
  const haystack = candidateFingerprint(candidate)
  const memory = input.memory

  for (const pattern of memory?.proven_patterns ?? []) {
    if (matchesMemory(pattern.pattern_content, haystack)) {
      adjustment += 8
      reasons.push('boosted by a proven client pattern')
      break
    }
  }

  for (const experiment of memory?.failed_experiments ?? []) {
    if (
      matchesMemory(`${experiment.experiment_description} ${experiment.failure_reason}`, haystack) ||
      (experiment.dimension === 'ai_visibility' && candidate.lane === 'ai_visibility')
    ) {
      adjustment -= 18
      reasons.push('penalised by a previous failed experiment')
      break
    }
  }

  const matchingDecision = (memory?.recent_decisions ?? []).find(
    (decision) => decision.chosen_action === candidate.actionType,
  )
  if (matchingDecision?.outcome_verdict === 'success') {
    adjustment += 6
    reasons.push('boosted by a successful prior decision')
  } else if (matchingDecision?.outcome_verdict === 'failure') {
    adjustment -= 15
    reasons.push('penalised by a failed prior decision')
  }

  if ((input.feedback?.recent_events ?? []).some(
    (event) => event.feedback_state === 'done' && (
      event.suggestion_key === candidate.suggestionKey ||
      event.suggestion_key === candidate.actionType
    ),
  )) {
    adjustment += 5
    reasons.push('boosted by completed feedback on the same suggestion family')
  }

  return { adjustment: clamp(adjustment, -30, 20), reasons }
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.suggestionKey)
    if (!existing || candidate.baseScore > existing.baseScore) {
      byKey.set(candidate.suggestionKey, candidate)
    } else if (candidate.baseScore === existing.baseScore) {
      existing.evidenceRefs = Array.from(new Set([...existing.evidenceRefs, ...candidate.evidenceRefs]))
    }
  }
  return Array.from(byKey.values())
}

function candidateFingerprint(candidate: Candidate): string[] {
  const metadata = Object.values(candidate.metadata)
    .filter((value): value is string => typeof value === 'string')
  return [candidate.actionType, candidate.suggestionKey, ...metadata]
}

function matchesMemory(memoryText: string, needles: string[]): boolean {
  const text = memoryText.toLowerCase()
  return needles.some((needle) => {
    const normalized = needle.toLowerCase().trim()
    return normalized.length >= 4 && text.includes(normalized)
  })
}

function isCommercialPage(page: WebsitePageSignal): boolean {
  return ['service', 'product', 'landing'].includes(page.page_type)
}

function isThinCommercialPage(page: WebsitePageSignal): boolean {
  return isCommercialPage(page) && (page.word_count ?? 0) < 350
}

function isBroken(status: number | null): boolean {
  return status !== null && (status < 200 || status >= 400)
}

function canonicalKey(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '') || '/'}`
  } catch {
    return value.trim().toLowerCase()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
