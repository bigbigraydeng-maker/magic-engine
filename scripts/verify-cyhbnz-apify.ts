/**
 * 一次性验证脚本：直接调 apify 查 cyhbnz.com 的 Meta 广告 + Google SERP，
 * 跟数据库里张骞落库的数据交叉比对，区分 "客户本身的问题" 和 "数据采集问题"。
 *
 * 用法（项目根）：
 *   npx tsx --env-file=.env.local scripts/verify-cyhbnz-apify.ts
 */

import { scrapeCompetitorMetaAds } from '../src/lib/apify/ad-library'
import { scrapeGoogleSerp } from '../src/lib/apify/google-search-scraper'

const DOMAIN = 'cyhbnz.com'
const BRAND = 'CYHB'
const MARKET_COUNTRY_META = 'NZ'  // cyhbnz Newmarket Auckland
const SERP_QUERIES: Array<{ q: string; cc: 'au' | 'nz' }> = [
  { q: 'luxury dresses Auckland', cc: 'nz' },
  { q: 'designer dresses Newmarket', cc: 'nz' },
  { q: 'CYHB Newmarket', cc: 'nz' },
]

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    console.log(`\n▶ ${label}…`)
    const t0 = Date.now()
    const out = await fn()
    console.log(`✓ ${label} (${Date.now() - t0}ms)`)
    return out
  } catch (e) {
    console.error(`✗ ${label} FAILED:`, e instanceof Error ? e.message : e)
    return null
  }
}

async function main() {
  console.log(`# 验证 ${DOMAIN} 在 Meta Ad Library / Google SERP 的真实存在性\n`)

  // ── 1. Meta Ad Library ────────────────────────────────────────────────
  // 试多个关键词，避免漏抓
  const metaQueries = [BRAND, DOMAIN, 'CYHBNZ']
  for (const q of metaQueries) {
    const data = await safe(`Meta Ad Library: q="${q}" country=${MARKET_COUNTRY_META}`, () =>
      scrapeCompetitorMetaAds(q, MARKET_COUNTRY_META),
    )
    if (data) {
      console.log(JSON.stringify({
        query: q,
        active_ads_count: data.activeAdsCount,
        ad_types: data.adTypes,
        estimated_spend: data.estimatedSpend,
        top_ad_copy: data.topAdCopy,
      }, null, 2))
    }
  }

  // ── 2. Google SERP ────────────────────────────────────────────────────
  for (const { q, cc } of SERP_QUERIES) {
    const data = await safe(`Google SERP: q="${q}" cc=${cc}`, () => scrapeGoogleSerp(q, cc))
    if (data) {
      const cyhbnzInOrganic = data.organic_results.filter(r => r.url.includes('cyhbnz'))
      const cyhbnzInPaid    = data.paid_advertiser_domains.filter(d => d.includes('cyhbnz'))
      const cyhbnzInAi      = data.ai_overview_text?.toLowerCase().includes('cyhb') ?? false

      console.log(JSON.stringify({
        query: q,
        country: cc,
        organic_top5: data.organic_results.slice(0, 5).map(r => ({ pos: r.position, title: r.title.slice(0, 60), domain: new URL(r.url).hostname })),
        paid_advertiser_domains: data.paid_advertiser_domains,
        ai_overview_present: !!data.ai_overview_text,
        cyhbnz_appearance: {
          in_organic: cyhbnzInOrganic.length,
          in_paid: cyhbnzInPaid.length > 0,
          in_ai_overview: cyhbnzInAi,
        },
      }, null, 2))
    }
  }

  console.log('\n=== 验证完成 ===')
}

void main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
