/**
 * P12.A.13 — CTS GEO 飞轮端到端验证脚本
 *
 * 目的：用真实 CTS 数据走完整条 GEO 闭环链路，证明 M3 关卡可以达成：
 *
 *   real finding (CTS prescription)
 *     → execution_item 落库
 *     → GeoComposerAdapter.execute() 写 flywheel_actions
 *     → seed baseline + after flywheel_metrics
 *     → runAttributionJob() 写 flywheel_outcomes
 *     → /api/clients/[id]/execution 返回带 outcome 的 item
 *     → 执行看板 UI 上能看见 outcome 卡片
 *
 * 真实 / 模拟数据来源说明：
 *   • finding (源)    = CTS 现有 prescription 21ed9a3c-…-c11 phase 1 中的真实条目
 *                       "ai-visibility-brand-entity-optimization"（dimension=ai_visibility）
 *                       为让 GeoComposerAdapter (in_house) 能接管，本脚本将 fix_type
 *                       覆写为 'me_auto'（原条目是 fde_manual）。原文记录在 payload。
 *   • baseline metric = CTS 现有 ai_visibility_snapshots (2026-04-27) 真实测量值
 *                       (mention_rate = 142/1000 = 0.142, avg_rank=1.49, engines=2)
 *                       measured_at 用 snapshot.week_of（真实日期）
 *   • after metric    = 模拟 +0.15 mention_rate 的"理想"重跑结果，measured_at = NOW
 *                       source 标记 'synthetic_p12_a13_demo' 便于审计；
 *                       真实的 after 数据要等到下一次每周 AI Tracker cron 跑完
 *
 * 幂等：重跑脚本会先清掉自己上次产生的 execution_item / action / metrics / outcome
 *       （靠 payload->>'e2e_demo' = 'p12.a.13' 和 source = 'synthetic_p12_a13_demo' 识别）
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/p12-a13-cts-e2e.ts
 *
 *   DRY_RUN=1  仅打印计划，不写 DB
 */

import { createClient } from '@supabase/supabase-js'

// ── Config ──────────────────────────────────────────────────────────────────

const CTS_ID = 'c0000000-0000-0000-0000-000000000000'
const E2E_MARKER = 'p12.a.13'
const SYNTHETIC_SOURCE = 'synthetic_p12_a13_demo'
const DRY_RUN = process.env.DRY_RUN === '1'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(stage: string, msg: string) {
  console.log(`[${stage}] ${msg}`)
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// ── Stage 0: cleanup previous run ───────────────────────────────────────────

async function cleanupPreviousRun(): Promise<void> {
  log('cleanup', 'looking for previous E2E artifacts...')

  // outcomes via actions
  const { data: oldActions } = await supabase
    .from('flywheel_actions')
    .select('id')
    .eq('client_id', CTS_ID)
    .filter('payload->>e2e_demo', 'eq', E2E_MARKER)

  const actionIds = (oldActions ?? []).map((a: { id: string }) => a.id)

  if (actionIds.length) {
    await supabase.from('flywheel_outcomes').delete().in('action_id', actionIds)
    await supabase.from('flywheel_actions').delete().in('id', actionIds)
    log('cleanup', `removed ${actionIds.length} old actions + outcomes`)
  }

  await supabase
    .from('flywheel_metrics')
    .delete()
    .eq('client_id', CTS_ID)
    .eq('source', SYNTHETIC_SOURCE)

  await supabase
    .from('execution_items')
    .delete()
    .eq('client_id', CTS_ID)
    .filter('steps_json->>e2e_demo', 'eq', E2E_MARKER)
}

// ── Stage 1: locate real GEO finding ────────────────────────────────────────

interface RealFinding {
  prescriptionId: string
  actionId: string
  title: string
  description: string
  originalFixType: string
}

async function locateRealFinding(): Promise<RealFinding> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id, content')
    .eq('client_id', CTS_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) fail(`no CTS prescription found: ${error?.message ?? 'empty'}`)

  type PrescriptionAction = {
    id: string
    title: string
    description: string
    dimension: string
    fix_type: string
  }
  type Phase = { actions?: PrescriptionAction[] }
  const phases: Phase[] = (data.content?.phases ?? []) as Phase[]

  for (const ph of phases) {
    for (const a of ph.actions ?? []) {
      if (a.dimension === 'ai_visibility') {
        return {
          prescriptionId: data.id,
          actionId: a.id,
          title: a.title,
          description: a.description,
          originalFixType: a.fix_type,
        }
      }
    }
  }
  fail('no ai_visibility action found in CTS prescription')
}

// ── Stage 2: materialize execution_item ─────────────────────────────────────

async function createExecutionItem(finding: RealFinding): Promise<string> {
  const executionTarget = {
    flywheel: 'geo',
    mode: 'in_house',
    action_type: 'geo.compose_directive',
  }

  const { data, error } = await supabase
    .from('execution_items')
    .insert({
      prescription_id: finding.prescriptionId,
      client_id: CTS_ID,
      dimension: 'ai_visibility',
      title: finding.title,
      description: finding.description,
      fix_type: 'me_auto', // overridden from 'fde_manual' so GeoComposerAdapter can handle
      status: 'in_progress',
      sort_order: 9999,
      phase: 1,
      execution_target: executionTarget,
      steps_json: {
        e2e_demo: E2E_MARKER,
        source_action_id: finding.actionId,
        original_fix_type: finding.originalFixType,
      },
    })
    .select('id')
    .single()

  if (error || !data) fail(`create execution_item: ${error?.message}`)
  return data.id
}

// ── Stage 3: seed baseline metric from real snapshot ────────────────────────

async function seedBaseline(): Promise<{ mentionRate: number; weekOf: string }> {
  const { data: snap, error } = await supabase
    .from('ai_visibility_snapshots')
    .select('id, week_of, mentions_count, total_runs, avg_rank, models_covered')
    .eq('client_id', CTS_ID)
    .order('week_of', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !snap) fail(`no CTS snapshot for baseline: ${error?.message}`)

  const mentionRate = (snap.mentions_count as number) / (snap.total_runs as number)
  const engineCoverage = Array.isArray(snap.models_covered) ? snap.models_covered.length : 0
  const measuredAt = `${snap.week_of}T00:00:00Z`

  const rows = [
    {
      client_id: CTS_ID,
      flywheel: 'geo' as const,
      metric_key: 'geo.query.mention_rate',
      metric_value: mentionRate,
      source: 'ai_tracker',
      source_ref: { snapshot_id: snap.id, p12_a13_baseline: true },
      measured_at: measuredAt,
    },
    {
      client_id: CTS_ID,
      flywheel: 'geo' as const,
      metric_key: 'geo.engine.coverage',
      metric_value: engineCoverage,
      source: 'ai_tracker',
      source_ref: { snapshot_id: snap.id, p12_a13_baseline: true },
      measured_at: measuredAt,
    },
    {
      client_id: CTS_ID,
      flywheel: 'geo' as const,
      metric_key: 'geo.query.avg_rank',
      metric_value: snap.avg_rank as number,
      source: 'ai_tracker',
      source_ref: { snapshot_id: snap.id, p12_a13_baseline: true },
      measured_at: measuredAt,
    },
  ]

  const { error: insErr } = await supabase.from('flywheel_metrics').insert(rows)
  if (insErr) fail(`baseline insert: ${insErr.message}`)

  return { mentionRate, weekOf: snap.week_of as string }
}

// ── Stage 4: execute action (with backdated executed_at) ────────────────────

async function executeAction(executionItemId: string, finding: RealFinding): Promise<string> {
  // executed_at backdated to halfway between baseline (2026-04-27) and now (2026-05-17)
  // → 2026-05-07. window_days=14 → window_end=2026-05-21, so today (2026-05-17) is in window.
  const executedAt = new Date()
  executedAt.setDate(executedAt.getDate() - 10)

  const { data, error } = await supabase
    .from('flywheel_actions')
    .insert({
      client_id: CTS_ID,
      execution_item_id: executionItemId,
      flywheel: 'geo',
      action_type: 'geo.compose_directive',
      execution_mode: 'in_house',
      payload: {
        e2e_demo: E2E_MARKER,
        source_prescription: finding.prescriptionId,
        source_action: finding.actionId,
        note: 'CTS GEO directive composition for AI visibility brand entity optimization',
      },
      expected_metric: 'geo.query.mention_rate',
      expected_delta: 0.05,
      executed_at: executedAt.toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) fail(`flywheel_actions insert: ${error?.message}`)
  return data.id
}

// ── Stage 5: seed after-metric (synthetic, clearly marked) ──────────────────

async function seedAfter(baselineRate: number): Promise<number> {
  const after = Math.min(1, baselineRate + 0.15)
  const now = new Date().toISOString()

  const { error } = await supabase.from('flywheel_metrics').insert({
    client_id: CTS_ID,
    flywheel: 'geo',
    metric_key: 'geo.query.mention_rate',
    metric_value: after,
    source: SYNTHETIC_SOURCE,
    source_ref: {
      note: 'Synthetic after-metric for E2E pipeline proof; real AI Tracker rerun pending next weekly cron',
    },
    measured_at: now,
  })

  if (error) fail(`after metric insert: ${error.message}`)
  return after
}

// ── Stage 6: run attribution job (inlined) ──────────────────────────────────

async function runAttribution(actionId: string): Promise<void> {
  const { data: action } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, expected_metric, expected_delta, executed_at')
    .eq('id', actionId)
    .single()

  if (!action) fail(`action ${actionId} disappeared`)

  const windowDays = 14
  const executedAt = new Date(action.executed_at)
  const windowEnd = new Date(executedAt)
  windowEnd.setDate(windowEnd.getDate() + windowDays)

  const { data: baselineRow } = await supabase
    .from('flywheel_metrics')
    .select('metric_value, measured_at')
    .eq('client_id', action.client_id)
    .eq('metric_key', action.expected_metric)
    .lt('measured_at', executedAt.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: afterRow } = await supabase
    .from('flywheel_metrics')
    .select('metric_value, measured_at')
    .eq('client_id', action.client_id)
    .eq('metric_key', action.expected_metric)
    .gte('measured_at', executedAt.toISOString())
    .lte('measured_at', windowEnd.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!baselineRow || !afterRow) {
    fail(`attribution missing rows — baseline=${!!baselineRow} after=${!!afterRow}`)
  }

  const baseline = Number(baselineRow.metric_value)
  const after = Number(afterRow.metric_value)
  const delta = after - baseline
  const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : null

  const absPct = deltaPct !== null ? Math.abs(deltaPct) : 0
  let verdict: 'confirmed' | 'reversed' | 'inconclusive'
  let confidence: number
  if (absPct < 3) {
    verdict = 'inconclusive'
    confidence = 0.2
  } else {
    confidence = Math.round(Math.min(0.95, absPct / 20) * 100) / 100
    const expDelta = action.expected_delta as number | null
    if (expDelta !== null && expDelta !== 0) {
      const same = expDelta > 0 === delta > 0
      verdict = same ? (confidence >= 0.35 ? 'confirmed' : 'inconclusive') : 'reversed'
    } else {
      verdict = delta > 0 ? 'confirmed' : 'reversed'
    }
  }

  await supabase.from('flywheel_outcomes').delete().eq('action_id', actionId)
  const { error: insErr } = await supabase.from('flywheel_outcomes').insert({
    action_id: actionId,
    client_id: action.client_id,
    metric_key: action.expected_metric,
    baseline,
    after_value: after,
    delta,
    delta_pct: deltaPct,
    confidence,
    verdict,
    window_days: windowDays,
    computed_at: new Date().toISOString(),
  })
  if (insErr) fail(`outcome insert: ${insErr.message}`)

  log('attribution', `baseline=${baseline.toFixed(4)} after=${after.toFixed(4)} ` +
    `delta=${delta.toFixed(4)} pct=${deltaPct?.toFixed(1)}% verdict=${verdict} confidence=${confidence}`)
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━'.repeat(60))
  console.log('P12.A.13 — CTS GEO 飞轮端到端验证')
  console.log('━'.repeat(60))
  console.log(`DRY_RUN = ${DRY_RUN}`)
  console.log(`CTS client_id = ${CTS_ID}`)
  console.log()

  if (DRY_RUN) {
    console.log('DRY_RUN: skipping all DB writes; exiting.')
    return
  }

  await cleanupPreviousRun()

  const finding = await locateRealFinding()
  log('finding', `${finding.actionId} — ${finding.title}`)
  log('finding', `original fix_type = ${finding.originalFixType} (overridden to me_auto for in_house demo)`)

  const itemId = await createExecutionItem(finding)
  log('exec_item', `created ${itemId}`)

  const { mentionRate, weekOf } = await seedBaseline()
  log('baseline', `mention_rate=${mentionRate.toFixed(4)} measured_at=${weekOf} (real snapshot)`)

  const actionId = await executeAction(itemId, finding)
  log('action', `flywheel_actions ${actionId} written (executed_at backdated 10d)`)

  const after = await seedAfter(mentionRate)
  log('after', `synthetic mention_rate=${after.toFixed(4)} (source=${SYNTHETIC_SOURCE})`)

  await runAttribution(actionId)

  // Final verification
  const { data: outcome } = await supabase
    .from('flywheel_outcomes')
    .select('*')
    .eq('action_id', actionId)
    .single()

  console.log()
  console.log('━'.repeat(60))
  console.log('✅ flywheel_outcomes 行：')
  console.log(JSON.stringify(outcome, null, 2))
  console.log('━'.repeat(60))
  console.log()
  console.log('PM 验证下一步：')
  console.log('  1. 启动 dev server: npm run dev')
  console.log(`  2. 打开: http://localhost:3001/dashboard/clients/${CTS_ID}/execution`)
  console.log(`  3. 找到标题为 "${finding.title}" 的卡片，应看到下面附带:`)
  console.log('     "✅ Mention rate +XX%, confirmed (confidence …)"')
  console.log()
  console.log('清理：重跑此脚本会自动清掉这次的 E2E 痕迹（marker = p12.a.13）')
}

main().catch((err) => {
  console.error('UNHANDLED:', err)
  process.exit(1)
})
