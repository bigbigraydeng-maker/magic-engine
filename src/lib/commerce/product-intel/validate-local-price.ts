/**
 * 本地售价取数 —— IO 层。纯逻辑在 local-price.ts，这里只负责调接口 + 交给它。
 * （与 validate-aunz.ts 同一套分工：IO 一个文件，判断一个文件。）
 *
 * 🔴 **用种子词查，不用商品标题查** —— 跟澳新搜索量同一个坑。TikTok 标题是
 *    "Purple-33oz Cordless Portable Blender, USB Rechargeable…" 这种关键词堆砌，
 *    拿它去查 Google 只会回空块，而空块会被误读成"新西兰没人卖"。
 *
 * 🔴 产出的是**品类价格带**，不是这件商品的售价。展示时必须说明。
 */

import { getPopularProducts } from '@/lib/dataforseo/popular-products'
import type { PopularProduct } from '@/lib/dataforseo/popular-products'
import { normalizeLocalMarket } from './local-price'
import type { LocalListing } from './local-price'
import type { LocalMarketEvidence, TargetMarket } from './types'

const MARKET_TO_COUNTRY: Record<TargetMarket, 'au' | 'nz'> = { AU: 'au', NZ: 'nz' }

function toListing(product: PopularProduct): LocalListing {
  return {
    title: product.title,
    price: product.price,
    currency: product.currency,
    seller: product.seller,
    // 商品块不给落地页链接（实采 url 恒为 null）——不编一个出来。
    url: null,
  }
}

/**
 * 量一个品类词在目标市场的本地零售价带。
 *
 * 失败或块太薄都不抛错 —— 回一个 `medianPriceNzd.value === null` 的证据对象，
 * 毛利闸据此退回粗筛判 UNKNOWN。**取不到 ≠ 卖不动。**
 */
export async function measureLocalPrice(
  seedKeyword: string,
  market: TargetMarket = 'NZ',
): Promise<LocalMarketEvidence> {
  const collectedAt = new Date().toISOString()
  const source = `Google 商品块 · ${market} · "${seedKeyword}"`

  const result = await getPopularProducts(seedKeyword, MARKET_TO_COUNTRY[market])
  if (result.error) {
    console.error(`[product-intel] ${market} 本地售价取数失败：${result.error}`)
    return normalizeLocalMarket([], market, `${source} · 取数失败`, collectedAt)
  }
  return normalizeLocalMarket(
    result.products.map(toListing),
    market,
    source,
    collectedAt,
  )
}
