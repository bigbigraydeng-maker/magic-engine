/**
 * TikTok Shop 采集 wrapper —— Commerce Product Intelligence 的发现层入口。
 *
 * Actor: unseenuser/TikTok-Shop-Scraper（2026-08-15 实测：US 区 20/20 条回值，
 * soldCount 为精确整数 1–50,287，price/originalPrice/discountPercent/rating 齐全）。
 *
 * 🔴 **TikTok Shop 没有 AU / NZ 区**（2026-08-15 实测 actor 的 region 枚举只有
 *    US/GB/ID/MY/PH/SG/VN/TH/DE/FR/IT/ES/IE/MX/BR/JP）。这不是缺陷，是这条产品线
 *    成立的前提：美国信号 = 已被真实消费者验证；澳新需求得另外去 Google 侧量。
 *    别为了「拿澳新数据」往这里传 AU/NZ —— actor 会返回空，而空会被误读成「没需求」。
 *
 * 这一层只负责「把 raw 拿回来」，不做任何字段语义判断 —— 归一化在
 * lib/commerce/product-intel/normalize.ts，业务逻辑一行都不许看见下面这些字段名。
 */

import { runActorAndGetResults } from './client'

const TIKTOK_SHOP_ACTOR = 'unseenuser/TikTok-Shop-Scraper'

/** actor 支持的 TikTok Shop 站点。**不含 AU / NZ —— TikTok Shop 未在两地开通。** */
export type TikTokShopRegion =
  | 'US' | 'GB' | 'ID' | 'MY' | 'PH' | 'SG' | 'VN'
  | 'TH' | 'DE' | 'FR' | 'IT' | 'ES' | 'IE' | 'MX' | 'BR' | 'JP'

/**
 * actor 回的一行原始商品。字段名照抄 actor 输出，**不改名不加工**。
 * 可选性按 2026-08-15 实测填充率标注：rating / originalPrice / discountPercent
 * 在 20 条样本里分别缺 1 / 13 / 13 条，所以一律 optional。
 */
export interface RawTikTokShopProduct {
  productId: string
  productUrl: string
  title: string
  shopName?: string
  /** 当前售价（数值，币种见 currency） */
  price?: number
  currency?: string
  /** 划线原价 —— 只有在打折时才有 */
  originalPrice?: number
  /** 形如 "52%" 的字符串，不是数字 */
  discountPercent?: string
  /** 累计已售件数（精确整数）。**不是近 30 天** —— actor 不提供任何时间窗切分。 */
  soldCount?: number
  rating?: number
  primaryImage?: string
  region?: string
  scrapedAt?: string
}

export interface TikTokShopSearchParams {
  keywords: string[]
  region?: TikTokShopRegion
  /** 每个关键词最多取几条。0 = 不设上限（会很贵，别在 POC 里用）。 */
  maxResultsPerKeyword?: number
}

export interface TikTokShopSearchResult {
  products: RawTikTokShopProduct[]
  /** Apify run id —— Product Candidate 的 raw source 指针就是它。 */
  runId: string | null
  /** 失败原因。非 null 时 products 必为空 —— 调用方必须区分「没搜到」和「没搜成」。 */
  error?: string
}

/**
 * 按关键词搜 TikTok Shop。
 *
 * 失败不抛错，回 `{ products: [], error }` —— 调用方必须自己判 error，
 * 「空数组」在这里**不等于**「这个词没有商品」。
 */
export async function searchTikTokShop(
  params: TikTokShopSearchParams,
): Promise<TikTokShopSearchResult> {
  const { keywords, region = 'US', maxResultsPerKeyword = 20 } = params
  if (keywords.length === 0) return { products: [], runId: null }

  const result = await runActorAndGetResults<RawTikTokShopProduct>(
    TIKTOK_SHOP_ACTOR,
    {
      mode: 'shop_search',
      searchKeywords: keywords,
      region,
      maxResults: maxResultsPerKeyword,
    },
  )

  if (!result.success) {
    return { products: [], runId: result.runId, error: result.error }
  }
  return { products: result.data, runId: result.runId }
}
