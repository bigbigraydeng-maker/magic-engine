/**
 * P30 — Backfill: re-extract brands for existing industry AI visibility snapshots.
 *
 * After Phase 30 fix B-3 (SERP brand pipeline rewrite), historical snapshots
 * still contain the old `serp.organic_results.title` style "brands"
 * ("Best Small Group Tours | Intrepid Travel AU"). This script walks every
 * snapshot with a preserved `raw_response`, re-runs the new pipeline
 * (domain-normalise → LLM standardise) WITHOUT calling DataForSEO again,
 * and writes the corrected `brands_mentioned` / `top3_brands` back.
 *
 * AI Overview snapshots are also re-checked: if `raw_response.ai_overview_text`
 * is null, the row is marked with `error_code = 'no_ai_overview'` to make
 * the "absent vs empty" distinction visible retroactively.
 *
 * Usage:
 *   npx tsx scripts/p30-backfill-baseline-brands.ts             # dry run, prints diffs
 *   npx tsx scripts/p30-backfill-baseline-brands.ts --apply     # actually write
 *   npx tsx scripts/p30-backfill-baseline-brands.ts --industry inbound_tour --apply
 *   npx tsx scripts/p30-backfill-baseline-brands.ts --max-cost 5.00 --apply  # hard $ cap
 *
 * Environment: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { extractDomainBrandsFromOrganic } from '../src/lib/industry-ai-visibility/domain-normalise'
import { standardiseBrandList } from '../src/lib/industry-ai-visibility/brand-standardiser'

interface SnapshotRow {
  id: string
  question_id: string
  platform: string
  raw_response: Record<string, unknown> | null
  brands_mentioned: string[]
  top3_brands: string[]
  error_code: string | null
}

interface QuestionRow {
  id: string
  industry_code: string
}

interface SerpRaw {
  organic_results?: Array<{ url: string }> | null
  local_pack?: Array<{ name: string }> | null
}

interface AiRaw {
  ai_overview_text?: string | null
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const industryFlagIdx = process.argv.indexOf('--industry')
  const industryFilter = industryFlagIdx >= 0 ? process.argv[industryFlagIdx + 1] : null
  const maxCostFlagIdx = process.argv.indexOf('--max-cost')
  const maxCostUsd = maxCostFlagIdx >= 0 ? parseFloat(process.argv[maxCostFlagIdx + 1] ?? '0') : 2.00
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    console.error('Invalid --max-cost value')
    process.exit(1)
  }
  console.log(`Hard cost cap: $${maxCostUsd.toFixed(2)} (override with --max-cost N)`)

  const sb = createClient(url, key)

  // 1) Load all questions + industry map
  const { data: questions, error: qErr } = await sb
    .from('industry_ai_visibility_questions')
    .select('id, industry_code')
  if (qErr) { console.error('questions query failed:', qErr); process.exit(1) }
  const industryByQ = new Map((questions ?? []).map((q: QuestionRow) => [q.id, q.industry_code]))

  // 2) Load all snapshots for the targeted platforms
  let snapQuery = sb
    .from('industry_ai_visibility_snapshots')
    .select('id, question_id, platform, raw_response, brands_mentioned, top3_brands, error_code')
    .in('platform', ['google_serp', 'google_ai_overview'])
  const { data: snapshots, error: sErr } = await snapQuery
  if (sErr) { console.error('snapshots query failed:', sErr); process.exit(1) }

  console.log(`Loaded ${snapshots?.length ?? 0} snapshots, ${questions?.length ?? 0} questions`)

  let processed = 0, changed = 0, skipped = 0, errors = 0
  let totalCostUsd = 0

  for (const snap of (snapshots ?? []) as SnapshotRow[]) {
    const industryCode = industryByQ.get(snap.question_id)
    if (!industryCode) { skipped++; continue }
    if (industryFilter && industryCode !== industryFilter) { skipped++; continue }
    if (!snap.raw_response) { skipped++; continue }

    if (totalCostUsd >= maxCostUsd) {
      console.warn(`\n⚠ Hit cost cap $${maxCostUsd.toFixed(2)} after processing ${processed}. Remaining ${(snapshots?.length ?? 0) - processed} snapshots skipped.`)
      console.warn('  Re-run with --max-cost N to continue.')
      break
    }

    processed++

    try {
      if (snap.platform === 'google_serp') {
        const raw = snap.raw_response as unknown as SerpRaw
        const fromLocal = (raw.local_pack ?? []).map(lp => lp.name).filter(Boolean)
        const fromDomains = extractDomainBrandsFromOrganic(raw.organic_results ?? null)
        const merged = [...fromLocal, ...fromDomains]
        const std = await standardiseBrandList(merged, { supabase: sb, industryCode })
        totalCostUsd += std.total_cost_usd
        const newBrands = std.brands
        const newTop3 = newBrands.slice(0, 3)

        if (!arraysEqual(newBrands, snap.brands_mentioned) || !arraysEqual(newTop3, snap.top3_brands)) {
          changed++
          console.log(`  [SERP ${snap.id.slice(0, 8)}] ${snap.brands_mentioned.length} → ${newBrands.length} brands (cost $${std.total_cost_usd.toFixed(4)})`)
          if (newBrands.length > 0) console.log(`        new top3: ${newTop3.join(' · ')}`)
          if (apply) {
            const { error } = await sb
              .from('industry_ai_visibility_snapshots')
              .update({ brands_mentioned: newBrands, top3_brands: newTop3 })
              .eq('id', snap.id)
            if (error) { errors++; console.error('    write failed:', error) }
          }
        }
      } else if (snap.platform === 'google_ai_overview') {
        const raw = snap.raw_response as unknown as AiRaw
        const hasOverview = Boolean(raw.ai_overview_text)
        const shouldMark = !hasOverview && snap.error_code !== 'no_ai_overview'
        if (shouldMark) {
          changed++
          console.log(`  [AI ${snap.id.slice(0, 8)}] mark as no_ai_overview`)
          if (apply) {
            const { error } = await sb
              .from('industry_ai_visibility_snapshots')
              .update({
                error_code: 'no_ai_overview',
                error_message: 'Google did not surface an AI Overview for this query (backfilled)',
              })
              .eq('id', snap.id)
            if (error) { errors++; console.error('    write failed:', error) }
          }
        }
      }
    } catch (err) {
      errors++
      console.error(`  snapshot ${snap.id} failed:`, err)
    }
  }

  console.log(`\nProcessed ${processed}, would change ${changed}, skipped ${skipped}, errors ${errors}`)
  console.log(`LLM cost incurred: $${totalCostUsd.toFixed(4)} (cap $${maxCostUsd.toFixed(2)})`)
  console.log(apply ? 'APPLIED.' : 'DRY RUN — pass --apply to write.')
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

main().catch(err => { console.error(err); process.exit(1) })
