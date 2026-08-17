/**
 * 批量选品扫描 —— 把一张种子词表逐词跑完整链路，汇总成一张全局候选榜。
 *
 * 每个词走 src/lib/commerce/product-intel/scan.ts 的 scanSeedKeyword（与单词 POC 同一实现），
 * 词之间**串行**（Apify actor 并发有账户上限，串行稳），单词失败不中断整批。
 *
 * 🔴 默认 dry-run。不加 --live 只打印计划与预估花费，一个 API 都不调。
 * 🔴 不写数据库。结果落成一个 JSON 文件 + 终端分档报告。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/commerce-scan-batch.ts \
 *     --seeds=<path>.json --directions=phone_tech,pet --live --out=candidates.json
 *   可选：--max=10（每词 TikTok 取几条）--enrich=3（其中几条做供货+需求）
 *        --limit=3（只跑前 N 个词，验证批量逻辑用）
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { scanSeedKeyword } from '../src/lib/commerce/product-intel/scan'
import type { ScoredCandidate, Verdict } from '../src/lib/commerce/product-intel/types'
import type { SeedKeyword } from '../src/lib/commerce/product-intel/seed-expansion'
import {
  COST_ASSUMPTIONS,
  COST_PER_TIKTOK_ROW_USD,
  COST_PER_IMAGE_SEARCH_USD,
  COST_PER_DFSE_CALL_USD,
  DFSE_CALLS_PER_SEED,
} from './commerce-cost-assumptions'

const VERDICT_LABEL: Record<Verdict, string> = {
  TEST_NOW: '✅ 值得测',
  // 落 WATCH 可能因倾销未查（等 Trade Me）或重量是估的 —— 标签保持中性，别谎称只差重量。
  WATCH: '👀 观察（需实测重量 / 查倾销）',
  UNKNOWN: '❓ 判不了',
  REJECT: '❌ 排除',
}

interface Options {
  seeds: string
  directions: string[]
  max: number
  enrich: number
  limit: number
  live: boolean
  out: string
}

/** 一行汇总：候选 + 它来自哪个种子词/方向。 */
interface BatchRow {
  seedKeyword: string
  direction: string
  scored: ScoredCandidate
}

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const num = (name: string, fallback: number): number => {
    const parsed = Number.parseInt(get(name) ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    seeds: get('seeds') ?? '',
    directions: (get('directions') ?? 'phone_tech,pet').split(',').filter(Boolean),
    max: num('max', 10),
    enrich: num('enrich', 3),
    limit: num('limit', 0),   // 0 = 不限
    live: argv.includes('--live'),
    out: get('out') ?? 'commerce-candidates.json',
  }
}

function loadSeeds(path: string, directions: readonly string[], limit: number): SeedKeyword[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { seeds: SeedKeyword[] }
  const filtered = parsed.seeds.filter((s) => directions.includes(s.direction))
  return limit > 0 ? filtered.slice(0, limit) : filtered
}

function estimateCostUsd(seedCount: number, opts: Options): number {
  const perSeed = opts.max * COST_PER_TIKTOK_ROW_USD
    + opts.enrich * COST_PER_IMAGE_SEARCH_USD
    + DFSE_CALLS_PER_SEED * COST_PER_DFSE_CALL_USD
  return seedCount * perSeed
}

function printReport(rows: readonly BatchRow[], failed: readonly string[]): void {
  const counts: Record<Verdict, number> = { TEST_NOW: 0, WATCH: 0, UNKNOWN: 0, REJECT: 0 }
  for (const r of rows) counts[r.scored.verdict]++

  console.log(`\n═══ 分档统计（共 ${rows.length} 个候选，${failed.length} 个词没扫成）═══`)
  for (const v of ['TEST_NOW', 'WATCH', 'UNKNOWN', 'REJECT'] as Verdict[]) {
    console.log(`   ${VERDICT_LABEL[v]}  ${counts[v]}`)
  }

  // 重点看值得测 + 值得观察的，按证据强度降序。
  const worth = rows
    .filter((r) => r.scored.verdict === 'TEST_NOW' || r.scored.verdict === 'WATCH')
    .sort((a, b) => b.scored.evidenceRank - a.scored.evidenceRank)

  console.log(`\n═══ 值得关注的候选（${worth.length}）═══`)
  worth.slice(0, 25).forEach((r, i) => {
    const c = r.scored.candidate
    const econ = r.scored.gates.find((g) => g.gate === 'unit_economics')
    console.log(`\n${i + 1}. ${VERDICT_LABEL[r.scored.verdict]}  ${c.title.slice(0, 60)}`)
    console.log(`   方向 ${r.direction} · 种子词「${r.seedKeyword}」`)
    console.log(`   美国已售 ${c.cumulativeSold.value?.toLocaleString() ?? '—'}`
      + ` · 本地中位 ${c.localMarket?.medianPriceNzd.value != null
        ? `NZ$${c.localMarket.medianPriceNzd.value.toFixed(2)}` : '—'}`)
    if (econ) console.log(`   ${econ.reason}`)
  })
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.seeds) {
    console.error('缺 --seeds=<path>.json')
    process.exit(1)
  }

  const seeds = loadSeeds(opts.seeds, opts.directions, opts.limit)
  console.log(`种子词表    ${opts.seeds}`)
  console.log(`方向        ${opts.directions.join(' / ')}`)
  console.log(`词数        ${seeds.length}${opts.limit > 0 ? `（--limit=${opts.limit}）` : ''}`)
  console.log(`每词        TikTok ${opts.max} 条 → 前 ${opts.enrich} 条做供货+需求`)
  console.log(`预估花费    约 US$${estimateCostUsd(seeds.length, opts).toFixed(2)}`)

  if (!opts.live) {
    console.log('\n[dry-run] 没加 --live，到此为止，一个 API 都没调。')
    console.log('将扫的词：', seeds.map((s) => s.keyword).join(' · '))
    return
  }

  const rows: BatchRow[] = []
  const failed: string[] = []
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    process.stdout.write(`\n[${i + 1}/${seeds.length}] ${seed.keyword} (${seed.direction}) … `)
    try {
      const result = await scanSeedKeyword(seed.keyword, COST_ASSUMPTIONS, {
        maxResults: opts.max, enrichCount: opts.enrich,
      })
      if (result.error) {
        failed.push(seed.keyword)
        process.stdout.write(`✗ ${result.error}`)
        continue
      }
      for (const scored of result.scored) {
        rows.push({ seedKeyword: seed.keyword, direction: seed.direction, scored })
      }
      const best = result.scored[0]?.verdict ?? '无候选'
      process.stdout.write(`✓ ${result.scored.length} 个候选（最好 ${best}）`)
    } catch (err) {
      failed.push(seed.keyword)
      process.stdout.write(`✗ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  printReport(rows, failed)
  writeFileSync(opts.out, JSON.stringify({ generatedAt: COST_ASSUMPTIONS.asOf, rows, failed }, null, 2))
  console.log(`\n\n已落盘 ${opts.out}（${rows.length} 个候选，未写数据库）`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
