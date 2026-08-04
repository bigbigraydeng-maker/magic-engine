/**
 * Phase 8 Data Sync — CLI script
 * Usage: npx tsx --env-file=.env.local scripts/sync-p8.ts
 *
 * Syncs Link Intelligence (backlinks) + SERP rankings for all clients
 * with a valid domain. Runs without a live HTTP server.
 */

import { createClient } from '@supabase/supabase-js'

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── DataForSEO ───────────────────────────────────────────────────────────────
const DFS_LOGIN  = process.env.DATAFORSEO_LOGIN!
const DFS_PASS   = process.env.DATAFORSEO_PASSWORD!
const DFS_AUTH   = Buffer.from(`${DFS_LOGIN}:${DFS_PASS}`).toString('base64')
const DFS_BASE   = 'https://api.dataforseo.com/v3'

async function dfs(endpoint: string, body: unknown) {
  const res = await fetch(`${DFS_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${DFS_AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DFS ${endpoint} → HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<any>
}

const TODAY = new Date().toISOString().split('T')[0]

// ── Fix Newaisa domain ───────────────────────────────────────────────────────
async function fixNewaisa() {
  const { error } = await supabase
    .from('clients')
    .update({ domain: 'nalexpress.com' })
    .eq('id', '4ae76381-cd45-43bd-85cd-98cfd7604007')
    .eq('domain', 'https://nalexpress.com/') // only if still wrong
  if (error) console.warn('  domain fix skipped / already done:', error.message)
  else       console.log('  ✅ Newaisa domain → nalexpress.com')
}

// ── Sync backlinks for one client ────────────────────────────────────────────
async function syncBacklinks(clientId: string, domain: string) {
  console.log(`\n  📎 Backlinks: ${domain}`)

  let backlinksResult: any[] = []
  let summary: any = {}

  try {
    const [blRes, sumRes] = await Promise.all([
      dfs('/backlinks/backlinks', {
        targets: [domain],
        limit: 100,
        offset: 0,
        order_by: ['-date_from'],
      }),
      dfs('/backlinks/summary', { targets: [domain] }),
    ])

    const blTask  = blRes.tasks?.[0]
    const sumTask = sumRes.tasks?.[0]

    if (!blTask || blTask.status_code !== 20000) {
      console.warn(`  ⚠️  backlinks API: ${blTask?.status_message ?? 'no task'}`)
    } else {
      backlinksResult = blTask.result ?? []
    }

    if (sumTask?.status_code === 20000) {
      summary = sumTask.result?.[0] ?? {}
    }
  } catch (e: any) {
    console.warn('  ⚠️  backlinks fetch failed:', e.message)
    return
  }

  console.log(`     → ${backlinksResult.length} backlinks | ${summary.referring_domains ?? '?'} referring domains`)

  // Upsert individual backlink rows
  if (backlinksResult.length > 0) {
    const rows = backlinksResult.map((b: any) => ({
      client_id:        clientId,
      target_domain:    domain,
      referring_domain: b.domain ?? '',
      referring_url:    b.url ?? '',
      anchor_text:      b.anchor ?? null,
      tld_rank:         b.tld_rank ?? null,
      citation_flow:    b.citation_flow ?? null,
      trust_flow:       b.trust_flow ?? null,
      link_type:        b.type ?? 'do-follow',
      page_rank:        b.page_rank ?? null,
      image_alt:        b.image_alt ?? null,
      status_code:      b.status_code ?? null,
      first_seen_date:  b.first_seen  ? b.first_seen.split('T')[0]  : null,
      last_seen_date:   b.last_seen   ? b.last_seen.split('T')[0]   : null,
      is_new:           false,
      is_lost:          false,
    })).filter((r: any) => r.referring_url)

    const { error } = await supabase
      .from('backlink_data')
      .upsert(rows, { onConflict: 'client_id,target_domain,referring_url' })
    if (error) console.warn('  backlink_data upsert error:', error.message)
    else       console.log(`     → ${rows.length} rows → backlink_data ✅`)
  }

  // Upsert velocity snapshot (today's summary)
  const { error: velErr } = await supabase
    .from('backlink_velocity')
    .upsert(
      {
        client_id:               clientId,
        target_domain:           domain,
        snapshot_date:           TODAY,
        total_backlinks:         summary.backlinks ?? backlinksResult.length,
        new_backlinks:           0,
        lost_backlinks:          0,
        referring_domains_count: summary.referring_domains ?? null,
        avg_domain_rank:         summary.rank ?? null,
      },
      { onConflict: 'client_id,target_domain,snapshot_date' }
    )
  if (velErr) console.warn('  backlink_velocity upsert error:', velErr.message)
  else        console.log(`     → backlink_velocity snapshot ${TODAY} ✅`)
}

// ── Sync SERP rankings for one client ────────────────────────────────────────
async function syncSerp(clientId: string, domain: string) {
  console.log(`\n  📊 SERP: ${domain}`)

  let results: any[] = []

  try {
    const res = await dfs('/ranks/google/positions', {
      target: domain,
      limit:  100,
      offset: 0,
    })
    const task = res.tasks?.[0]
    if (!task || task.status_code !== 20000) {
      console.warn(`  ⚠️  SERP API: ${task?.status_message ?? 'no task'}`)
      return
    }
    results = task.result ?? []
  } catch (e: any) {
    console.warn('  ⚠️  SERP fetch failed:', e.message)
    return
  }

  console.log(`     → ${results.length} keywords ranked`)

  if (results.length === 0) return

  const rows = results
    .map((r: any) => ({
      client_id:     clientId,
      keyword:       r.keyword ?? r.se_keyword ?? '',
      position:      r.rank_group ?? r.position ?? null,
      search_volume: r.search_volume ?? null,
      url:           r.url ?? null,
      snippet:       r.description ?? null,
      date:          TODAY,
    }))
    .filter((r: any) => r.keyword)

  const { error } = await supabase
    .from('serp_rankings')
    .upsert(rows, { onConflict: 'client_id,keyword,date' })
  if (error) console.warn('  serp_rankings upsert error:', error.message)
  else       console.log(`     → ${rows.length} rankings → serp_rankings ✅`)
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════')
  console.log(' Phase 8 Data Sync')
  console.log(`  Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0].replace('https://', '')}`)
  console.log(`  Date:     ${TODAY}`)
  console.log('═══════════════════════════════════════')

  // 1. Fix Newaisa domain
  console.log('\n[0] Fixing domain formats...')
  await fixNewaisa()

  // 2. Fetch all clients with domains
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name, domain')
    .not('domain', 'is', null)

  if (clientsErr || !clients?.length) {
    console.error('Failed to load clients:', clientsErr?.message)
    process.exit(1)
  }

  console.log(`\n[1] Found ${clients.length} client(s) with domains:`)
  clients.forEach(c => console.log(`  • ${c.name} (${c.domain})`))

  // 3. Sync each client
  for (const client of clients) {
    const domain = client.domain
      .replace(/^https?:\/\//, '') // strip protocol
      .replace(/\/$/, '')           // strip trailing slash

    console.log(`\n${'─'.repeat(45)}`)
    console.log(`Client: ${client.name}`)

    await syncBacklinks(client.id, domain)
    await syncSerp(client.id, domain)
  }

  console.log('\n═══════════════════════════════════════')
  console.log(' ✅ Sync complete')
  console.log('  Monthly report → /dashboard/reports/<clientId>/monthly')
  console.log('═══════════════════════════════════════\n')
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message)
  process.exit(1)
})
