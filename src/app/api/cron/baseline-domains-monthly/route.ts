/**
 * GET/POST /api/cron/baseline-domains-monthly
 *
 * Phase 30 S5.2/5.3 — 定时重跑 baseline_domains 的 SeoCollector
 *
 * 注：路径仍叫 -monthly 是历史遗留，**实际频率由 Render schedule 决定**（PM 已改为 weekly）。
 * GET 用于 cron 触发（Bearer auth），POST 用于 admin UI 手动触发（cron-secret header + run-id header）。
 *
 * 流程：
 *   1. 写一行 baseline_cron_runs (status=running)
 *   2. 读取所有 baseline_domains
 *   3. 串行跑 SeoCollector（间隔 2s）
 *   4. 写回 baseline_domains.seo_score / last_collected_at
 *   5. 同步插入 baseline_domain_score_history (时序)
 *   6. 按 industry × 维度聚合分位，upsert industry_benchmarks
 *      ⚠️ 用 industry 字段（标准代码），不用 sub_industry — 让华佗能读到
 *   7. 更新 baseline_cron_runs (status=completed/partial/failed)
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}
 *   POST: x-cron-secret: ${CRON_SECRET}, x-run-id?: <pre-created run uuid>
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoCollector } from '@/lib/diagnostic/collectors/seo-collector'
import { startCronRun } from '@/lib/cron/run-logger'

// Fire-and-forget: GET returns 202 immediately, background work runs async.
// Cloudflare times out at ~100s; 44 domains × ~5-7s = ~310s total.
// maxDuration covers the actual background processing on Render.
export const maxDuration = 600

interface DomainRow {
  id: string
  industry: string
  sub_industry: string
  domain: string
  keywords: string[]
}

interface PerDomainResult {
  domain: string
  sub_industry: string
  score: number | null
  error?: string
}

// Pure helper: P50/P75/P90 with linear interpolation
function calcPercentiles(values: number[]): { p50: number; p75: number; p90: number } | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const p = (pct: number) => {
    const i  = (pct / 100) * (s.length - 1)
    const lo = Math.floor(i); const hi = Math.ceil(i)
    return lo === hi ? s[lo] : s[lo] + (i - lo) * (s[hi] - s[lo])
  }
  return { p50: Math.round(p(50)), p75: Math.round(p(75)), p90: Math.round(p(90)) }
}

async function runCollection(triggeredBy: 'cron' | 'admin_manual', existingRunId?: string) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const cronRun = await startCronRun('baseline-domains-monthly')

  // 1. Create or use existing run record
  let runId: string | undefined = existingRunId
  if (!runId) {
    const { data: runRow, error: insertError } = await supabaseAdmin
      .from('baseline_cron_runs')
      .insert({ status: 'running', triggered_by: triggeredBy })
      .select('id')
      .single()
    if (insertError || !runRow) {
      await cronRun.finish({ failed: 1, error: `Failed to create cron run record: ${insertError?.message ?? 'unknown'}` })
      return NextResponse.json(
        { error: `Failed to create cron run record: ${insertError?.message ?? 'unknown'}` },
        { status: 500 },
      )
    }
    runId = runRow.id
  }

  const startTime = Date.now()

  try {
    // 2. Load all baseline domains
    // is_active=false 的域名一分钱都不花（migration 20260731100000 起）。
    // 用停用而不是删除，是因为历史评分要留着 —— 物流那 18 个域名已攒了 690 条。
    const { data: rows, error: loadError } = await supabaseAdmin
      .from('baseline_domains')
      .select('id, industry, sub_industry, domain, keywords')
      .eq('is_active', true)
      .order('sub_industry')

    if (loadError) {
      await finalizeRun(runId!, {
        status: 'failed',
        error_message: `Failed to load domains: ${loadError.message}`,
        duration_seconds: Math.round((Date.now() - startTime) / 1000),
      })
      await cronRun.finish({ failed: 1, error: loadError.message })
      return NextResponse.json({ error: loadError.message }, { status: 500 })
    }

    const NON_COMMERCIAL_RE = /\.(govt|gov|org|edu|ac)\.|\.govt$|\.gov$|\.org$|\.edu$|\.ac$/i
    const domains = ((rows ?? []) as DomainRow[]).filter(
      r => !NON_COMMERCIAL_RE.test(r.domain)
    )
    if (domains.length === 0) {
      await finalizeRun(runId!, {
        status: 'completed',
        duration_seconds: Math.round((Date.now() - startTime) / 1000),
      })
      await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
      return NextResponse.json({ success: true, message: 'No baseline domains configured', run_id: runId })
    }

    // 3. Score domains in batches of CONCURRENCY (was serial+2s → too slow)
    // 2 concurrent + 1s between batches: ~150s for 44 domains (was ~310s)
    const collector = new SeoCollector(60_000)
    const results: PerDomainResult[] = []
    const failureDetails: PerDomainResult[] = []
    let succeeded = 0
    let failed = 0

    const CONCURRENCY = 2
    const BATCH_DELAY_MS = 1000

    async function processDomain(row: DomainRow): Promise<void> {
      if (!row.keywords || row.keywords.length === 0) {
        const r: PerDomainResult = { domain: row.domain, sub_industry: row.sub_industry, score: null, error: 'no_keywords' }
        results.push(r); failureDetails.push({ ...r }); failed++
        return
      }

      try {
        // baseline_domains has no per-row market, so fall back to the deploy default.
        // skipSerp: this cron keeps only `score` and discards `findings`, and
        // SERP feeds findings only — it is not in the score formula. Skipping it
        // drops ~75% of the per-domain cost (10 keywords × depth=100 ≈ US$0.20)
        // for a byte-identical score. Client diagnostics still get SERP.
        const result = await collector.collect(
          'baseline-cron', row.domain, row.keywords, [], process.env.SEMRUSH_DB ?? 'au', { skipSerp: true },
        )
        const score  = result.score

        if (score === null) {
          const r: PerDomainResult = { domain: row.domain, sub_industry: row.sub_industry, score: null, error: 'collector_null' }
          results.push(r); failureDetails.push({ ...r }); failed++
          return
        }

        const collectedAt = new Date().toISOString()

        await supabaseAdmin
          .from('baseline_domains')
          .update({ seo_score: score, last_collected_at: collectedAt })
          .eq('id', row.id)

        // Append history — check error so silent data gaps surface in logs
        const { error: historyError } = await supabaseAdmin
          .from('baseline_domain_score_history')
          .insert({
            baseline_domain_id: row.id,
            industry:           row.industry,
            sub_industry:       row.sub_industry,
            domain:             row.domain,
            dimension:          'seo',
            score,
            collected_at:       collectedAt,
          })
        if (historyError) {
          console.error('[baseline cron] history insert failed', { domain: row.domain, error: historyError.message })
        }

        results.push({ domain: row.domain, sub_industry: row.sub_industry, score })
        succeeded++
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        const r: PerDomainResult = { domain: row.domain, sub_industry: row.sub_industry, score: null, error: msg }
        results.push(r); failureDetails.push({ ...r }); failed++
      }
    }

    for (let i = 0; i < domains.length; i += CONCURRENCY) {
      const batch = domains.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(processDomain))
      if (i + CONCURRENCY < domains.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
    }

    // 4. Aggregate per industry (NOT sub_industry — so huatuo can read)
    // Group results by industry (which is the standard code that industry-mapper uses)
    const byIndustry = new Map<string, number[]>()
    for (const r of results) {
      if (r.score === null) continue
      const row = domains.find(d => d.domain === r.domain && d.sub_industry === r.sub_industry)
      if (!row) continue
      if (!byIndustry.has(row.industry)) byIndustry.set(row.industry, [])
      byIndustry.get(row.industry)!.push(r.score)
    }

    const snapshotDate = new Date().toISOString().split('T')[0]
    let benchmarksWritten = 0

    for (const [industry, scores] of byIndustry) {
      if (scores.length < 3) continue   // need at least 3 samples for a meaningful percentile

      const pct = calcPercentiles(scores)
      if (!pct) continue

      const confidence = Math.min(0.95, 0.50 + scores.length * 0.02)

      // Upsert into industry_benchmarks — use standard industry code (matches industry-mapper)
      // Market field is AU_NZ for now (single bucket); future PR can split by city/geo_scope
      const { error: upsertError } = await supabaseAdmin
        .from('industry_benchmarks')
        .upsert({
          industry_category: industry,
          market:            'AU_NZ',
          dimension:         'seo',
          score_p50:         pct.p50,
          score_p75:         pct.p75,
          score_p90:         pct.p90,
          sample_size:       scores.length,
          confidence:        Math.round(confidence * 100) / 100,
          source:            'P30.0 baseline cron',
          notes:             `Aggregated from ${scores.length} baseline_domains across all sub_industries`,
          snapshot_date:     snapshotDate,
        }, { onConflict: 'industry_category,market,dimension,snapshot_date' })

      if (!upsertError) benchmarksWritten++
    }

    // 5. Finalize cron run record
    const finalStatus = failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed'
    await finalizeRun(runId!, {
      status:             finalStatus,
      domains_attempted:  domains.length,
      domains_succeeded:  succeeded,
      domains_failed:     failed,
      benchmarks_written: benchmarksWritten,
      duration_seconds:   Math.round((Date.now() - startTime) / 1000),
      failure_details:    failureDetails.length > 0 ? failureDetails : null,
    })

    await cronRun.finish({
      processed: domains.length,
      completed: succeeded,
      failed,
      summary: { benchmarks_written: benchmarksWritten },
    })
    return NextResponse.json({
      success:  true,
      run_id:   runId,
      processed: domains.length,
      succeeded,
      failed,
      benchmarks_written: benchmarksWritten,
      results,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await finalizeRun(runId!, {
      status: 'failed',
      error_message: msg,
      duration_seconds: Math.round((Date.now() - startTime) / 1000),
    })
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function finalizeRun(runId: string, fields: {
  status: string
  domains_attempted?: number
  domains_succeeded?: number
  domains_failed?: number
  benchmarks_written?: number
  duration_seconds?: number
  error_message?: string
  failure_details?: unknown
}) {
  await supabaseAdmin
    .from('baseline_cron_runs')
    .update({ ...fields, completed_at: new Date().toISOString() })
    .eq('id', runId)
}

/** 每周最多跑一次。Render 上的 cron 频率改不了(后台手工建的)，所以在代码层节流。 */
const MIN_DAYS_BETWEEN_RUNS = 7

/**
 * 距离上一次「真的跑出结果」够 7 天了吗？
 *
 * 手动触发(admin_manual)也算数 —— FDE 刚手动刷过，数据就是新的，
 * 没理由第二天再花一次钱。
 *
 * 读不到状态时**选择不跑**：这是花钱的操作，宁可漏跑一周，
 * 也不要因为读不到上次时间而每天重复烧钱。
 */
async function weeklyThrottleCheck(): Promise<{ skip: boolean; daysSince?: number }> {
  const { data, error } = await supabaseAdmin
    .from('baseline_cron_runs')
    .select('started_at')
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[baseline cron] throttle check failed — skipping to avoid repeat spend:', error.message)
    return { skip: true }
  }
  // 从没成功跑过 → 放行
  if (!data) return { skip: false }

  const daysSince = (Date.now() - new Date((data as { started_at: string }).started_at).getTime()) / 86_400_000
  return { skip: daysSince < MIN_DAYS_BETWEEN_RUNS, daysSince }
}

// GET — cron trigger (Bearer auth, fire-and-forget to avoid Cloudflare 524)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 成本闸门 — PM 2026-07-31「每周省到底」──────────────────────────────────
  // 背景：这个 cron 原本每天跑 61 个域名 ≈ US$12/次 × 30 = 约 US$360/月，
  // 而它产出的 industry_benchmarks 行从 2026-05-13 起就没成功写入过
  // （upsert 引用了不存在的 snapshot_date 列，错误被吞，PR #664 才修）。
  //
  // 两道闸把它压到约 US$13/月：
  //   1. skipSerp（见下方 processDomain）—— 砍掉占 75% 成本、却不参与打分的
  //      SERP 调用。分数一模一样，不是省钱换质量。
  //   2. 每周节流（本段）—— Render 上那个 cron job 是后台手工建的、不在
  //      render.yaml 里，本仓也没有 Render API 凭证，改不了它的频率。
  //      所以让它照常每天敲门，由代码判断「距上次成功跑够不够 7 天」。
  //      好处是频率跟代码一起走，不依赖任何人去后台点。
  //
  // 完全停用：设 BASELINE_CRON_ENABLED=false。
  // 强制立刻跑一次：管理页「▶ Run SEO baselines」按钮（POST），不受本段影响。
  if (process.env.BASELINE_CRON_ENABLED === 'false') {
    console.warn('[baseline cron] skipped — BASELINE_CRON_ENABLED=false')
    return NextResponse.json({
      success: true, skipped: true, reason: 'disabled',
      message: 'Baseline collection is disabled via BASELINE_CRON_ENABLED=false.',
    })
  }

  const throttle = await weeklyThrottleCheck()
  if (throttle.skip) {
    console.info(`[baseline cron] skipped — last successful run ${throttle.daysSince?.toFixed(1)}d ago (<${MIN_DAYS_BETWEEN_RUNS}d)`)
    return NextResponse.json({
      success: true, skipped: true, reason: 'throttled',
      days_since_last_run: throttle.daysSince,
      message: `Runs at most once every ${MIN_DAYS_BETWEEN_RUNS} days.`,
    })
  }

  // Respond immediately so Cloudflare doesn't 524; collection runs in background
  void runCollection('cron')
  return NextResponse.json(
    { success: true, message: 'Baseline collection started in background' },
    { status: 202 },
  )
}

// POST — admin manual trigger (x-cron-secret header)
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const runId = req.headers.get('x-run-id') ?? undefined
  return runCollection('admin_manual', runId)
}
