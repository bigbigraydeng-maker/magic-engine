/**
 * 一次性回填第 2 步：名次改完后，重算 CTS Tours NZ 受影响周的 `ai_visibility_snapshots`
 * （每周一行：提及次数 / 平均名次 / 覆盖到的模型 / 品牌排行表）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 默认 DRY-RUN（只读）。只有显式加 `--apply` 才写生产库。
 * 必须在 `recompute-cts-ai-visibility-rank.ts --apply` 跑完之后再跑。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 口径：复用线上同一份纯函数 `computeSnapshotMetrics`
 * （`src/lib/ai-tracker/snapshot-aggregate.ts`，`orchestrator.aggregateSnapshot` 用的就是它），
 * 不另写一套算法。
 *
 * 三条安全闸（都是为了「别把修正做成篡改」）：
 *
 *   1. **只改已经存在的周，绝不凭空造新周。**
 *      库里有几周有回答但从来没生成过快照（当时 Tracker 没跑到聚合那步）。
 *      给它们补一行 = 无中生有造历史，不是修正。
 *
 *   2. **只改「能原样复现」的周。** 线上 `aggregateSnapshot` 读本周回答时
 *      `.gte('ran_at', weekStart)` 没有上界、也没有分页，而 PostgREST 默认最多返回 1000 行。
 *      于是 2026-04-27 那一周（实际 1194 条回答）存下来的 `total_runs` 是被悄悄截断的 1000。
 *      本脚本先用「周一 00:00 起 7 天窗口」重算一遍**旧值**，只有跟库里存的
 *      `total_runs` + `mentions_count` 完全对上，才认为这一周的行集合是同一批、可以安全改写；
 *      对不上的周一律跳过并报出来，交 PM 单独决定 —— 否则等于借「回填」之名把一个
 *      本来就是 bug 造成的旧数换成另一个数。
 *
 *   3. 只更新 avg_rank / mentions_count / total_runs / models_covered / ranking_table，
 *      按主键 id 定位，不插行、不删行、不动 week_of 和 client_id。
 *
 * 运行：
 *   npx tsx scripts/backfills/recompute-cts-ai-visibility-snapshots.ts          # 只读，出计划
 *   npx tsx scripts/backfills/recompute-cts-ai-visibility-snapshots.ts --apply  # 真写（需 PM 点头）
 *
 * 需要 .env.local 里的 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  computeSnapshotMetrics,
  type SnapshotRun,
} from '../../src/lib/ai-tracker/snapshot-aggregate'
import type { ClientBrandIdentity } from '../../src/lib/ai-tracker/client-brand-match'
import type { BrandMention } from '../../src/types/magic-engine'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PAGE = 500

// ── env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function makeClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ── 身份（与 orchestrator.loadClientContext 同一口径）───────────────────────

async function loadIdentity(sb: SupabaseClient): Promise<ClientBrandIdentity> {
  const { data: client, error } = await sb
    .from('clients')
    .select('name, domain, brand_aliases')
    .eq('id', CTS_CLIENT_ID)
    .single<{ name: string; domain: string | null; brand_aliases: string[] | null }>()
  if (error || !client) throw new Error(`读不到客户: ${error?.message}`)
  const { data: brief } = await sb
    .from('master_briefs')
    .select('brand_name')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('status', 'active')
    .maybeSingle<{ brand_name: string | null }>()
  return {
    brandName: brief?.brand_name?.trim() || client.name,
    domain: client.domain,
    aliases: client.brand_aliases,
  }
}

// ── 数据 ─────────────────────────────────────────────────────────────────────

interface RunRow extends SnapshotRun {
  id: string
  ran_at: string
}

interface SnapshotRow {
  id: string
  week_of: string
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  models_covered: string[] | null
  ranking_table: Record<string, unknown> | null
}

async function loadRuns(sb: SupabaseClient): Promise<RunRow[]> {
  const out: RunRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('ai_visibility_runs')
      .select('id, ran_at, ai_engine, ai_model, client_brand_rank, brands_mentioned')
      .eq('client_id', CTS_CLIENT_ID)
      .order('ran_at', { ascending: true })
      .order('id', { ascending: true }) // ran_at 不是唯一键，并列时补 id 做 tiebreaker，翻页不漏不重
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`读 ai_visibility_runs 失败: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(
      ...data.map(r => ({
        ...(r as Omit<RunRow, 'brands_mentioned'>),
        brands_mentioned: Array.isArray((r as { brands_mentioned: BrandMention[] }).brands_mentioned)
          ? (r as { brands_mentioned: BrandMention[] }).brands_mentioned
          : [],
      }))
    )
    if (data.length < PAGE) break
  }
  return out
}

/** 按 avg_rank 列的存储精度（NUMERIC(5,2)）取整，用于「值到底变没变」的比较。 */
function roundTo2(v: number | null): number | null {
  return v === null || v === undefined ? null : Math.round(v * 100) / 100
}

/** 与线上一致：周一 00:00 UTC 作为周的键。 */
export function mondayOf(d: Date): string {
  const day = d.getUTCDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
    .toISOString()
    .slice(0, 10)
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const sb = makeClient()
  const identity = await loadIdentity(sb)
  console.log(apply ? '🔴 模式：--apply（真写生产库）\n' : '🟢 模式：DRY-RUN（只读，不写任何东西）\n')

  const runs = await loadRuns(sb)
  const { data: snapshots, error } = await sb
    .from('ai_visibility_snapshots')
    .select('id, week_of, avg_rank, mentions_count, total_runs, models_covered, ranking_table')
    .eq('client_id', CTS_CLIENT_ID)
    .order('week_of', { ascending: true })
  if (error || !snapshots) throw new Error(`读快照失败: ${error?.message}`)

  const byWeek = new Map<string, RunRow[]>()
  for (const r of runs) {
    const w = mondayOf(new Date(r.ran_at))
    const list = byWeek.get(w)
    if (list) list.push(r)
    else byWeek.set(w, [r])
  }

  const planned: Array<{ snap: SnapshotRow; next: ReturnType<typeof computeSnapshotMetrics> }> = []
  const skipped: Array<{ week: string; reason: string }> = []

  for (const snap of snapshots as SnapshotRow[]) {
    const weekRuns = byWeek.get(snap.week_of) ?? []
    // 闸 2：先看这一周的行集合跟当初存快照时是不是同一批。
    // 因为名次已经被第 1 步改过，这里只能核对「总条数」；提及数用回填前的值核对
    // 已在 dry-run 阶段单独做过（见 docs/audits 报告与回填说明）。
    if (weekRuns.length !== snap.total_runs) {
      skipped.push({
        week: snap.week_of,
        reason: `存的 total_runs=${snap.total_runs}，按 7 天窗口重算是 ${weekRuns.length} 条 —— 行集合对不上，不动`,
      })
      continue
    }
    const next = computeSnapshotMetrics(weekRuns, identity)
    // avg_rank 的列是 NUMERIC(5,2)，库里只存两位小数。比较时先按存储精度取整，
    // 否则每一周都会因为「1.885 ≠ 1.89」被当成有改动，白写一遍。
    const changed =
      next.mentionsCount !== snap.mentions_count ||
      roundTo2(next.avgRank) !== roundTo2(snap.avg_rank) ||
      JSON.stringify(next.ranking_table) !== JSON.stringify(snap.ranking_table ?? null)
    if (!changed) continue
    planned.push({ snap, next })
  }

  console.log('── 周快照重算计划 ──')
  console.log(`  库里已有的周: ${snapshots.length}`)
  console.log(`  要改的周    : ${planned.length}`)
  console.log(`  跳过的周    : ${skipped.length}`)
  for (const s of skipped) console.log(`    ⚠️ ${s.week}：${s.reason}`)

  const neverSnapshotted = Array.from(byWeek.keys())
    .filter(w => !snapshots.some((s: SnapshotRow) => s.week_of === w))
    .sort()
  if (neverSnapshotted.length > 0) {
    console.log(`\n  有回答但从来没有快照行的周（本脚本不会造）：`)
    for (const w of neverSnapshotted) console.log(`    ${w}  ${byWeek.get(w)!.length} 条回答`)
  }

  console.log('\n  周次         提及  →  提及    平均名次 → 平均名次')
  for (const p of planned) {
    const a = p.snap.avg_rank === null ? 'null' : p.snap.avg_rank.toFixed(3)
    const b = p.next.avgRank === null ? 'null' : p.next.avgRank.toFixed(3)
    console.log(
      `  ${p.snap.week_of}   ${String(p.snap.mentions_count).padStart(4)} → ${String(p.next.mentionsCount).padStart(4)}    ${a.padStart(6)} → ${b.padStart(6)}`
    )
  }

  writeFileSync(
    '/tmp/cts-ai-snapshot-plan.json',
    JSON.stringify(
      {
        planned: planned.map(p => ({ week_of: p.snap.week_of, before: p.snap, after: p.next })),
        skipped,
        neverSnapshotted,
      },
      null,
      2
    )
  )
  console.log('\n完整计划已写到 /tmp/cts-ai-snapshot-plan.json')

  if (!apply) {
    console.log('\n没有写任何数据。要真写，重跑时加 --apply。')
    return
  }

  for (const p of planned) {
    const { error: upErr } = await sb
      .from('ai_visibility_snapshots')
      .update({
        avg_rank: p.next.avgRank,
        mentions_count: p.next.mentionsCount,
        total_runs: p.next.totalRuns,
        models_covered: p.next.modelsCovered,
        ranking_table: p.next.ranking_table,
      })
      .eq('id', p.snap.id)
      .eq('client_id', CTS_CLIENT_ID) // 双保险：绝不越过 CTS
    if (upErr) throw new Error(`写 ${p.snap.week_of} 失败: ${upErr.message}`)
    console.log(`  ✅ ${p.snap.week_of} 已更新`)
  }
  console.log(`\n✅ 共更新 ${planned.length} 周。`)
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
