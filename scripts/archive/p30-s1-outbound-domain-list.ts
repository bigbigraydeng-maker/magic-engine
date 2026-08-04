/**
 * P30.0 S1B — Outbound Tour Operator 域名清单抽取（NZ 市场）
 *
 * 细分：outbound_tour_operator = 卖给 Kiwi、带他们去海外旅游的运营商
 * 对标客户：ctstours.co.nz（主做中国线路）
 * 关键词策略：按目的地维度搜，location_code=NZ (2554)
 *
 * 用法：npx tsx scripts/p30-s1-outbound-domain-list.ts
 * 输出：console + scripts/p30-s1-outbound-domains-output.json
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── 关键词组（NZ outbound，按目的地分） ──────────────────────────────────────

// 中国线路（CTS 主战场）
const CHINA_KEYWORDS = [
  'china tours from new zealand',
  'china travel packages nz',
  'china tour nz',
  'tour to china from nz',
  'china holiday packages new zealand',
]

// 亚洲其他目的地（竞品也在这里竞争）
const ASIA_KEYWORDS = [
  'japan tours from new zealand',
  'japan travel packages nz',
  'asia tours new zealand',
  'vietnam tours nz',
  'india tours from new zealand',
]

// 欧洲/全球线路（大型 outbound 运营商也做）
const GLOBAL_KEYWORDS = [
  'europe tours from new zealand',
  'escorted tours from new zealand',
  'overseas tours new zealand',
  'group tours from nz',
]

const ALL_KEYWORDS = [
  ...CHINA_KEYWORDS.map(k => ({ keyword: k, group: 'China' })),
  ...ASIA_KEYWORDS.map(k => ({ keyword: k, group: 'Asia' })),
  ...GLOBAL_KEYWORDS.map(k => ({ keyword: k, group: 'Global' })),
]

const LOCATION_NZ = 2554
const SERP_DEPTH = 20

// 聚合站 + 非运营商黑名单
const BLACKLIST = [
  'tripadvisor.com', 'tripadvisor.co.nz',
  'booking.com', 'expedia.com', 'expedia.co.nz',
  'viator.com', 'getyourguide.com',
  'airbnb.com',
  'lonelyplanet.com', 'roughguides.com',
  'newzealand.com', 'tourism.net.nz',
  'reddit.com', 'facebook.com', 'instagram.com', 'youtube.com',
  'google.com', 'yelp.com', 'trustpilot.com', 'nz.trustpilot.com',
  'productreview.com.au',
  'travelstride.com', 'tourhq.com', 'tourradar.com',
  'helloworld.co.nz',       // 综合代理商
  'flightcentre.co.nz',     // 综合代理商
  'en.wikipedia.org',
  'nomadicmatt.com',        // 博客
  'feefo.com',              // 评价平台
  'rocketreach.co',         // B2B 数据
  'lusha.com',
  'mapquest.com',
  'nz.linkedin.com',
  'ie.maptons.com',
]

// ─── DataForSEO 串行单次调用 ──────────────────────────────────────────────────

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

function getCredentials(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD 未设置')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

interface SerpItem {
  type?: string
  rank_absolute?: number
  domain?: string
}

function normaliseDomain(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, '')
}

function isBlacklisted(domain: string): boolean {
  return BLACKLIST.some(b => domain === b || domain.endsWith(`.${b}`))
}

async function fetchOne(keyword: string, locationCode: number, creds: string): Promise<SerpItem[]> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_code: locationCode, language_code: 'en', depth: SERP_DEPTH }]),
  })
  if (!res.ok) throw new Error(`DataForSEO ${res.status}`)
  const json = await res.json() as { tasks?: Array<{ result?: Array<{ items?: SerpItem[] }> }> }
  return json.tasks?.[0]?.result?.[0]?.items ?? []
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

interface DomainEntry {
  domain: string
  keyword_hits: number
  best_position: number
  keywords_present: string[]
  groups: string[]
}

async function main() {
  const creds = getCredentials()
  const domainMap = new Map<string, DomainEntry>()

  console.log('='.repeat(65))
  console.log('P30.0 S1B — Outbound Tour Operator 域名清单（NZ 市场）')
  console.log(`关键词：${ALL_KEYWORDS.length} 个  SERP 深度：${SERP_DEPTH}  地区：NZ`)
  console.log('='.repeat(65))
  console.log()

  let currentGroup = ''
  for (const { keyword, group } of ALL_KEYWORDS) {
    if (group !== currentGroup) {
      console.log(`\n▶ ${group} 线路关键词组…`)
      currentGroup = group
    }
    process.stdout.write(`  ${keyword} …`)

    try {
      const items = await fetchOne(keyword, LOCATION_NZ, creds)
      const organic = items.filter(i => i.type === 'organic')
      console.log(` ${organic.length} organic`)

      for (const item of organic) {
        const domain = normaliseDomain(item.domain ?? '')
        if (!domain || isBlacklisted(domain)) continue

        const pos = item.rank_absolute ?? 999
        if (!domainMap.has(domain)) {
          domainMap.set(domain, { domain, keyword_hits: 0, best_position: pos, keywords_present: [], groups: [] })
        }
        const e = domainMap.get(domain)!
        e.keyword_hits += 1
        e.keywords_present.push(`[${group}] ${keyword}`)
        if (pos < e.best_position) e.best_position = pos
        if (!e.groups.includes(group)) e.groups.push(group)
      }
    } catch (err: any) {
      console.log(` ❌ ${err.message}`)
    }

    await new Promise(r => setTimeout(r, 800))
  }

  const sorted = [...domainMap.values()].sort((a, b) => {
    if (b.keyword_hits !== a.keyword_hits) return b.keyword_hits - a.keyword_hits
    return a.best_position - b.best_position
  })

  // ─── 人读输出 ──────────────────────────────────────────────────────────────
  console.log()
  console.log('='.repeat(65))
  console.log(`候选域名清单（共 ${sorted.length} 个，已过滤聚合站）`)
  console.log('='.repeat(65))
  console.log(`${'#'.padEnd(4)} ${'域名'.padEnd(40)} ${'线路'.padEnd(20)} ${'命中词'.padEnd(8)} 最佳排名`)
  console.log('-'.repeat(80))
  sorted.forEach((e, i) => {
    console.log(
      `${String(i + 1).padEnd(4)} ${e.domain.padEnd(40)} ${e.groups.join('/').padEnd(20)} ${String(e.keyword_hits).padEnd(8)} ${e.best_position}`
    )
  })

  const recommended = sorted.slice(0, 15)
  console.log()
  console.log('='.repeat(65))
  console.log('推荐样本（前 15，供 PM 核验）')
  console.log('注：CTS 客户域名 ctstours.co.nz 会手工加入，不依赖 SERP 排名')
  console.log('='.repeat(65))
  recommended.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.domain}  [${e.groups.join('/')}]  命中 ${e.keyword_hits} 词，最佳第 ${e.best_position} 名`)
  })

  // 检查 CTS 和 Wendy Wu 是否出现在结果里
  console.log()
  console.log('='.repeat(65))
  console.log('CTS / Wendy Wu 专项检查：')
  const watchList = ['ctstours.co.nz', 'wendywutours.co.nz', 'wendywutours.com.au']
  for (const d of watchList) {
    const entry = domainMap.get(d)
    if (entry) {
      console.log(`  ✅ ${d} — 命中 ${entry.keyword_hits} 词，最佳第 ${entry.best_position} 名`)
      entry.keywords_present.forEach(k => console.log(`      ${k}`))
    } else {
      console.log(`  ❌ ${d} — 未出现在任何关键词的 top ${SERP_DEPTH} 结果里`)
    }
  }

  // ─── JSON 输出 ────────────────────────────────────────────────────────────
  const output = {
    generated_at: new Date().toISOString(),
    industry: 'outbound_tour_operator',
    sub_industry_note: '卖给 NZ 本地人、目的地为海外的 tour operator（对标 CTS Tours）',
    market: 'NZ',
    keyword_groups: { China: CHINA_KEYWORDS, Asia: ASIA_KEYWORDS, Global: GLOBAL_KEYWORDS },
    serp_depth: SERP_DEPTH,
    total_candidates: sorted.length,
    recommended_sample: recommended,
    watch_list_found: watchList.filter(d => domainMap.has(d)),
    all_candidates: sorted,
  }

  const outPath = path.join(__dirname, 'p30-s1-outbound-domains-output.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')

  console.log()
  console.log(`✅ JSON 已写入 ${outPath}`)
  console.log()
  console.log('═'.repeat(65))
  console.log('⚠️  PM 操作（S1B 核验）：')
  console.log('  1. 检查推荐样本，删除非 NZ outbound 运营商')
  console.log('  2. ctstours.co.nz 手工加入（客户域名，必选）')
  console.log('  3. 确认最终清单（目标 8-10 个），回复「outbound 确认」')
  console.log('     → 进入 S2：两个细分各跑 SeoCollector，得到行业基准分')
  console.log('═'.repeat(65))
}

main().catch(err => {
  console.error('❌ 脚本失败:', err.message ?? err)
  process.exit(1)
})
