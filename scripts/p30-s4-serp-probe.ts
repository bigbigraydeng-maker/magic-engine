/**
 * P30 S4 — 城市级 SERP 域名抽取通用脚本
 *
 * 用法：
 *   CITY=auckland INDUSTRY=real_estate npx tsx scripts/p30-s4-serp-probe.ts
 *   CITY=brisbane INDUSTRY=flooring_tiles npx tsx scripts/p30-s4-serp-probe.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── 关键词模板 ────────────────────────────────────────────────────────────────

const KEYWORD_TEMPLATES: Record<string, (city: string) => string[]> = {
  real_estate: (city) => [
    `real estate agent ${city}`,
    `${city} property for sale`,
    `${city} homes for sale`,
    `${city} real estate agency`,
    `buy house ${city}`,
    `property management ${city}`,
    `houses for sale ${city}`,
    `${city} apartments for sale`,
    `investment property ${city}`,
    `${city} real estate listings`,
  ],
  flooring_tiles: (city) => [
    `flooring ${city}`,
    `tiles ${city}`,
    `timber flooring ${city}`,
    `tile shop ${city}`,
    `flooring store ${city}`,
    `vinyl flooring ${city}`,
    `floor tiles ${city}`,
    `carpet ${city}`,
    `flooring installation ${city}`,
    `tile supplier ${city}`,
  ],
  logistics_3pl: (_city) => [
    'nz fulfillment center',
    'new zealand 3pl ecommerce',
    'ecommerce fulfillment new zealand',
    'nz warehousing fulfillment',
    'third party logistics new zealand',
    'new zealand order fulfillment',
    'nz 3pl provider',
    'ecommerce warehouse nz',
  ],
}

// ─── 聚合站黑名单 ──────────────────────────────────────────────────────────────

const BLACKLIST_BY_INDUSTRY: Record<string, string[]> = {
  real_estate: [
    'trademe.co.nz', 'realestate.co.nz', 'homes.co.nz', 'oneroof.co.nz',
    'allhomes.com.au', 'domain.com.au', 'realestate.com.au', 'rent.com.au',
    'zillow.com', 'propertyvalue.co.nz', 'qv.co.nz',
    'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
    'google.com', 'en.wikipedia.org', 'linkedin.com',
    'stuff.co.nz', 'nzherald.co.nz', 'rnz.co.nz',
    'news.com.au', 'realestateinstitute.co.nz', 'reinz.co.nz',
  ],
  flooring_tiles: [
    'bunnings.com.au', 'bunnings.co.nz', 'amazon.com', 'ebay.com.au',
    'ikea.com', 'mitre10.com.au', 'mitre10.co.nz',
    'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
    'google.com', 'en.wikipedia.org', 'houzz.com', 'pinterest.com',
    'gumtree.com.au', 'hipages.com.au', 'serviceseek.com.au',
  ],
  logistics_3pl: [
    'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
    'google.com', 'en.wikipedia.org', 'linkedin.com',
    'stuff.co.nz', 'nzherald.co.nz',
  ],
}

// ─── location_code ────────────────────────────────────────────────────────────

const LOCATION_BY_CITY: Record<string, number> = {
  // NZ cities → NZ location
  auckland: 2554, wellington: 2554, christchurch: 2554,
  // AU cities → AU location
  sydney: 2036, melbourne: 2036, brisbane: 2036, perth: 2036, adelaide: 2036,
  // NZ national
  nz: 2554,
  // AU national
  au: 2036,
}

// ─── DataForSEO ───────────────────────────────────────────────────────────────

function getCredentials(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

function normaliseDomain(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, '')
}

function isBlacklisted(domain: string, industry: string): boolean {
  const list = BLACKLIST_BY_INDUSTRY[industry] ?? []
  return list.some(b => domain === b || domain.endsWith(`.${b}`))
}

interface DomainEntry {
  domain: string
  keyword_hits: number
  best_position: number
  keywords_present: string[]
}

async function fetchSerp(keyword: string, locationCode: number, creds: string): Promise<Array<{ domain: string; position: number }>> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_code: locationCode, language_code: 'en', depth: 20 }]),
  })
  if (!res.ok) throw new Error(`DataForSEO ${res.status}`)
  const json = await res.json() as { tasks?: Array<{ result?: Array<{ items?: Array<{ type?: string; rank_absolute?: number; domain?: string }> }> }> }
  const items = json.tasks?.[0]?.result?.[0]?.items ?? []
  return items
    .filter(i => i.type === 'organic' && i.domain)
    .map(i => ({ domain: normaliseDomain(i.domain!), position: i.rank_absolute ?? 999 }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const city = (process.env.CITY ?? '').toLowerCase()
  const industry = (process.env.INDUSTRY ?? '').toLowerCase()

  if (!city || !industry) {
    console.error('Usage: CITY=auckland INDUSTRY=real_estate npx tsx scripts/p30-s4-serp-probe.ts')
    process.exit(1)
  }

  const kwTemplate = KEYWORD_TEMPLATES[industry]
  if (!kwTemplate) {
    console.error(`Unknown industry: ${industry}. Available: ${Object.keys(KEYWORD_TEMPLATES).join(', ')}`)
    process.exit(1)
  }

  const locationCode = LOCATION_BY_CITY[city]
  if (!locationCode) {
    console.error(`Unknown city: ${city}. Available: ${Object.keys(LOCATION_BY_CITY).join(', ')}`)
    process.exit(1)
  }

  const keywords = kwTemplate(city)
  const creds = getCredentials()
  const domainMap = new Map<string, DomainEntry>()

  console.log('='.repeat(60))
  console.log(`P30 S4 — ${industry} / ${city}`)
  console.log(`关键词：${keywords.length}  location: ${locationCode}`)
  console.log('='.repeat(60))
  console.log()

  for (const keyword of keywords) {
    process.stdout.write(`  ${keyword} …`)
    try {
      const results = await fetchSerp(keyword, locationCode, creds)
      const organic = results.filter(r => !isBlacklisted(r.domain, industry))
      console.log(` ${organic.length} (filtered from ${results.length})`)

      for (const { domain, position } of organic) {
        if (!domain) continue
        if (!domainMap.has(domain)) {
          domainMap.set(domain, { domain, keyword_hits: 0, best_position: position, keywords_present: [] })
        }
        const e = domainMap.get(domain)!
        e.keyword_hits += 1
        e.keywords_present.push(keyword)
        if (position < e.best_position) e.best_position = position
      }
    } catch (err: any) {
      console.log(` ❌ ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 800))
  }

  const sorted = Array.from(domainMap.values()).sort((a, b) => {
    if (b.keyword_hits !== a.keyword_hits) return b.keyword_hits - a.keyword_hits
    return a.best_position - b.best_position
  })

  console.log()
  console.log('='.repeat(60))
  console.log(`候选清单（共 ${sorted.length} 个，已过滤聚合站）`)
  console.log('='.repeat(60))
  console.log(`${'#'.padEnd(4)} ${'域名'.padEnd(40)} ${'命中词'.padEnd(8)} 最佳排名`)
  console.log('-'.repeat(60))
  sorted.slice(0, 20).forEach((e, i) => {
    console.log(`${String(i + 1).padEnd(4)} ${e.domain.padEnd(40)} ${String(e.keyword_hits).padEnd(8)} ${e.best_position}`)
  })

  // Output JSON for PM review
  const output = {
    generated_at: new Date().toISOString(),
    industry,
    city,
    location_code: locationCode,
    keywords_used: keywords,
    total_candidates: sorted.length,
    top20: sorted.slice(0, 20),
    all_candidates: sorted,
  }

  const outFile = `scripts/p30-s4-${industry}-${city}-output.json`
  fs.writeFileSync(path.join(process.cwd(), outFile), JSON.stringify(output, null, 2))

  console.log()
  console.log(`✅ JSON → ${outFile}`)
  console.log()
  console.log('PM 操作：')
  console.log('  检查上方清单，删除非本地原生运营商，回复「确认」后进 S2 采集')
}

main().catch(err => { console.error('❌', err.message); process.exit(1) })
