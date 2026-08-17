/**
 * 以图搜款 —— 拿一张商品图，回中国供货端的同款/近似款工厂报价。
 *
 * Actor: dev00/alibaba-1688-aliexpress-reverse-image-search-api
 *
 * 🔴 **`destination: '1688'` 是坏的**（2026-08-15 实测：拿 1688 自己的商品图当对照
 *    也回 `{success:true, totalCount:0}`，所以不是「没匹配上」，是通道本身不通）。
 *    `alibaba` 通道同一张图回 100 条。**默认走 alibaba，别改回 1688。**
 *    真要国内批发价，用 devcake/scraper-by-image 的 1688 provider（另一个 actor）。
 *
 * 🔴 反向搜图回的是**近似款**，不是同一件商品。这里不做任何「就是这个」的断言 ——
 *    调用方拿到的是「这个款式在中国的供货价格带」，不是「这件商品的成本」。
 *    normalize 层据此把它标成 derived 而非 observed。
 */

import { runActorAndGetResults } from './client'

const REVERSE_IMAGE_ACTOR = 'dev00/alibaba-1688-aliexpress-reverse-image-search-api'

/** 供货目录。`'1688'` 保留在类型里只为说明它存在 —— 见文件头，它现在返回空。 */
export type SourcingCatalog = 'alibaba' | 'aliexpress' | 'global' | '1688'

/** actor 回的一行原始供货记录。字段名照抄 actor 输出。 */
export interface RawSourcingMatch {
  productId?: string
  title?: string
  /** 报价数值，币种见 currency */
  price?: number
  currency?: string
  /** 起订量 —— actor 回的是字符串，如 "2" */
  minOrderQty?: string
  supplierName?: string
  /** 国别码，如 "CN" */
  location?: string
  productUrl?: string
  imageUrl?: string
}

export interface SourcingSearchResult {
  matches: RawSourcingMatch[]
  runId: string | null
  error?: string
}

/**
 * 用一张图找中国供货端的近似款。
 *
 * 失败不抛错。空 matches 有两种来路 —— 有 error 是没搜成，无 error 是真没匹配上。
 */
export async function findSourcingByImage(
  imageUrl: string,
  catalog: SourcingCatalog = 'alibaba',
): Promise<SourcingSearchResult> {
  if (!imageUrl) return { matches: [], runId: null, error: 'empty imageUrl' }

  const result = await runActorAndGetResults<RawSourcingMatch>(
    REVERSE_IMAGE_ACTOR,
    { imageUrl, destination: catalog, currency: 'USD', language: 'en' },
  )

  if (!result.success) {
    return { matches: [], runId: result.runId, error: result.error }
  }
  return { matches: result.data, runId: result.runId }
}
