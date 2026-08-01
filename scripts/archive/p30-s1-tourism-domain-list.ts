/**
 * P30.0 S1 — Tourism Operator 行业域名清单抽取
 *
 * 目的：用 DataForSEO SERP 对 tourism_operator 行业核心词跑 top-20 排名，
 *       聚合域名出现频次，过滤聚合站，输出候选域名清单供 PM 核验。
 *
 * 关键约束：DataForSEO live/advanced 每次只能发 1 个 task，需串行调用。
 *
 * 用法：npx tsx scripts/p30-s1-tourism-domain-list.ts
 *
 * 输出：console（人读）+ scripts/p30-s1-tourism-domains-output.json（机读）
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── 配置 ─────────────────────────────────────────────────────────────────────

// AU 关键词组（高流量，location_code 2036）
const AU_KEYWORDS = [
  'tour operator australia',
  'australia travel packages',
  'travel company australia',
  'guided tours australia',
  'adventure tours australia',
]

// NZ 关键词组（location_code 2554）
const NZ_KEYWORDS = [
  'tour operator new zealand',
  'new zealand tours',
  'nz tour operator',
  'guided tours new zealand',
  'travel company new zealand',
  'south island tours nz',
  'adventure tours nz',
]

// DataForSEO location codes
const LOCATION_AU = 2036
const LOCATION_NZ = 2554
const SERP_DEPTH = 20

// 聚合站黑名单（不算行业原生玩家）
const AGGREGATOR_BLACKLIST = [
  'tripadvisor.com',
  'tripadvisor.com.au',
  'tripadvisor.co.nz',
  'booking.com',
  'expedia.com',
  'expedia.com.au',
  'viator.com',
  'getyourguide.com',
  'airbnb.com',
  'lonelyplanet.com',
  'roughguides.com',
  'tourism.net.nz',
  'newzealand.com',
  'australia.com',
  'tourismaustralia.com',
  'tourism.australia.com',
  'wikitravel.org',
  'reddit.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'google.com',
  'yelp.com',
  'trustpilot.com',
  'productreview.com.au',
  'travelstride.com',  // 聚合目录站
  'tourhq.com',        // 聚合目录站
  'tourradar.com',     // 聚合目录站
  'cato.travel',       // 代理商协会
]

// ─── DataForSEO 单次调用（1 task at a time）────────────────────────────────────

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

function getCredentials(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD 未设置，请先 source .env.local')
  }
  return Buffer.from(`${login}:${password}`).toString('base64')
}

interface SerpItem {
  type?: string
  rank_absolute?: number
  domain?: string
  url?: string
}

async function fetchOneSerpKeyword(
  keyword: string,
  locationCode: number,
  credentials: string,
): Promise<{ keyword: string; items: SerpItem[]; statusMsg: string }> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    // Single task array
    body: JSON.stringify([{ keyword, location_code: locationCode, language_code: 'en', depth: SERP_DEPTH }]),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DataForSEO ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = await res.json() as { tasks?: Array<{ data?: { keyword?: string }; result?: Array<{ items?: SerpItem[] }>; status_message?: string }> }
  const task = json.tasks?.[0]
  const statusMsg = task?.status_message ?? ''
  const items = task?.result?.[0]?.items ?? []
  return { keyword, items, statusMsg }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

interface DomainEntry {
  domain: string
  keyword_hits: number
  best_position: number
  keywords_present: string[]
  markets: string[]  // 'AU' | 'NZ'
}

function isBlacklisted(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '')
  return AGGREGATOR_BLACKLIST.some(b => d === b || d.endsWith(`.${b}`))
}

function normaliseDomain(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, '')
}

async function main() {
  const credentials = getCredentials()
  const domainMap = new Map<string, DomainEntry>()

  console.log('='.repeat(65))
  console.log('P30.0 S1 — Tourism Operator 域名清单抽取（串行逐词）')
  console.log(`AU 关键词：${AU_KEYWORDS.length}  NZ 关键词：${NZ_KEYWORDS.length}  SERP 深度：${SERP_DEPTH}`)
  console.log('='.repeat(65))
  console.log()

  async function processKeyword(keyword: string, locationCode: number, market: string) {
    process.stdout.write(`  [${market}] ${keyword} …`)
    try {
      const { items, statusMsg } = await fetchOneSerpKeyword(keyword, locationCode, credentials)
      const organic = items.filter(it => it.type === 'organic')
      console.log(` ${organic.length} organic${statusMsg && statusMsg !== '20000 Ok.' && statusMsg !== 'Ok.' ? ' ⚠️ ' + statusMsg : ''}`)

      for (const item of organic) {
        const raw = item.domain ?? ''
        if (!raw) continue
        const domain = normaliseDomain(raw)
        if (isBlacklisted(domain)) continue

        const pos = item.rank_absolute ?? 999
        if (!domainMap.has(domain)) {
          domainMap.set(domain, { domain, keyword_hits: 0, best_position: pos, keywords_present: [], markets: [] })
        }
        const entry = domainMap.get(domain)!
        entry.keyword_hits += 1
        entry.keywords_present.push(`[${market}] ${keyword}`)
        if (pos < entry.best_position) entry.best_position = pos
        if (!entry.markets.includes(market)) entry.markets.push(market)
      }
    } catch (err: any) {
      console.log(` ❌ ${err.message}`)
    }
    // Polite delay — avoid hammering the API
    await new Promise(r => setTimeout(r, 800))
  }

  console.log('▶ AU 关键词组…')
  for (const kw of AU_KEYWORDS) {
    await processKeyword(kw, LOCATION_AU, 'AU')
  }

  console.log()
  console.log('▶ NZ 关键词组…')
  for (const kw of NZ_KEYWORDS) {
    await processKeyword(kw, LOCATION_NZ, 'NZ')
  }

  // 排序：keyword_hits 降序，best_position 升序
  const sorted = [...domainMap.values()].sort((a, b) => {
    if (b.keyword_hits !== a.keyword_hits) return b.keyword_hits - a.keyword_hits
    return a.best_position - b.best_position
  })

  // ─── 人读输出 ──────────────────────────────────────────────────────────────
  console.log()
  console.log('='.repeat(65))
  console.log(`候选域名清单（共 ${sorted.length} 个，已过滤聚合站）`)
  console.log('='.repeat(65))
  console.log(`${'#'.padEnd(4)} ${'域名'.padEnd(38)} ${'市场'.padEnd(8)} ${'命中词'.padEnd(8)} 最佳排名`)
  console.log('-'.repeat(65))
  sorted.forEach((e, i) => {
    console.log(
      `${String(i + 1).padEnd(4)} ${e.domain.padEnd(38)} ${e.markets.join('/').padEnd(8)} ${String(e.keyword_hits).padEnd(8)} ${e.best_position}`
    )
  })

  const recommended = sorted.slice(0, 15)
  console.log()
  console.log('='.repeat(65))
  console.log('推荐样本（前 15，供 PM 核验 → 目标保留 8-12 个真实 AU/NZ 运营商）')
  console.log('='.repeat(65))
  recommended.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.domain}  [${e.markets.join('/')}]  命中 ${e.keyword_hits} 词，最佳第 ${e.best_position} 名`)
  })

  // ─── JSON 输出 ────────────────────────────────────────────────────────────
  const output = {
    generated_at: new Date().toISOString(),
    industry: 'tourism_operator',
    markets: ['AU', 'NZ'],
    au_keywords: AU_KEYWORDS,
    nz_keywords: NZ_KEYWORDS,
    serp_depth: SERP_DEPTH,
    total_candidates: sorted.length,
    recommended_sample: recommended,
    all_candidates: sorted,
  }

  const outPath = path.join(__dirname, 'p30-s1-tourism-domains-output.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')

  console.log()
  console.log(`✅ JSON 已写入 ${outPath}`)
  console.log()
  console.log('═'.repeat(65))
  console.log('⚠️  PM 操作（S1 核验）：')
  console.log('  1. 检查推荐样本，删除：')
  console.log('     • 非 AU/NZ 原生运营商（如全球大链锁 Intrepid 等）')
  console.log('     • 协会/目录/非营业实体（如 tourismexportcouncil.org.nz）')
  console.log('     • 域名与旅游实际不相关的')
  console.log('  2. 确认最终保留清单（目标 8-12 个），')
  console.log('     回复「清单确认」后进入 S2（collector 逐域名采集）')
  console.log('═'.repeat(65))
}

main().catch(err => {
  console.error('❌ 脚本失败:', err.message ?? err)
  process.exit(1)
})
