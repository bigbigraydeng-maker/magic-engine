/**
 * P30.0 S2 — Tourism Baseline Collector
 *
 * 对 inbound + outbound 两个细分的域名清单跑 SeoCollector，
 * 计算 P50/P75/P90，upsert 到 industry_benchmarks 表。
 *
 * 用法：npx tsx scripts/p30-s2-collect-baselines.ts
 *
 * 环境变量：DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { SeoCollector } from '../src/lib/diagnostic/collectors/seo-collector'

// ─── 域名清单（PM 核验后确认）────────────────────────────────────────────────

const INBOUND_DOMAINS = [
  'hakatours.com',
  'discovernewzealand.com',
  'moatrek.com',
  'kiwiexperience.com',
  'aatkings.com',
  'firstlighttravel.com',
  'newzealandtours.travel',
  'arohatours.co.nz',
  'adventuretours.com.au',
]

// 对应关键词：inbound 用通用 NZ tour operator 词
const INBOUND_KEYWORDS = [
  'tour operator new zealand',
  'new zealand tours',
  'guided tours new zealand',
  'nz tour operator',
  'adventure tours nz',
  'travel company new zealand',
]

const OUTBOUND_DOMAINS = [
  'ctstours.co.nz',
  'wendywutours.co.nz',
  'worldjourneys.co.nz',
  'onthegotours.com',
  'inspiringvacations.com',
  'rdtravel.co.nz',
]

// 对应关键词：outbound 用目的地词（CTS 的真实战场）
const OUTBOUND_KEYWORDS = [
  'china tours from new zealand',
  'china travel packages nz',
  'china tour nz',
  'japan tours from new zealand',
  'asia tours new zealand',
  'europe tours from new zealand',
  'escorted tours from new zealand',
]

// ─── 百分位计算 ────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

interface DomainResult {
  domain: string
  score: number | null
  error?: string
}

async function collectSubIndustry(
  subIndustry: string,
  domains: string[],
  keywords: string[],
): Promise<DomainResult[]> {
  const collector = new SeoCollector(60_000)
  const results: DomainResult[] = []

  console.log(`\n▶ [${subIndustry}] 采集 ${domains.length} 个域名…`)
  console.log(`  关键词：${keywords.join(' / ')}`)
  console.log()

  for (const domain of domains) {
    process.stdout.write(`  ${domain.padEnd(40)} …`)
    try {
      // clientId 仅用于 findings，传占位符；驱动打分的是 domain + keywords
      const result = await collector.collect('baseline-placeholder', domain, keywords)
      const score = result.score
      results.push({ domain, score })
      console.log(` score=${score ?? 'null'}`)
    } catch (err: any) {
      console.log(` ❌ ${err.message}`)
      results.push({ domain, score: null, error: err.message })
    }
    // 每个域名间隔 2s，避免 DataForSEO 限速
    await new Promise(r => setTimeout(r, 2000))
  }

  return results
}

function computePercentiles(results: DomainResult[]): {
  p50: number; p75: number; p90: number; sample_size: number; scores: number[]
} {
  const scores = results.filter(r => r.score !== null).map(r => r.score as number).sort((a, b) => a - b)
  return {
    p50: percentile(scores, 50),
    p75: percentile(scores, 75),
    p90: percentile(scores, 90),
    sample_size: scores.length,
    scores,
  }
}

async function upsertBenchmark(
  supabase: ReturnType<typeof createClient>,
  subIndustry: string,
  p50: number,
  p75: number,
  p90: number,
  sampleSize: number,
  notes: string,
) {
  // upsert on (industry_category, dimension, market, business_size)
  const row = {
    industry_category: subIndustry,
    business_size: 'medium' as const,
    market: 'NZ' as const,
    dimension: 'seo' as const,
    score_p50: p50,
    score_p75: p75,
    score_p90: p90,
    realistic_3mo_growth_pct: null,
    realistic_6mo_growth_pct: null,
    typical_monthly_budget_aud: null,
    source: 'P30.0 S2 DataForSEO SeoCollector',
    source_url: null,
    confidence: parseFloat((Math.min(1, sampleSize / 10)).toFixed(2)),
    sample_size: sampleSize,
    notes,
  }

  const { error } = await supabase
    .from('industry_benchmarks')
    .upsert(row, { onConflict: 'industry_category,dimension,market,business_size' })

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

async function main() {
  // ── Validate env ──────────────────────────────────────────────────────────
  const missing = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k])
  if (missing.length > 0) throw new Error(`缺少环境变量：${missing.join(', ')}`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log('='.repeat(65))
  console.log('P30.0 S2 — Tourism Baseline Collector')
  console.log('细分：inbound_tour_operator + outbound_tour_operator')
  console.log('='.repeat(65))

  // ── Inbound ───────────────────────────────────────────────────────────────
  const inboundResults = await collectSubIndustry(
    'inbound_tour_operator',
    INBOUND_DOMAINS,
    INBOUND_KEYWORDS,
  )

  const inbound = computePercentiles(inboundResults)
  console.log(`\n  Inbound 有效样本：${inbound.sample_size}/${INBOUND_DOMAINS.length}`)
  console.log(`  分数分布：${inbound.scores.join(', ')}`)
  console.log(`  P50=${inbound.p50}  P75=${inbound.p75}  P90=${inbound.p90}`)

  // ── Outbound ──────────────────────────────────────────────────────────────
  const outboundResults = await collectSubIndustry(
    'outbound_tour_operator',
    OUTBOUND_DOMAINS,
    OUTBOUND_KEYWORDS,
  )

  const outbound = computePercentiles(outboundResults)
  console.log(`\n  Outbound 有效样本：${outbound.sample_size}/${OUTBOUND_DOMAINS.length}`)
  console.log(`  分数分布：${outbound.scores.join(', ')}`)
  console.log(`  P50=${outbound.p50}  P75=${outbound.p75}  P90=${outbound.p90}`)

  // ── Upsert to Supabase ────────────────────────────────────────────────────
  console.log('\n▶ 写入 industry_benchmarks…')

  if (inbound.sample_size < 3) {
    console.log('  ⚠️  Inbound 有效样本 < 3，跳过写入（数据不可信）')
  } else {
    const inboundNote = `P30.0 S2 实测。域名：${inboundResults.filter(r => r.score !== null).map(r => r.domain).join(', ')}。分数：${inbound.scores.join(', ')}`
    await upsertBenchmark(supabase, 'inbound_tour_operator', inbound.p50, inbound.p75, inbound.p90, inbound.sample_size, inboundNote)
    console.log(`  ✅ inbound_tour_operator  P50=${inbound.p50} P75=${inbound.p75} P90=${inbound.p90}`)
  }

  if (outbound.sample_size < 3) {
    console.log('  ⚠️  Outbound 有效样本 < 3，跳过写入（数据不可信）')
  } else {
    const outboundNote = `P30.0 S2 实测。域名：${outboundResults.filter(r => r.score !== null).map(r => r.domain).join(', ')}。分数：${outbound.scores.join(', ')}`
    await upsertBenchmark(supabase, 'outbound_tour_operator', outbound.p50, outbound.p75, outbound.p90, outbound.sample_size, outboundNote)
    console.log(`  ✅ outbound_tour_operator  P50=${outbound.p50} P75=${outbound.p75} P90=${outbound.p90}`)
  }

  // ── 明细报告 ──────────────────────────────────────────────────────────────
  console.log()
  console.log('='.repeat(65))
  console.log('明细报告')
  console.log('='.repeat(65))
  console.log('\n[Inbound — NZ 入境游运营商]')
  inboundResults.forEach(r => {
    const bar = r.score !== null ? '█'.repeat(Math.round(r.score / 5)) : '—'
    console.log(`  ${r.domain.padEnd(35)} ${String(r.score ?? 'null').padEnd(6)} ${bar}`)
  })

  console.log('\n[Outbound — NZ 出境游运营商，对标 CTS Tours]')
  outboundResults.forEach(r => {
    const bar = r.score !== null ? '█'.repeat(Math.round(r.score / 5)) : '—'
    const isCts = r.domain === 'ctstours.co.nz' ? ' ← CTS（客户）' : ''
    console.log(`  ${r.domain.padEnd(35)} ${String(r.score ?? 'null').padEnd(6)} ${bar}${isCts}`)
  })

  console.log()
  console.log('='.repeat(65))
  console.log('✅ S2 完成。下一步：S3 前端域名管理页')
  console.log('='.repeat(65))
}

main().catch(err => {
  console.error('❌ 脚本失败:', err.message ?? err)
  process.exit(1)
})
