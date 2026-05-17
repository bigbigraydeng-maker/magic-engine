/**
 * P12.A.12 — Backfill execution_target on execution_items (one-time script)
 *
 * The P12.A.1 migration (§5) ran a rough backfill using dimension only.
 * This script applies the full deriveExecutionTarget(dimension, fix_type)
 * mapping so every row correctly reflects its flywheel/mode/vendor.
 *
 * Safe to re-run: rows already matching the derived value are skipped.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-execution-target.ts
 *
 * Dry-run (no DB writes):
 *   DRY_RUN=1 npx tsx --env-file=.env.local scripts/backfill-execution-target.ts
 */

import { createClient } from '@supabase/supabase-js'

// ── Supabase ────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DRY_RUN = process.env.DRY_RUN === '1'

// ── ExecutionTarget derivation (mirrors src/lib/flywheel/execution-target.ts) ──
// Duplicated here so the script has zero build-time dependencies on Next.js.

type FlywheelName   = 'seo' | 'geo' | 'ads' | 'social'
type ExecutionMode  = 'in_house' | 'third_party' | 'external_manual'

interface ExecutionTarget {
  flywheel:     FlywheelName
  mode:         ExecutionMode
  vendor?:      string
  action_type?: string
}

function dimensionToFlywheel(dim: string): FlywheelName {
  if (dim === 'seo')           return 'seo'
  if (dim === 'ai_visibility') return 'geo'
  if (dim === 'ads')           return 'ads'
  if (dim === 'social')        return 'social'
  if (dim === 'reputation')    return 'geo'
  return 'seo' // competitor
}

function fixTypeToMode(fix: string): ExecutionMode {
  if (fix === 'me_auto')     return 'in_house'
  if (fix === 'third_party') return 'third_party'
  return 'external_manual'  // fde_manual
}

// GEO action_type hints — Phase 12.A vocabulary only
const GEO_ACTION_TYPE = {
  COMPOSE_DIRECTIVE: 'geo.compose_directive',
  BUILD_CITATIONS:   'geo.build_citations',
  SUBMIT_ENTITY:     'geo.submit_entity',
} as const

function deriveExecutionTarget(dimension: string, fix_type: string): ExecutionTarget {
  const flywheel = dimensionToFlywheel(dimension)
  const mode     = fixTypeToMode(fix_type)
  const target: ExecutionTarget = { flywheel, mode }

  if (mode === 'external_manual') target.vendor = 'fde'

  // Only GEO has vocabulary in Phase 12.A; other flywheels omit action_type
  if (flywheel === 'geo') {
    if (mode === 'in_house')        target.action_type = GEO_ACTION_TYPE.COMPOSE_DIRECTIVE
    if (mode === 'external_manual') target.action_type = GEO_ACTION_TYPE.BUILD_CITATIONS
    if (mode === 'third_party')     target.action_type = GEO_ACTION_TYPE.SUBMIT_ENTITY
  }

  return target
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ExecutionItem {
  id:               string
  client_id:        string
  dimension:        string
  fix_type:         string
  execution_target: ExecutionTarget | null
}

interface Client {
  id:   string
  name: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function targetsMatch(a: ExecutionTarget, b: ExecutionTarget): boolean {
  return (
    a.flywheel    === b.flywheel    &&
    a.mode        === b.mode        &&
    (a.vendor     ?? null) === (b.vendor     ?? null) &&
    (a.action_type ?? null) === (b.action_type ?? null)
  )
}

// ── Per-client stats ─────────────────────────────────────────────────────────

interface ClientStats {
  total:    number
  updated:  number
  skipped:  number
  nullBefore: number // rows that had no execution_target before this run
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log(' P12.A.12 — Backfill execution_target on execution_items')
  console.log(`  Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0].replace('https://', '')}`)
  console.log(`  Mode:     ${DRY_RUN ? '⚠️  DRY RUN (no writes)' : '✅ LIVE (will write)'}`)
  console.log('═══════════════════════════════════════════════════════')

  // 1. Load all clients
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name')
    .order('name')

  if (clientsErr || !clients?.length) {
    console.error('\n❌ Failed to load clients:', clientsErr?.message ?? 'empty result')
    process.exit(1)
  }

  console.log(`\nFound ${clients.length} client(s).\n`)

  const summary: Array<ClientStats & { name: string }> = []
  let globalTotal   = 0
  let globalUpdated = 0
  let globalSkipped = 0

  // 2. Process each client
  for (const client of clients as Client[]) {
    const { data: items, error: itemsErr } = await supabase
      .from('execution_items')
      .select('id, client_id, dimension, fix_type, execution_target')
      .eq('client_id', client.id)

    if (itemsErr) {
      console.warn(`  ⚠️  ${client.name}: failed to load items — ${itemsErr.message}`)
      continue
    }

    if (!items || items.length === 0) {
      console.log(`  • ${client.name}: no execution_items — skip`)
      continue
    }

    const stats: ClientStats = {
      total:    items.length,
      updated:  0,
      skipped:  0,
      nullBefore: 0,
    }

    const toUpdate: Array<{ id: string; execution_target: ExecutionTarget }> = []

    for (const item of items as ExecutionItem[]) {
      if (!item.dimension || !item.fix_type) {
        // Cannot derive — skip (should not happen for well-formed data)
        stats.skipped++
        continue
      }

      const derived = deriveExecutionTarget(item.dimension, item.fix_type)

      if (item.execution_target === null) stats.nullBefore++

      if (item.execution_target && targetsMatch(item.execution_target, derived)) {
        stats.skipped++
      } else {
        toUpdate.push({ id: item.id, execution_target: derived })
      }
    }

    // Batch update in chunks of 50 to stay within Supabase row limits
    const CHUNK = 50
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const chunk = toUpdate.slice(i, i + CHUNK)

      if (!DRY_RUN) {
        // Supabase JS doesn't support bulk update by list of IDs in one call,
        // so we do individual upserts — acceptable for a one-time script.
        for (const row of chunk) {
          const { error: upErr } = await supabase
            .from('execution_items')
            .update({ execution_target: row.execution_target })
            .eq('id', row.id)

          if (upErr) {
            console.warn(`    ⚠️  id=${row.id}: update failed — ${upErr.message}`)
          } else {
            stats.updated++
          }
        }
      } else {
        // Dry run: count as if updated
        stats.updated += chunk.length
      }
    }

    stats.skipped = items.length - stats.updated - (toUpdate.length - stats.updated)
    // Recalculate cleanly
    stats.updated = toUpdate.length   // total that needed update (or were queued)
    stats.skipped = items.length - toUpdate.length

    globalTotal   += stats.total
    globalUpdated += stats.updated
    globalSkipped += stats.skipped

    summary.push({ name: client.name, ...stats })

    const tag = stats.updated > 0 ? '✅' : '—'
    console.log(
      `  ${tag} ${client.name.padEnd(30)} ` +
      `total=${stats.total}  updated=${stats.updated}  skipped=${stats.skipped}` +
      (stats.nullBefore > 0 ? `  (${stats.nullBefore} were NULL)` : ''),
    )
  }

  // 3. Summary table
  console.log('\n' + '─'.repeat(57))
  console.log(
    `  TOTAL: ${globalTotal} items | ` +
    `updated: ${globalUpdated} | skipped (already correct): ${globalSkipped}`,
  )
  if (DRY_RUN) {
    console.log('\n  ⚠️  DRY RUN — no rows were written. Re-run without DRY_RUN=1 to apply.')
  }
  console.log('═══════════════════════════════════════════════════════\n')

  // 4. Verification pass — confirm no NULLs remain (skip in dry-run)
  if (!DRY_RUN) {
    console.log('Verification pass: checking for remaining NULL execution_target…')
    const { count, error: verifyErr } = await supabase
      .from('execution_items')
      .select('id', { count: 'exact', head: true })
      .is('execution_target', null)

    if (verifyErr) {
      console.warn('  ⚠️  Verification query failed:', verifyErr.message)
    } else if ((count ?? 0) === 0) {
      console.log('  ✅ All execution_items now have execution_target set.')
    } else {
      console.warn(
        `  ⚠️  ${count} rows still have NULL execution_target — ` +
        'these likely have NULL dimension or fix_type and require manual review.',
      )
    }
    console.log('')
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
