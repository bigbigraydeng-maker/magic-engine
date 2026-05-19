/**
 * 张骞 Advanced Discovery — targeted enrichment pass after connector authorisation.
 *
 * Reference: ROADMAP.md P8.10.S0.22 + P8.10.S0.23
 *
 * Each connector trigger runs only the scrapers relevant to that data source:
 *   meta-ads / gbp → Meta Ad Library + Facebook page metrics
 *   gsc            → Google Search Console Search Analytics (OAuth per-client)
 *   google-ads     → Google Ads Transparency Center (Apify, public data)
 *
 * Returns an AdvancedDiscoveryPayload merged into
 * client_discovery.payload.advanced without overwriting the basic report.
 */

import { scrapeCompetitorMetaAds } from '@/lib/apify/ad-library'
import { scrapeFacebookPage } from '@/lib/apify/social-scraper'
import { scrapeGoogleAdsTransparency } from '@/lib/apify/google-ads-transparency'
import { fetchGscSearchPerformance } from '@/lib/gsc/client'
import type {
  AdvancedDiscoveryPayload,
  AdvancedFacebookProfile,
  DiscoveredMetaAds,
  DiscoveredGoogleAdsData,
  GscSearchData,
  DiscoveryReport,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

// Each Apify scrape is external — cap them individually so a hung connection
// can't block the job past the 6-min stale threshold.
const META_ADS_TIMEOUT_MS = 90_000
const FACEBOOK_SCRAPE_TIMEOUT_MS = 90_000
const GOOGLE_ADS_TIMEOUT_MS = 90_000

// Cap FB page scrapes per run: each is a paid Apify call and the first-time
// pass typically finds at most one FB page for an AU/NZ SMB.
const MAX_FB_PROFILES = 2

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the advanced enrichment pass for a client's domain.
 *
 * Each connector trigger runs only the scrapers relevant to that data source:
 *   meta-ads / gbp → Meta Ad Library + Facebook page metrics
 *   gsc            → Google Search Console Search Analytics
 *   google-ads     → Google Ads Transparency Center (Apify, public)
 *
 * @param domain        The client's primary domain.
 * @param basicReport   The existing basic DiscoveryReport (to find FB profile URLs).
 * @param triggeredBy   Connector anchor that triggered this run.
 * @param onProgress    Optional callback for progress UI updates.
 * @param siteUrl       GSC property URL (required when triggeredBy === 'gsc').
 */
export async function runZhangqianAdvanced(
  domain: string,
  basicReport: DiscoveryReport,
  triggeredBy: string,
  onProgress?: (note: string) => void | Promise<void>,
  siteUrl?: string,
  clientId?: string,
): Promise<AdvancedDiscoveryPayload> {
  const startedAt = Date.now()
  const notify = onProgress ?? (() => undefined)

  let meta_ads: DiscoveredMetaAds | null = null
  let facebook_profiles: AdvancedFacebookProfile[] = []
  let gsc_data: GscSearchData | null = null
  let google_ads_data: DiscoveredGoogleAdsData | null = null

  if (triggeredBy === 'gsc') {
    // ── GSC: fetch real search performance data ────────────────────────────
    const effectiveSiteUrl = siteUrl ?? `https://${domain}/`
    await notify(`高级发现：正在从 Google Search Console 拉取搜索数据（${effectiveSiteUrl}）…`)
    gsc_data = await fetchGscSearchPerformance(effectiveSiteUrl, clientId)
    if (gsc_data) {
      await notify(`高级发现：GSC 数据已获取（${gsc_data.rows.length} 条关键词，过去 ${gsc_data.date_range_days} 天）`)
    } else {
      await notify('高级发现：GSC 数据拉取失败（请检查 Google 授权），继续…')
    }
  } else if (triggeredBy === 'google-ads') {
    // ── Google Ads Transparency: public Apify scrape ───────────────────────
    await notify(`高级发现：正在扫描 Google 广告透明度中心（${domain}）…`)
    google_ads_data = await scrapeGoogleAdsWithTimeout(domain, notify)
  } else {
    // ── meta-ads / gbp: Meta Ad Library + Facebook page metrics ──────────
    await notify('高级发现：正在扫描 Meta 广告库…')
    meta_ads = await scrapeMetaAdsWithTimeout(domain, notify)

    const fbUrls = basicReport.social_profiles
      .filter(p => p.platform === 'facebook' && p.url)
      .slice(0, MAX_FB_PROFILES)
      .map(p => p.url)

    facebook_profiles = await scrapeFacebookProfilesWithTimeout(fbUrls, notify)
  }

  return {
    meta_ads,
    facebook_profiles,
    gsc_data,
    google_ads_data,
    meta: {
      duration_ms: Date.now() - startedAt,
      cost_usd: 0,   // Apify costs tracked externally; no Claude usage here
      ran_at: new Date().toISOString(),
      triggered_by: triggeredBy,
    },
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function scrapeMetaAdsWithTimeout(
  domain: string,
  notify: (note: string) => void | Promise<void>,
): Promise<DiscoveredMetaAds | null> {
  try {
    const result = await withTimeout(
      scrapeCompetitorMetaAds(domain),
      META_ADS_TIMEOUT_MS,
      'Meta Ad Library timeout',
    )
    const meta_ads: DiscoveredMetaAds = {
      active_ads_count: result.activeAdsCount,
      ad_types: result.adTypes,
      estimated_spend: result.estimatedSpend,
      top_ad_copy: result.topAdCopy,
    }
    await notify(`高级发现：Meta 广告库扫描完成（${result.activeAdsCount} 条活跃广告）`)
    return meta_ads
  } catch (err) {
    console.warn('[advanced-agent] Meta ads scrape failed:', err instanceof Error ? err.message : err)
    await notify('高级发现：Meta 广告库扫描失败，继续…')
    return null
  }
}

async function scrapeFacebookProfilesWithTimeout(
  urls: string[],
  notify: (note: string) => void | Promise<void>,
): Promise<AdvancedFacebookProfile[]> {
  const results: AdvancedFacebookProfile[] = []

  for (const url of urls) {
    await notify(`高级发现：正在抓取 Facebook 主页 ${url}…`)
    try {
      const raw = await withTimeout(
        scrapeFacebookPage(url),
        FACEBOOK_SCRAPE_TIMEOUT_MS,
        `Facebook page timeout: ${url}`,
      )
      results.push({
        url,
        page_name: raw.pageName,
        followers_count: raw.followersCount,
        posts_last_30d: raw.postsLast30Days,
        engagement_rate: raw.engagementRate,
      })
      await notify(`高级发现：Facebook 主页「${raw.pageName}」数据已获取（${raw.followersCount.toLocaleString()} 粉丝）`)
    } catch (err) {
      console.warn(`[advanced-agent] FB scrape failed for ${url}:`, err instanceof Error ? err.message : err)
      await notify(`高级发现：Facebook 主页抓取失败（${url}），继续…`)
    }
  }

  return results
}

async function scrapeGoogleAdsWithTimeout(
  domain: string,
  notify: (note: string) => void | Promise<void>,
): Promise<DiscoveredGoogleAdsData | null> {
  try {
    const raw = await withTimeout(
      scrapeGoogleAdsTransparency(domain),
      GOOGLE_ADS_TIMEOUT_MS,
      'Google Ads Transparency timeout',
    )
    const result: DiscoveredGoogleAdsData = {
      advertiser:       raw.advertiser,
      active_ads_count: raw.activeAdsCount,
      ad_formats:       raw.adFormats,
      regions:          raw.regions,
      top_ad_previews:  raw.topAdPreviews,
    }
    await notify(`高级发现：Google 广告透明度扫描完成（${raw.activeAdsCount} 条活跃广告）`)
    return result
  } catch (err) {
    console.warn('[advanced-agent] Google Ads scrape failed:', err instanceof Error ? err.message : err)
    await notify('高级发现：Google 广告透明度扫描失败，继续…')
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(label)), ms),
    ),
  ])
}
