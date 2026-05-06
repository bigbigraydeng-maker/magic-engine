/**
 * CTS Tours — Phase 8.D end-to-end verification
 *
 * Runs the full DNZ + Strategy pipeline against the live CTS Tours
 * client and reports a structured summary. Each stage is independent
 * and idempotent so the script can be re-run after fixing any single
 * stage.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/verify-cts-phase-8d.ts            # all stages
 *   npx tsx --env-file=.env.local scripts/verify-cts-phase-8d.ts preflight  # only stage 1
 *   npx tsx --env-file=.env.local scripts/verify-cts-phase-8d.ts dnz        # site audit
 *   npx tsx --env-file=.env.local scripts/verify-cts-phase-8d.ts strategy   # 3D analyzer
 *   npx tsx --env-file=.env.local scripts/verify-cts-phase-8d.ts inspect    # read-only inspect
 *
 * Required env vars (typically loaded via .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 *
 * Reference: ROADMAP.md P7.4.8 (CTS client) + Phase 8.D
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { runSiteAudit } from '../src/lib/site-audit/orchestrator'
import { runStrategyAnalysis } from '../src/lib/strategy/orchestrator'

// CTS Tours client UUID (recorded in ROADMAP.md P7.4.8)
const CTS_CLIENT_ID_PREFIX = 'c0000000'

const STAGES = ['preflight', 'dnz', 'strategy', 'inspect'] as const
type Stage = (typeof STAGES)[number]

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function header(title: string) {
  console.log(`\n${c.bold}${c.cyan}━━━ ${title} ━━━${c.reset}`)
}
function ok(msg: string) {
  console.log(`  ${c.green}✓${c.reset} ${msg}`)
}
function warn(msg: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${msg}`)
}
function fail(msg: string) {
  console.log(`  ${c.red}✗${c.reset} ${msg}`)
}
function info(msg: string) {
  console.log(`  ${c.dim}${msg}${c.reset}`)
}

// ─────────────────────────────────────────────────────────────────────
// Stage 1: preflight
// ─────────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

async function findCtsClient(): Promise<ClientRow | null> {
  // 1. Try exact match by id prefix
  const { data: byPrefix } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .like('id', `${CTS_CLIENT_ID_PREFIX}%`)
    .limit(1)
    .maybeSingle<ClientRow>()
  if (byPrefix) return byPrefix

  // 2. Fallback: search by domain
  const { data: byDomain } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .or('domain.ilike.%ctstours%,name.ilike.%CTS%')
    .limit(1)
    .maybeSingle<ClientRow>()
  return byDomain ?? null
}

async function preflight(): Promise<ClientRow> {
  header('Stage 1 · Preflight')

  // Required tables
  const required = ['client_site_pages', 'content_strategy_items']
  for (const table of required) {
    const { error } = await supabaseAdmin.from(table).select('id').limit(1)
    if (error) {
      if (/does not exist/i.test(error.message)) {
        fail(`Table missing: ${table} — run the migration first`)
        throw new Error(`Missing table: ${table}`)
      }
      if (/host not in allowlist/i.test(error.message)) {
        fail(`Supabase rejected the connection: ${error.message}`)
        fail('  → Add this machine\'s IP to Supabase → Settings → Network Restrictions')
        throw new Error('Network restriction blocked')
      }
      fail(`Unexpected error on ${table}: ${error.message}`)
      throw new Error(error.message)
    }
    ok(`Table exists: ${table}`)
  }

  // CTS client
  const client = await findCtsClient()
  if (!client) {
    fail('CTS Tours client not found')
    throw new Error('CTS client missing')
  }
  ok(`Found client: ${client.name} (id ${client.id.slice(0, 8)}…)`)

  if (!client.domain) {
    warn('clients.domain is empty — DNZ stage will need a domain override')
  } else {
    ok(`Domain: ${client.domain}`)
  }

  return client
}

// ─────────────────────────────────────────────────────────────────────
// Stage 2: DNZ site audit
// ─────────────────────────────────────────────────────────────────────

async function dnzStage(client: ClientRow, limit = 30) {
  header('Stage 2 · DNZ Site Audit')

  const domain = client.domain ?? 'ctstours.co.nz'
  const normalised = domain.startsWith('http') ? domain : `https://${domain}`

  info(`Crawling ${normalised} (limit=${limit})…`)
  const start = Date.now()
  const summary = await runSiteAudit(client.id, normalised, { limit })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  ok(`Crawl finished in ${elapsed}s`)
  info(`URLs discovered: ${summary.total_urls_discovered}`)
  info(`Pages persisted: ${summary.pages_persisted}`)
  if (summary.failures.length > 0) {
    warn(`Crawl failures: ${summary.failures.length}`)
    summary.failures.slice(0, 3).forEach((f) =>
      info(`  ${f.url} — ${f.error}`)
    )
  }
  if (summary.persist_errors.length > 0) {
    warn(`Persist errors: ${summary.persist_errors.length}`)
  }

  if (summary.pages_persisted === 0) {
    fail('No pages persisted — check sitemap discovery / Jina')
    throw new Error('DNZ produced 0 pages')
  }

  return summary
}

// ─────────────────────────────────────────────────────────────────────
// Stage 3: Strategy analysis
// ─────────────────────────────────────────────────────────────────────

async function strategyStage(client: ClientRow) {
  header('Stage 3 · 3D Strategy Analysis')

  info('Running analyzer (weak queries × site pages × keywords)…')
  const start = Date.now()
  const summary = await runStrategyAnalysis(client.id)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  ok(`Analysis finished in ${elapsed}s`)
  info(`strategy_run_id: ${summary.strategy_run_id}`)
  info(`Total candidates: ${summary.candidates_generated}`)
  info(
    `By action: upgrade=${summary.upgrade_pages} new_blog=${summary.new_blogs} social=${summary.social_content}`
  )
  info(
    `By mode:   unified=${summary.unified_count} geo_only=${summary.geo_only_count} seo_only=${summary.seo_only_count}`
  )

  if (summary.candidates_generated === 0) {
    warn(
      'No candidates produced — likely missing AI Tracker runs or keywords for this client'
    )
  }
  return summary
}

// ─────────────────────────────────────────────────────────────────────
// Stage 4: Inspect (read-only sample of stored data)
// ─────────────────────────────────────────────────────────────────────

async function inspectStage(client: ClientRow) {
  header('Stage 4 · Inspect Stored Data')

  // Site pages
  const { count: pageCount } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
  ok(`client_site_pages rows: ${pageCount ?? 0}`)

  const { data: pageSamples } = await supabaseAdmin
    .from('client_site_pages')
    .select('url, page_type, word_count, has_geo_block, topics')
    .eq('client_id', client.id)
    .order('updated_at', { ascending: false })
    .limit(5)
  if (pageSamples) {
    pageSamples.forEach((p) => {
      info(
        `  [${p.page_type}] ${p.url}  ${p.word_count ?? 0}w  ${p.has_geo_block ? 'GEO✓' : 'no-GEO'}  topics=[${(p.topics ?? []).slice(0, 3).join(', ')}]`
      )
    })
  }

  // Strategy items
  const { count: itemCount } = await supabaseAdmin
    .from('content_strategy_items')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
  ok(`content_strategy_items rows: ${itemCount ?? 0}`)

  const { data: itemSamples } = await supabaseAdmin
    .from('content_strategy_items')
    .select(
      'action_type, content_mode, priority, priority_score, proposed_title, source_keyword'
    )
    .eq('client_id', client.id)
    .order('priority_score', { ascending: false })
    .limit(5)
  if (itemSamples) {
    itemSamples.forEach((it) => {
      info(
        `  [${it.action_type}/${it.content_mode}] ${Math.round(it.priority_score)} ${it.priority} — ${it.proposed_title ?? '(no title)'}` +
          (it.source_keyword ? `  kw=${it.source_keyword}` : '')
      )
    })
  }

  // Status counts
  const { data: statusRows } = await supabaseAdmin
    .from('content_strategy_items')
    .select('status')
    .eq('client_id', client.id)
  const counts: Record<string, number> = {}
  for (const r of statusRows ?? []) {
    counts[r.status] = (counts[r.status] ?? 0) + 1
  }
  ok(`status counts: ${JSON.stringify(counts)}`)
}

// ─────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const arg = (process.argv[2] ?? 'all') as Stage | 'all'

  if (arg !== 'all' && !STAGES.includes(arg as Stage)) {
    console.error(`Unknown stage: ${arg}. Choose one of: ${STAGES.join(', ')} or 'all'.`)
    process.exit(1)
  }

  console.log(`${c.bold}CTS Tours · Phase 8.D verification${c.reset}`)
  const t0 = Date.now()

  try {
    const client = await preflight()

    if (arg === 'all' || arg === 'dnz') {
      await dnzStage(client)
    }
    if (arg === 'all' || arg === 'strategy') {
      await strategyStage(client)
    }
    if (arg === 'all' || arg === 'inspect' || arg === 'preflight') {
      await inspectStage(client)
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n${c.bold}${c.green}✓ Verification finished in ${elapsed}s${c.reset}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n${c.bold}${c.red}✗ Verification failed: ${msg}${c.reset}\n`)
    process.exit(1)
  }
}

main()
