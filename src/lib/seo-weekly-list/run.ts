/**
 * SEO weekly list runner (docs/specs/2026-10-04-seo-weekly-list-v0.2.md).
 *
 * Per eligible client (active goal with metric `seo_gsc_clicks_28d`), each run:
 *   1. VERIFY open list items against stored data (blog published / page changed);
 *   2. EXPIRE items untouched for expiryDays (skipped + reason, never silent);
 *   3. GENERATE up to N new items from data the platform already stores.
 * All execution_items writes go through zhuge/action-persister.ts (grandfathered
 * writer). This file only READS that table. No paid calls, no outward writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalUrl } from '@/lib/url/canonical-url'
import { executionItemDedupKey, SEO_PLAN_LOOP, transitionSeoPlanItem, writeSeoPlanItems } from '@/lib/zhuge/action-persister'
import { resolveSeoLoopConfig, SEO_LOOP_METRIC_KEY, type SeoLoopConfig } from './config'
import {
  aggregatePageRows,
  buildCtrGapCandidates,
  buildNearMissCandidates,
  domainRoot,
  isExcludedUrl,
  matchOwnPages,
  tokenKey,
  type DailyPageRow,
  type SitePageRow,
  type SnapshotKeywordRow,
} from './candidates'
import { buildCtrGapItem, buildNearMissItem, type ItemContext, type PlanItemDraft } from './items'
import { verifyPlanItem, type BlogRow, type CrawledPage, type OpenPlanItem } from './verify'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }
const PAGE_SIZE = 1000
const MAX_PAGES = 20
const GSC_WINDOW_DAYS = 28
const DAY_MS = 86_400_000

export interface WeeklyListClientResult {
  client_id: string
  goal_id: string | null
  dry_run: boolean
  open_before: number
  verified_pass: number
  verify_pending: number
  verify_not_measured: number
  expired: number
  inserted: number
  duplicates: number
  withheld: 'wip_cap' | 'no_candidates' | 'no_snapshot' | 'stale_snapshot' | null
  skipped_keywords: number
  preview: string[]
  /** Items whose verify / expire write failed (the run continues; any entry turns the cron red). */
  item_errors?: string[]
  error?: string
}

export interface WeeklyListRunResult {
  clients_processed: number
  failed: number
  results: WeeklyListClientResult[]
}

/** Monday (Pacific/Auckland) of the week containing `now`, as YYYY-MM-DD. */
export function planWeekOf(now: Date): string {
  const nz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const d = new Date(`${nz}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

async function readAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await fetchPage(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(`${label} read failed: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
  throw new Error(`${label} read hit the ${MAX_PAGES * PAGE_SIZE}-row cap — refusing to decide on a truncated read`)
}

interface ClientRow {
  id: string
  domain: string | null
  semrush_db: string | null
  brand_aliases: string[] | null
  competitor_domains: string[] | null
  seo_config: unknown
}

interface PlanRow {
  id: string
  action_type: string
  status: string
  created_at: string
  updated_at: string
  steps_json: Record<string, unknown> | null
}

async function loadEligibleGoals(
  supabase: SupabaseClient,
  clientId?: string,
): Promise<Array<{ id: string; client_id: string }>> {
  let q = supabase
    .from('goals')
    .select('id, client_id')
    .eq('primary_metric_key', SEO_LOOP_METRIC_KEY)
    .eq('status', 'active')
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw new Error(`goals read failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; client_id: string }>
}

async function loadPlanRows(supabase: SupabaseClient, clientId: string, statuses: string[], since?: string): Promise<PlanRow[]> {
  const rows = await readAll<PlanRow>(
    (from, to) => {
      let q = supabase
        .from('execution_items')
        .select('id, action_type, status, created_at, updated_at, steps_json')
        .eq('client_id', clientId)
        .eq('dimension', 'seo')
        .eq('source', 'zhuge')
        .in('status', statuses)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (since) q = q.gte('updated_at', since)
      return q.range(from, to)
    },
    'execution_items',
  )
  return rows.filter(r => r.steps_json?.loop === SEO_PLAN_LOOP)
}

export async function runSeoWeeklyList(
  supabase: SupabaseClient,
  opts: { now?: Date; dryRun?: boolean; clientId?: string } = {},
): Promise<WeeklyListRunResult> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? false
  const goals = await loadEligibleGoals(supabase, opts.clientId)
  const results: WeeklyListClientResult[] = []
  for (const goal of goals) {
    try {
      results.push(await runForClient(supabase, goal, now, dryRun))
    } catch (err) {
      results.push({
        client_id: goal.client_id, goal_id: goal.id, dry_run: dryRun, open_before: 0,
        verified_pass: 0, verify_pending: 0, verify_not_measured: 0, expired: 0, inserted: 0, duplicates: 0,
        withheld: null, skipped_keywords: 0, preview: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { clients_processed: results.length, failed: results.filter(r => r.error).length, results }
}

async function runForClient(
  supabase: SupabaseClient,
  goal: { id: string; client_id: string },
  now: Date,
  dryRun: boolean,
): Promise<WeeklyListClientResult> {
  const clientId = goal.client_id
  const result: WeeklyListClientResult = {
    client_id: clientId, goal_id: goal.id, dry_run: dryRun, open_before: 0,
    verified_pass: 0, verify_pending: 0, verify_not_measured: 0, expired: 0, inserted: 0, duplicates: 0,
    withheld: null, skipped_keywords: 0, preview: [],
  }

  const { data: clientData, error: clientErr } = await supabase
    .from('clients')
    .select('id, domain, semrush_db, brand_aliases, competitor_domains, seo_config, client_status')
    .eq('id', clientId)
    .eq('client_status', 'active')
    .maybeSingle()
  if (clientErr) throw new Error(`clients read failed: ${clientErr.message}`)
  if (!clientData) return { ...result, withheld: 'no_candidates' } // inactive client: skip, never a failure
  const client = clientData as ClientRow
  const config = resolveSeoLoopConfig(client.seo_config)

  // ── 1+2. verify, then expire ───────────────────────────────────────────────
  const open = await loadPlanRows(supabase, clientId, ['pending', 'in_progress'])
  result.open_before = open.length
  let stillOpen = open.length
  if (open.length > 0) {
    const pages = await loadCrawledPages(supabase, clientId)
    const blogs = await readAll<BlogRow>(
      (from, to) => supabase.from('blog_posts').select('primary_keyword, status, slug, published_at').eq('client_id', clientId).eq('status', 'published').order('published_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
      'blog_posts',
    )
    const itemErrors: string[] = []
    for (const row of open) {
      try {
      const item: OpenPlanItem = { id: row.id, created_at: row.created_at, steps_json: row.steps_json ?? {} }
      const decision = verifyPlanItem(item, { blogs, pages, config })
      const steps = { ...item.steps_json, verify: { ...(item.steps_json.verify as Record<string, unknown> | undefined), state: decision.outcome, reason: decision.reason, checked_at: now.toISOString() } }
      if (decision.outcome === 'pass') {
        const applied = dryRun || (await transitionSeoPlanItem(supabase, { id: row.id, clientId, to: 'completed', reason: decision.reason, stepsJson: steps, now }))
        if (applied) {
          result.verified_pass += 1
          stillOpen -= 1
        }
        continue
      }
      if (decision.outcome === 'pending') result.verify_pending += 1
      else result.verify_not_measured += 1
      // "untouched" = no activity: age counts from the last update (a card someone started
      // working on — in_progress — is not abandoned just because it was created long ago).
      const ageDays = (now.getTime() - Date.parse(row.updated_at ?? row.created_at)) / DAY_MS
      // An item we could not CHECK (not_measured) gets twice the time: failing to look is not the same as nothing happening.
      const limit = decision.outcome === 'not_measured' ? config.expiryDays * 2 : config.expiryDays
      if (ageDays > limit) {
        const applied = dryRun || (await transitionSeoPlanItem(supabase, {
          id: row.id, clientId, to: 'skipped', reason: `expired_no_action（超过 ${config.expiryDays} 天未处理；最后核对：${decision.reason}）`,
          stepsJson: { ...steps, skip_reason: 'expired_no_action', skipped_on: now.toISOString().slice(0, 10) }, now,
        }))
        if (applied) {
          result.expired += 1
          stillOpen -= 1
        }
      }
      } catch (err) {
        itemErrors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (itemErrors.length > 0) result.item_errors = itemErrors
  }

  // ── 3. generate ────────────────────────────────────────────────────────────
  const slots = Math.min(config.weeklyMaxItems, config.wipCap - stillOpen)
  if (slots <= 0) return { ...result, withheld: 'wip_cap' }

  const drafts = await buildDrafts(supabase, client, goal.id, config, now, result)
  if (drafts.length === 0) return { ...result, withheld: result.withheld ?? 'no_candidates' }
  const chosen = drafts.slice(0, slots)
  result.preview = chosen.map(d => d.title)
  if (dryRun) return result

  const initiativeId = await loadInitiativeId(supabase, clientId, goal.id)
  const written = await writeSeoPlanItems(supabase, clientId, chosen.map(d => ({
    actionType: d.actionType, title: d.title, description: d.description, keyword: d.keyword, url: d.url,
    dueDate: d.dueDate, stepsJson: d.stepsJson, initiativeId,
  })))
  result.inserted = written.inserted
  result.duplicates = written.duplicates
  if (result.item_errors?.length) result.error = `${result.item_errors.length} item(s) failed to verify/expire: ${result.item_errors[0]}`
  return result
}

async function loadInitiativeId(supabase: SupabaseClient, clientId: string, goalId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('initiatives')
    .select('id')
    .eq('client_id', clientId)
    .eq('goal_id', goalId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`initiatives read failed: ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}

async function loadCrawledPages(supabase: SupabaseClient, clientId: string): Promise<CrawledPage[]> {
  return readAll<CrawledPage>(
    (from, to) => supabase.from('client_site_pages').select('url, status_code, crawl_status, crawled_at, word_count').eq('client_id', clientId).order('url', { ascending: true }).range(from, to),
    'client_site_pages',
  )
}

async function buildDrafts(
  supabase: SupabaseClient,
  client: ClientRow,
  goalId: string,
  config: SeoLoopConfig,
  now: Date,
  result: WeeklyListClientResult,
): Promise<PlanItemDraft[]> {
  const clientId = client.id
  const locationCode = LOCATION_CODE_BY_DB[client.semrush_db ?? 'au'] ?? LOCATION_CODE_BY_DB.au

  // keyword snapshot (latest day)
  const { data: latestSnap, error: snapErr } = await supabase
    .from('keyword_snapshots').select('snapshot_date').eq('client_id', clientId).eq('location_code', locationCode)
    .order('snapshot_date', { ascending: false }).limit(1).maybeSingle()
  if (snapErr) throw new Error(`keyword_snapshots read failed: ${snapErr.message}`)
  const snapshotDate = (latestSnap as { snapshot_date: string } | null)?.snapshot_date
  if (!snapshotDate) {
    result.withheld = 'no_snapshot'
    return []
  }
  const snapshotAgeDays = (now.getTime() - Date.parse(`${snapshotDate}T00:00:00Z`)) / DAY_MS
  if (snapshotAgeDays > config.snapshotMaxAgeDays) {
    result.withheld = 'stale_snapshot' // stale ranks must not be labelled as current evidence
    return []
  }
  const snapshotRows = await readAll<SnapshotKeywordRow>(
    (from, to) => supabase.from('keyword_snapshots').select('keyword, position, search_volume, keyword_difficulty, intent').eq('client_id', clientId).eq('location_code', locationCode).eq('snapshot_date', snapshotDate).order('keyword', { ascending: true }).range(from, to),
    'keyword_snapshots',
  )

  // GSC per-page window (28 days ending at the latest loaded day)
  const { data: latestGsc, error: gscErr } = await supabase
    .from('gsc_page_daily').select('day').eq('client_id', clientId).order('day', { ascending: false }).limit(1).maybeSingle()
  if (gscErr) throw new Error(`gsc_page_daily read failed: ${gscErr.message}`)
  const gscDay = (latestGsc as { day: string } | null)?.day ?? null
  let dailyRows: DailyPageRow[] = []
  if (gscDay) {
    const start = new Date(`${gscDay}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - (GSC_WINDOW_DAYS - 1))
    const startDay = start.toISOString().slice(0, 10)
    dailyRows = await readAll<DailyPageRow>(
      (from, to) => supabase.from('gsc_page_daily').select('page_url, clicks, impressions, position').eq('client_id', clientId).gte('day', startDay).lte('day', gscDay).order('day', { ascending: true }).order('page_key', { ascending: true }).order('page_url', { ascending: true }).range(from, to),
      'gsc_page_daily',
    )
  }
  const pageAgg = aggregatePageRows(dailyRows)
  const pageImpressions = new Map<string, number>()
  for (const p of pageAgg) {
    const c = canonicalUrl(p.url)
    if (c) pageImpressions.set(c, p.impressions)
  }

  const sitePages = await readAll<SitePageRow & { markdown_content?: never }>(
    (from, to) => supabase.from('client_site_pages').select('url, path, title, h1, word_count, crawled_at, crawl_status').eq('client_id', clientId).order('url', { ascending: true }).range(from, to),
    'client_site_pages',
  )
  const sitePageByCanon = new Map<string, SitePageRow>()
  for (const p of sitePages) {
    const c = canonicalUrl(p.url)
    if (c) sitePageByCanon.set(c, p)
  }

  // exclusions: meta-cycle protected pages + pages it changed in the last 30 days
  const seoConfig = (client.seo_config && typeof client.seo_config === 'object' ? client.seo_config : {}) as Record<string, unknown>
  const protectedSlugs = Array.isArray(seoConfig.meta_cycle_protected_slugs)
    ? (seoConfig.meta_cycle_protected_slugs as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  const { data: metaLog, error: metaErr } = await supabase
    .from('seo_meta_log').select('page_url').eq('client_id', clientId).gte('optimised_at', since30)
  if (metaErr) throw new Error(`seo_meta_log read failed: ${metaErr.message}`)
  const recentMetaUrls = new Set<string>()
  for (const r of (metaLog ?? []) as Array<{ page_url: string | null }>) {
    const c = r.page_url ? canonicalUrl(r.page_url) : null
    if (c) recentMetaUrls.add(c)
  }

  // targets already listed (open) or decided inside the cooldown window
  const openRows = await loadPlanRows(supabase, clientId, ['pending', 'in_progress'])
  const decidedSince = new Date(now.getTime() - config.cooldownDays * DAY_MS).toISOString()
  const decidedRows = await loadPlanRows(supabase, clientId, ['completed', 'skipped'], decidedSince)
  // Open cards from the daily patrol (or anyone else) already cover their target: listing
  // the same keyword / page again would hand a human the same job twice.
  const otherOpen = await readAll<{ steps_json: Record<string, unknown> | null }>(
    (from, to) => supabase.from('execution_items').select('steps_json').eq('client_id', clientId).eq('dimension', 'seo').in('status', ['pending', 'in_progress']).order('id', { ascending: true }).range(from, to),
    'execution_items(open seo cards)',
  )
  const blockedKeywordKeys = new Set<string>()
  const blockedUrls = new Set<string>()
  const blockedDedupKeys = new Set<string>()
  for (const o of otherOpen) {
    const kw = o.steps_json?.keyword
    const url = o.steps_json?.url ?? o.steps_json?.page_url
    if (typeof kw === 'string' && kw) blockedKeywordKeys.add(tokenKey(kw))
    if (typeof url === 'string' && url) {
      const c = canonicalUrl(url)
      if (c) blockedUrls.add(c)
    }
  }
  for (const r of [...openRows, ...decidedRows]) {
    const kw = r.steps_json?.keyword
    const url = r.steps_json?.url
    if (typeof kw === 'string' && kw) blockedKeywordKeys.add(tokenKey(kw))
    if (typeof url === 'string' && url) {
      const c = canonicalUrl(url)
      if (c) blockedUrls.add(c)
    }
    blockedDedupKeys.add(executionItemDedupKey(r.action_type, kw, url))
  }

  const ctx: ItemContext = {
    clientId, goalId, planWeek: planWeekOf(now), snapshotDate, gscDay: gscDay ?? snapshotDate,
    intelligenceHref: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'}/dashboard/clients/${clientId}/seo-intelligence`,
    pageImpressions,
  }

  const near = buildNearMissCandidates(snapshotRows, {
    config, brandRoot: domainRoot(client.domain ?? ''), brandAliases: client.brand_aliases, competitorDomains: client.competitor_domains ?? [],
  })
  result.skipped_keywords = near.skipped.length
  const ctrGap = buildCtrGapCandidates(pageAgg, config)

  type Ranked = { potential: number; build: (index: number) => PlanItemDraft | null }
  const ranked: Ranked[] = []
  for (const c of near.candidates) {
    if (blockedKeywordKeys.has(tokenKey(c.primary.keyword))) continue
    const matches = matchOwnPages(c.primary.keyword, sitePages)
    const main = [...matches].sort((a, b) => (pageImpressions.get(canonicalUrl(b.url) ?? '') ?? 0) - (pageImpressions.get(canonicalUrl(a.url) ?? '') ?? 0))[0]
    if (main && isExcludedUrl(main.url, protectedSlugs, recentMetaUrls)) continue
    const mainCanon = main ? canonicalUrl(main.url) : null
    if (mainCanon && blockedUrls.has(mainCanon)) continue
    // Already on page 1 but no page matches by words → the ranking page is probably under a
    // different name; a NEW article would compete with it. Needs a human look, not a card.
    if (!main && c.primary.position <= 10) {
      result.skipped_keywords += 1
      continue
    }
    if (main && !hasFreshCrawl(main, now, config)) continue // no trustworthy word-count baseline
    ranked.push({ potential: c.potentialClicks, build: i => buildNearMissItem(c, matches, ctx, i) })
  }
  for (const c of ctrGap) {
    const canon = canonicalUrl(c.url)
    if ((canon && blockedUrls.has(canon)) || isExcludedUrl(c.url, protectedSlugs, recentMetaUrls)) continue
    const page = canon ? sitePageByCanon.get(canon) : undefined
    if (!page || !hasFreshCrawl(page, now, config)) continue // no trustworthy word-count baseline
    ranked.push({ potential: c.potentialClicks, build: i => buildCtrGapItem(c, page, ctx, i) })
  }
  ranked.sort((a, b) => b.potential - a.potential)

  const drafts: PlanItemDraft[] = []
  const seenKeys = new Set<string>()
  const seenUrls = new Set<string>()
  for (const r of ranked) {
    if (drafts.length >= config.weeklyMaxItems) break
    const draft = r.build(drafts.length)
    if (!draft) continue
    const key = executionItemDedupKey(draft.actionType, draft.keyword, draft.url)
    if (seenKeys.has(key) || blockedDedupKeys.has(key)) continue
    // One page, one item per week: a keyword item and a low-CTR item on the same page
    // are the same piece of work (the higher-potential one, listed first, wins).
    const canon = draft.url ? canonicalUrl(draft.url) : null
    if (canon && seenUrls.has(canon)) continue
    if (canon) seenUrls.add(canon)
    seenKeys.add(key)
    drafts.push(draft)
  }

  return drafts
}

/** A page's crawl is fresh enough to serve as a word-count baseline (weekly crawl → ≤ baselineMaxCrawlAgeDays). */
function hasFreshCrawl(page: SitePageRow, now: Date, config: SeoLoopConfig): boolean {
  if (page.crawl_status !== 'crawled' || !page.crawled_at) return false
  return (now.getTime() - Date.parse(page.crawled_at)) / DAY_MS <= config.baselineMaxCrawlAgeDays
}
