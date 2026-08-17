/**
 * 澳新需求验证 —— 复用 ME 已有的 DataForSEO 账号，**零新增 provider、零新增钥匙**。
 *
 * 一个接口同时给「月搜索量 + 12 个月历史 + CPC + 竞争度」，所以趋势也在这里算，
 * 不引 SerpAPI / Google Trends。见 lib/dataforseo/search-volume.ts 的说明。
 *
 * 🔴 **需求信号是品类级，不是单品级。** 这里量的是「找到这个商品的那个搜索词」在
 *    澳新的热度，不是这件商品本身。TikTok 的标题是堆砌关键词的长串
 *    （"Purple-33oz Cordless Portable Blender, USB Rechargeable…"），拿它去查搜索量
 *    只会得到 0，而 0 会被误读成「没需求」。所以一律用种子词。
 *    调用方展示时必须说清楚这一点 —— 见 scripts/commerce-poc.ts 的输出。
 */

import { locationCodeFor } from '@/lib/dataforseo/client'
import { deriveTrajectory, getSearchVolume } from '@/lib/dataforseo/search-volume'
import type { MarketDemand, Measured, TargetMarket } from './types'

function measuredNumber(
  value: number | null,
  source: string,
  collectedAt: string,
): Measured<number> {
  return { value, provenance: 'observed', source, collectedAt }
}

/** 单个市场取不到数据时的空壳 —— 四项全 null，闸门会据此判 UNKNOWN。 */
function emptyDemand(
  market: TargetMarket,
  source: string,
  collectedAt: string,
): MarketDemand {
  return {
    market,
    monthlySearches: measuredNumber(null, source, collectedAt),
    cpcUsd: measuredNumber(null, source, collectedAt),
    competition: measuredNumber(null, source, collectedAt),
    trajectory: { value: null, provenance: 'observed', source, collectedAt },
  }
}

/**
 * 量一个品类词在单个市场的需求。
 *
 * 失败不抛错 —— 回全 null 的空壳。**空壳 ≠ 没需求**，闸门判 UNKNOWN 而不是 FAIL。
 */
export async function measureMarketDemand(
  seedKeyword: string,
  market: TargetMarket,
): Promise<MarketDemand> {
  const collectedAt = new Date().toISOString()
  const source = `DataForSEO google_ads search_volume · ${market} · "${seedKeyword}"`

  try {
    const [result] = await getSearchVolume(
      [seedKeyword], locationCodeFor(market.toLowerCase()),
    )
    if (!result) return emptyDemand(market, source, collectedAt)

    return {
      market,
      monthlySearches: measuredNumber(result.searchVolume, source, collectedAt),
      cpcUsd: measuredNumber(result.cpcUsd, source, collectedAt),
      competition: measuredNumber(result.competition, source, collectedAt),
      trajectory: {
        // 由历史点算出来的，不是接口直接给的 —— 所以是 derived 不是 observed。
        value: deriveTrajectory(result.monthlySearches),
        provenance: 'derived',
        source: `${source} · 近 3 月 vs 前 3 月`,
        collectedAt,
      },
    }
  } catch (err) {
    console.error(`[product-intel] ${market} 需求取数失败：`,
      err instanceof Error ? err.message : String(err))
    return emptyDemand(market, source, collectedAt)
  }
}

/** 同时量 AU 和 NZ。两个市场互不阻断。 */
export async function measureAuNzDemand(
  seedKeyword: string,
): Promise<readonly MarketDemand[]> {
  const markets: readonly TargetMarket[] = ['AU', 'NZ']
  return Promise.all(markets.map((m) => measureMarketDemand(seedKeyword, m)))
}
