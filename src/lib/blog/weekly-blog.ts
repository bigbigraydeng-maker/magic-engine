/**
 * Weekly blog batch (22.E.S16).
 *
 * For every client whose seo_config.weekly_blog is true, generate ONE blog
 * draft per calendar week:
 *
 *   1. Skip if any non-failed post was created in the last 6 days — the
 *      cadence is "one post a week" in total, human- or cron-initiated.
 *      failed/rejected rows don't count (a failed manual attempt must not
 *      silence the cron for the week). Idempotent across cron re-runs.
 *   2. Pick a topic: AI-visibility weak spots × keyword opportunities via
 *      getWeakSpotOpportunities (unified > geo_only > seo_only), skipping
 *      topics that overlap a recent post OR the brief's excluded_topics,
 *      then site-audit the pick (auditExistingContent) so we don't draft
 *      what the client's site already covers.
 *   3. Generate through the same quality gate as the manual route
 *      (generateWithQualityRetry: rubric audit, up to 3 attempts), persist
 *      a complete status='draft' row, and log the flywheel action.
 *      Drafts NEVER auto-publish: publishing stays behind human review
 *      (PM decision 2026-07-31, see ROADMAP § 22.E S15-S18 note).
 *
 * Direct lib composition — no internal HTTP self-calls (PR #297 rule).
 * No MTC charge: system-initiated generation is not billed to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { generateWithQualityRetry } from '@/lib/blog/generate-with-quality'
import { getWeakSpotOpportunities } from '@/lib/blog/topic-selector'
import { auditExistingContent } from '@/lib/blog/content-auditor'
import { checkContentDuplicate } from '@/lib/blog/content-gate'
import { fetchRelatedPages, buildPagesContextBlock } from '@/lib/blog/pages-context'
import { checkInternalLinks } from '@/lib/blog/internal-link-checker'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { SEO_ACTION_TYPE, SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import type { BlogOpportunity } from '@/types/magic-engine'

/** Don't generate if any non-failed post exists newer than this many days. */
const WEEKLY_COOLDOWN_DAYS = 6
/** A candidate topic is "already covered" if a post in this window used it. */
const TOPIC_DEDUP_DAYS = 60
/** How many opportunities to consider per client. */
const OPPORTUNITY_LIMIT = 20
/** Max site-audits per client per run (each is a crawl + AI call). */
const MAX_CONTENT_AUDITS = 3
/**
 * Batch time budget. The real ceiling is the cron's curl --max-time 900
 * (Next maxDuration is a Vercel knob, inert on Render) — stop starting new
 * clients past this point so in-flight work finishes inside the window.
 */
const BATCH_BUDGET_MS = 780_000
/** Blocked terms shorter than this only block on exact equality ("nz", "spc"). */
const MIN_SUBSTRING_LEN = 4

export interface WeeklyBlogClientResult {
  client_id: string
  name: string
  outcome:
    | 'generated'
    | 'skipped_recent_post'
    | 'skipped_no_topic'
    | 'skipped_time_budget'
    | 'error'
  post_id?: string
  topic?: string
  mode?: string
  error?: string
}

export interface WeeklyBlogBatchResult {
  clients_considered: number
  generated: number
  skipped: number
  failed: number
  results: WeeklyBlogClientResult[]
}

interface EligibleClient {
  id: string
  name: string
  domain: string | null
}

// ── Topic picking (pure) ────────────────────────────────────────────────────────

function overlapsTerm(candidate: string, term: string): boolean {
  // Short strings ("nz", "spc") substring-match nearly everything — for them
  // only exact equality counts as overlap.
  if (candidate.length < MIN_SUBSTRING_LEN || term.length < MIN_SUBSTRING_LEN) {
    return candidate === term
  }
  return candidate.includes(term) || term.includes(candidate)
}

/**
 * Pick opportunities whose topic/keyword doesn't overlap any blocked term
 * (recent post topics + brief excluded_topics), preserving the incoming
 * priority order (unified > geo_only > seo_only). Opportunities with no
 * usable text are dropped rather than waved through.
 */
export function pickFreshTopics(
  opportunities: BlogOpportunity[],
  blockedTerms: string[],
): BlogOpportunity[] {
  const normalised = blockedTerms.map((t) => t.toLowerCase().trim()).filter(Boolean)

  return opportunities.filter((opp) => {
    const candidates = [opp.query_text, opp.primary_keyword]
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.toLowerCase().trim())

    if (candidates.length === 0) return false
    return !candidates.some((c) => normalised.some((t) => overlapsTerm(c, t)))
  })
}

// ── Data loading ────────────────────────────────────────────────────────────────

async function loadBlockedTerms(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string[]> {
  const dedupStart = new Date()
  dedupStart.setDate(dedupStart.getDate() - TOPIC_DEDUP_DAYS)

  const [{ data: pastPosts }, { data: brief }] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('topic, primary_keyword')
      .eq('client_id', clientId)
      .gte('created_at', dedupStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('master_briefs')
      .select('excluded_topics')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const recentTopics = ((pastPosts ?? []) as Array<{ topic: string | null; primary_keyword: string | null }>)
    .flatMap((p) => [p.topic, p.primary_keyword])

  const excludedRaw = (brief as { excluded_topics?: unknown } | null)?.excluded_topics
  const excluded = Array.isArray(excludedRaw) ? excludedRaw : []

  return [...recentTopics, ...excluded].filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  )
}

// ── Per-client orchestration ────────────────────────────────────────────────────

async function runForClient(
  supabase: SupabaseClient,
  client: EligibleClient,
): Promise<WeeklyBlogClientResult> {
  const base: WeeklyBlogClientResult = {
    client_id: client.id,
    name: client.name,
    outcome: 'error',
  }

  try {
    // 1. Weekly cooldown — any real post (human or cron) counts toward the
    //    cadence. failed/rejected rows are empty placeholders, not output.
    const cooldownStart = new Date()
    cooldownStart.setDate(cooldownStart.getDate() - WEEKLY_COOLDOWN_DAYS)

    const { data: recentPosts, error: recentErr } = await supabase
      .from('blog_posts')
      .select('id')
      .eq('client_id', client.id)
      .gte('created_at', cooldownStart.toISOString())
      .not('status', 'in', '("failed","rejected")')
      .limit(1)

    if (recentErr) throw new Error(`recent posts query failed: ${recentErr.message}`)
    if ((recentPosts ?? []).length > 0) {
      return { ...base, outcome: 'skipped_recent_post' }
    }

    // 2. Topic pool minus recent topics and the brief's excluded topics.
    const [opportunities, blockedTerms] = await Promise.all([
      getWeakSpotOpportunities(client.id, OPPORTUNITY_LIMIT),
      loadBlockedTerms(supabase, client.id),
    ])

    const fresh = pickFreshTopics(opportunities, blockedTerms)
    if (fresh.length === 0) {
      return { ...base, outcome: 'skipped_no_topic' }
    }

    // 2b. Per-candidate duplicate defence, two layers:
    //     Layer 1 — content-gate (deterministic, permanent: published posts,
    //     open PRs, crawled site pages). The 60-day blocklist above is a
    //     cheap pre-filter only; THIS is the authority (a published article
    //     never stops being a duplicate — 2026-08-01 CTS incident).
    //     Layer 2 — auditExistingContent (crawl + AI second opinion).
    //     Failures of either layer don't block generation (.catch → pass).
    let picked: BlogOpportunity | null = null
    for (const candidate of fresh.slice(0, MAX_CONTENT_AUDITS)) {
      const gate = await checkContentDuplicate(
        client.id,
        { topic: candidate.query_text, primary_keyword: candidate.primary_keyword ?? null },
        supabase,
      ).catch(() => null)
      if (gate?.verdict === 'duplicate') continue

      if (client.domain) {
        const audit = await auditExistingContent(
          client.domain,
          candidate.query_text,
          candidate.query_text,
          client.id,
        ).catch(() => null)
        if (audit && audit.action !== 'new') continue
      }

      picked = candidate
      break
    }

    if (!picked) {
      return { ...base, outcome: 'skipped_no_topic' }
    }

    // 3. Generate through the shared quality gate and persist as draft.
    const relatedPages = await fetchRelatedPages(client.id, picked.query_text).catch(() => [])
    const pagesContext = buildPagesContextBlock(relatedPages)

    const { result, qualityScore, contextSnapshot } = await generateWithQualityRetry(
      {
        client_id: client.id,
        mode: picked.mode,
        topic: picked.query_text,
        source_query_id: picked.query_id,
        source_query_text: picked.query_text,
        primary_keyword: picked.primary_keyword,
        keyword_volume: picked.keyword_volume,
        keyword_kd: picked.keyword_kd,
        keyword_intent: picked.keyword_intent,
        existing_pages_context: pagesContext || undefined,
      },
      picked.mode,
    )

    const internalLinkCheck = checkInternalLinks(result.html_body, client.domain)

    const { data: inserted, error: insertErr } = await supabase
      .from('blog_posts')
      .insert({
        client_id: client.id,
        mode: picked.mode,
        topic: picked.query_text.slice(0, 400),
        source_query_id: picked.query_id,
        source_query_text: picked.query_text,
        primary_keyword: picked.primary_keyword ?? null,
        keyword_volume: picked.keyword_volume ?? null,
        keyword_kd: picked.keyword_kd ?? null,
        keyword_intent: picked.keyword_intent ?? null,
        title: result.title,
        meta_title: result.meta_title,
        meta_description: result.meta_description,
        slug: result.slug,
        html_body: result.html_body,
        word_count: result.word_count,
        geo_directive_id: result.geo_directive_id,
        geo_html_snapshot: result.geo_html_snapshot,
        featured_image_prompt: result.featured_image_prompt,
        cost_usd: result.cost_usd,
        model_used: result.model_used,
        status: 'draft',
        quality_score: qualityScore,
        generation_context_snapshot: contextSnapshot,
        quality_check: { internal_link: internalLinkCheck, generated_by: 'blog-weekly' },
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      throw new Error(`draft insert failed: ${insertErr?.message ?? 'no row returned'}`)
    }

    const postId = (inserted as { id: string }).id

    // Flywheel action — same as the manual path, non-blocking. Without it
    // cron-generated posts never enter outcome attribution.
    try {
      await new SeoContentAdapter().execute({
        clientId: client.id,
        actionType: SEO_ACTION_TYPE.PUBLISH_BLOG,
        executionMode: 'in_house',
        payload: {
          triggered_by: 'blog_weekly_cron',
          blog_post_id: postId,
          mode: picked.mode,
          primary_keyword: picked.primary_keyword ?? null,
        },
        expectedMetric: SEO_METRIC_KEY.ORGANIC_TRAFFIC,
      })
    } catch (err) {
      console.error('[blog-weekly] flywheel action failed (non-blocking):', err)
    }

    return {
      ...base,
      outcome: 'generated',
      post_id: postId,
      topic: picked.query_text,
      mode: picked.mode,
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Batch entry point (cron) ────────────────────────────────────────────────────

export async function runWeeklyBlogBatch(
  supabase: SupabaseClient = supabaseAdmin,
): Promise<WeeklyBlogBatchResult> {
  const startedAt = Date.now()

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('client_status', 'active')
    .contains('seo_config', { weekly_blog: true })

  if (error) throw new Error(`Failed to load clients: ${error.message}`)

  const eligible = (clients ?? []) as EligibleClient[]

  const results: WeeklyBlogClientResult[] = []
  for (const client of eligible) {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) {
      results.push({
        client_id: client.id,
        name: client.name,
        outcome: 'skipped_time_budget',
      })
      continue
    }
    results.push(await runForClient(supabase, client))
  }

  return {
    clients_considered: eligible.length,
    generated: results.filter((r) => r.outcome === 'generated').length,
    skipped: results.filter((r) => r.outcome.startsWith('skipped')).length,
    failed: results.filter((r) => r.outcome === 'error').length,
    results,
  }
}
