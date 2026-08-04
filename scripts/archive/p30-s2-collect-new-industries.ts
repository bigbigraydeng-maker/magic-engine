/**
 * P30 S2 — 新三个细分 SeoCollector 采集
 *
 * 从 baseline_domains 表读取 seo_score IS NULL 的行，
 * 对每个域名跑 SeoCollector，结果写回 seo_score + last_collected_at。
 *
 * 用法：npx tsx scripts/p30-s2-collect-new-industries.ts
 *       可选过滤：SUB_INDUSTRY=real_estate_auckland npx tsx ...
 */

import { createClient } from '@supabase/supabase-js'
import { SeoCollector } from '../src/lib/diagnostic/collectors/seo-collector'

const TARGET_SUB_INDUSTRIES = [
  'real_estate_auckland',
  'flooring_tiles_brisbane',
  'logistics_3pl_nz',
]

async function main() {
  const missing = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter(k => !process.env[k])
  if (missing.length) throw new Error(`缺少环境变量：${missing.join(', ')}`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 只跑目标细分中 seo_score IS NULL 的行（避免重复采集）
  const filter = process.env.SUB_INDUSTRY
    ? [process.env.SUB_INDUSTRY]
    : TARGET_SUB_INDUSTRIES

  const { data: rows, error } = await supabase
    .from('baseline_domains')
    .select('id, sub_industry, domain, keywords, city')
    .in('sub_industry', filter)
    .is('seo_score', null)
    .order('sub_industry')
    .order('domain')

  if (error) throw new Error(`DB read error: ${error.message}`)
  if (!rows || rows.length === 0) {
    console.log('✅ 所有目标域名已有分数，无需采集')
    return
  }

  console.log('='.repeat(60))
  console.log('P30 S2 — 新三细分 SeoCollector 采集')
  console.log(`待采集：${rows.length} 个域名`)
  console.log('='.repeat(60))

  const collector = new SeoCollector(60_000)
  const results: Array<{ sub_industry: string; domain: string; score: number | null }> = []
  let currentGroup = ''

  for (const row of rows) {
    if (row.sub_industry !== currentGroup) {
      currentGroup = row.sub_industry
      console.log(`\n▶ [${currentGroup}]`)
    }

    if (!row.keywords || row.keywords.length === 0) {
      console.log(`  ${row.domain.padEnd(40)} ⚠️  无关键词，跳过`)
      results.push({ sub_industry: row.sub_industry, domain: row.domain, score: null })
      continue
    }

    process.stdout.write(`  ${row.domain.padEnd(40)} …`)

    try {
      const result = await collector.collect('baseline-placeholder', row.domain, row.keywords)
      const score = result.score

      // 写回数据库
      const { error: updateErr } = await supabase
        .from('baseline_domains')
        .update({ seo_score: score, last_collected_at: new Date().toISOString() })
        .eq('id', row.id)

      if (updateErr) {
        console.log(` ❌ DB write error: ${updateErr.message}`)
      } else {
        console.log(` score=${score ?? 'null'}`)
      }

      results.push({ sub_industry: row.sub_industry, domain: row.domain, score })
    } catch (err: any) {
      console.log(` ❌ ${err.message}`)
      results.push({ sub_industry: row.sub_industry, domain: row.domain, score: null })
    }

    // 每域名间隔 2s 避免 DataForSEO 限速
    await new Promise(r => setTimeout(r, 2000))
  }

  // ── 汇总报告 ──────────────────────────────────────────────────────────────
  console.log()
  console.log('='.repeat(60))
  console.log('采集完成 — 各细分 P50/P75/P90')
  console.log('='.repeat(60))

  for (const sub of filter) {
    const group = results.filter(r => r.sub_industry === sub && r.score !== null)
    const scores = group.map(r => r.score as number).sort((a, b) => a - b)
    if (scores.length === 0) {
      console.log(`\n[${sub}] 无有效分数`)
      continue
    }
    const p = (pct: number) => {
      const idx = (pct / 100) * (scores.length - 1)
      const lo = Math.floor(idx), hi = Math.ceil(idx)
      return lo === hi ? scores[lo] : Math.round(scores[lo] + (scores[hi] - scores[lo]) * (idx - lo))
    }
    console.log(`\n[${sub}]`)
    console.log(`  样本：${scores.length}  分布：${scores.join(', ')}`)
    console.log(`  P50=${p(50)}  P75=${p(75)}  P90=${p(90)}`)

    // 同步写回 industry_benchmarks（upsert）
    const noteRow = group.map(r => `${r.domain}=${r.score}`).join(', ')
    const confidence = Math.min(1, parseFloat((scores.length / 10).toFixed(2)))
    const { error: benchErr } = await supabase
      .from('industry_benchmarks')
      .upsert({
        industry_category: sub,
        business_size: 'medium',
        market: sub.endsWith('_nz') || sub.includes('auckland') ? 'NZ' : 'AU',
        dimension: 'seo',
        score_p50: p(50),
        score_p75: p(75),
        score_p90: p(90),
        source: 'P30 S2 DataForSEO SeoCollector',
        confidence,
        sample_size: scores.length,
        notes: `P30 S2 实测 2026-06-02. ${noteRow}`,
      }, { onConflict: 'industry_category,dimension,market,business_size' })

    if (benchErr) {
      console.log(`  ⚠️  industry_benchmarks upsert failed: ${benchErr.message}`)
    } else {
      console.log(`  ✅ industry_benchmarks 已更新`)
    }
  }

  console.log()
  console.log('✅ S2 采集完成')
}

main().catch(err => {
  console.error('❌', err.message ?? err)
  process.exit(1)
})
