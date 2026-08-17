/**
 * 种子词扩展 —— 把 4 个套利方向长成一批可溯源的种子词。
 *
 * 链路：每个方向的入口锚点 → DataForSEO keyword_ideas（NZ）→ 过滤/去重 → 种子池。
 * 纯逻辑在 src/lib/commerce/product-intel/seed-expansion.ts，这里只做编排 + 落盘。
 *
 * 🔴 默认 dry-run。不加 --live 只打印锚点与预估花费，一个 API 都不调。
 * 🔴 这不写任何数据库，只把词表落成一个 JSON 文件供人过目。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/commerce-expand-seeds.ts            # dry-run
 *   npx tsx --env-file=.env.local scripts/commerce-expand-seeds.ts --live --out=seeds.json
 *   可选：--cap=25（每方向取几个）--limit=50（每锚点问多少 ideas）
 */

import { writeFileSync } from 'node:fs'
import { getKeywordIdeas } from '../src/lib/dataforseo/labs'
import { locationCodeFor } from '../src/lib/dataforseo/client'
import {
  EXPANSION_ANCHORS,
  ideasToSeeds,
  consolidateSeeds,
  DEFAULT_FILTER,
} from '../src/lib/commerce/product-intel/seed-expansion'
import type {
  ArbitrageDirection,
  SeedKeyword,
} from '../src/lib/commerce/product-intel/seed-expansion'

/** keyword_ideas 实测单价（2026-08-16 量级）。 */
const COST_PER_IDEAS_CALL_USD = 0.05

const DIRECTION_LABEL: Record<ArbitrageDirection, string> = {
  auto_accessories: '汽配',
  phone_tech: '3C 配件',
  pet: '宠物',
  home_gadgets: '家居小电',
}

interface Options {
  live: boolean
  cap: number
  limit: number
  out: string
}

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const num = (name: string, fallback: number): number => {
    const parsed = Number.parseInt(get(name) ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    live: argv.includes('--live'),
    cap: num('cap', 25),
    limit: num('limit', 50),
    out: get('out') ?? 'commerce-seeds.json',
  }
}

function anchorCount(): number {
  return Object.values(EXPANSION_ANCHORS).reduce((n, list) => n + list.length, 0)
}

async function expandOneAnchor(
  direction: ArbitrageDirection,
  anchor: string,
  nzLocation: number,
  limit: number,
): Promise<SeedKeyword[]> {
  try {
    const ideas = await getKeywordIdeas(anchor, nzLocation, limit)
    return ideasToSeeds(direction, anchor, ideas, DEFAULT_FILTER)
  } catch (err) {
    console.warn(`  ⚠️ 「${anchor}」扩词失败：${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

function printSummary(seeds: readonly SeedKeyword[]): void {
  const directions = Object.keys(EXPANSION_ANCHORS) as ArbitrageDirection[]
  for (const dir of directions) {
    const inDir = seeds.filter((s) => s.direction === dir)
    console.log(`\n【${DIRECTION_LABEL[dir]}】${inDir.length} 个种子词`)
    for (const s of inDir.slice(0, 12)) {
      console.log(`   ${s.keyword}  ·  NZ 月搜 ${s.searchVolumeNz}  ·  ← ${s.anchor}`)
    }
    if (inDir.length > 12) console.log(`   … 另有 ${inDir.length - 12} 个`)
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const anchors = anchorCount()

  console.log('种子词扩展 · 4 个套利方向')
  console.log(`入口锚点    ${anchors} 个（每方向问 ${opts.limit} 个 ideas，每方向留 top ${opts.cap}）`)
  console.log(`预估花费    约 US$${(anchors * COST_PER_IDEAS_CALL_USD).toFixed(2)}`)

  if (!opts.live) {
    console.log('\n[dry-run] 没加 --live，到此为止，一个 API 都没调。')
    console.log('入口锚点清单：')
    for (const [dir, list] of Object.entries(EXPANSION_ANCHORS)) {
      const labels = list.map((a) => `${a.keyword}${a.verified ? '✓' : ''}`).join(' · ')
      console.log(`   ${DIRECTION_LABEL[dir as ArbitrageDirection]}：${labels}`)
    }
    return
  }

  const nzLocation = locationCodeFor('nz')
  console.log('\n① 逐锚点扩词（NZ）…')
  const perAnchor = await Promise.all(
    (Object.entries(EXPANSION_ANCHORS) as [ArbitrageDirection, typeof EXPANSION_ANCHORS[ArbitrageDirection]][])
      .flatMap(([dir, list]) =>
        list.map((a) => expandOneAnchor(dir, a.keyword, nzLocation, opts.limit))),
  )
  const all = perAnchor.flat()
  console.log(`   ${anchors} 个锚点共长出 ${all.length} 个（去重前）`)

  const seeds = consolidateSeeds(all, opts.cap)
  console.log(`   去重 + 每方向 top ${opts.cap} 后：${seeds.length} 个种子词`)

  printSummary(seeds)

  writeFileSync(opts.out, JSON.stringify({ generatedFrom: 'NZ', seeds }, null, 2))
  console.log(`\n② 已落盘 ${opts.out}（${seeds.length} 个词，未写数据库）`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
