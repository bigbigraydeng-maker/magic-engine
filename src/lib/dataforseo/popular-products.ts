/**
 * Google 「热门商品」块 —— 目标市场本地零售商的实际标价。
 *
 * 端点跟 serp.ts 是同一个（`/serp/google/organic/live/advanced`），**但不复用
 * `getSerpPage`**：那个函数的返回类型 `DfseSerpResult` 是照张骞发现模块的
 * `DiscoveredSerpResult` 定死的，把商品块塞进去等于改一个已上线模块的契约。
 * 这里只多读一种块、只产出价格，互不影响。**别"顺手"把两个合并。**
 *
 * 🔴 **Google 购物专用端点走不通**：2026-08-16 实测
 *    `/serp/google/shopping/live/advanced` 回 `40402 Invalid Path`（我们账号没有）。
 *    自然结果里的 `popular_products` 块是目前唯一拿得到本地多商家价格的路，
 *    单次约 US$0.0035。**别改回 shopping 端点。**
 *
 * 🔴 **块的厚度极不稳定**：实测同一天 NZ 市场，车载胎压泵回 5 个块约 48 条，
 *    便携榨汁杯只回 1 个块 5 条。调用方必须自己扛"太薄不给结论"，
 *    见 commerce/product-intel/local-price.ts 的商家数门槛。
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

/** AU=2036, NZ=2554 —— 与 dataforseo/client.ts 的 locationCodeFor 同源。 */
const LOCATION_CODE: Record<'au' | 'nz', number> = { au: 2036, nz: 2554 }
const SE_DOMAIN: Record<'au' | 'nz', string> = {
  au: 'google.com.au',
  nz: 'google.co.nz',
}

/**
 * 商品块里的一条。字段名照抄 DataForSEO 真实响应
 * （2026-08-16 实采，见 `product_identifiers` 那一组）。
 */
interface RawPopularProductElement {
  type?: string
  title?: string
  /** 🔴 实采里恒为 null —— 商品块不给落地页链接，别指望能点进去。 */
  url?: string | null
  domain?: string | null
  seller?: string | null
  /** "JB Hi-Fi & more" —— more_sellers 为 true 时这条其实有多个卖家。 */
  description?: string | null
  more_sellers?: boolean
  price?: {
    /** 当前售价（折后）。 */
    current?: number | null
    /** 原价。current 明显低于 regular 时说明在打折。 */
    regular?: number | null
    /** is_price_range 为 true 时的区间上限。 */
    max_value?: number | null
    currency?: string | null
    is_price_range?: boolean
  } | null
}

/** 归一后的一条商品块记录。 */
export interface PopularProduct {
  readonly title: string
  /** 消费者实际要付的标价（含 GST）。区间价取中点。 */
  readonly price: number
  readonly currency: string
  readonly seller: string | null
  /** 原价 —— 为 null 表示没在打折或拿不到。 */
  readonly regularPrice: number | null
  /** 这一条背后是否还有别的卖家（Google 折叠了）。 */
  readonly hasMoreSellers: boolean
}

export interface PopularProductsResult {
  readonly products: readonly PopularProduct[]
  /** 本次调用花了多少（USD）—— 花钱的路径必须能对账。 */
  readonly costUsd: number
  /** 失败原因。**空 products + 无 error = 真的没有商品块**，两种"空"不能混。 */
  readonly error?: string
}

function authHeader(): string {
  const login = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

function finite(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : null
}

/**
 * 解出一条的实际标价。
 *
 * 区间价（`is_price_range`）的 `current` 是**下限**，直接用会系统性低估中位价：
 * 有上限就取中点，没上限就判定为拿不到（返回 null，整条丢弃）。
 */
function resolvePrice(price: RawPopularProductElement['price']): number | null {
  const current = finite(price?.current)
  if (current === null) return null
  if (price?.is_price_range !== true) return current
  const max = finite(price?.max_value)
  return max === null ? null : (current + max) / 2
}

/** 从整份 SERP 响应里挑出所有商品块的条目。 */
export function parsePopularProducts(json: unknown): readonly PopularProduct[] {
  const items = (json as {
    tasks?: Array<{ result?: Array<{ items?: Array<{
      type?: string
      items?: RawPopularProductElement[]
    }> }> }>
  })?.tasks?.[0]?.result?.[0]?.items ?? []

  const out: PopularProduct[] = []
  for (const block of items) {
    if (block?.type !== 'popular_products') continue
    for (const el of block.items ?? []) {
      const price = resolvePrice(el.price)
      const currency = el.price?.currency
      if (price === null || !currency || !el.title) continue
      out.push({
        title: el.title,
        price,
        currency,
        seller: el.seller ?? null,
        regularPrice: finite(el.price?.regular),
        hasMoreSellers: el.more_sellers === true,
      })
    }
  }
  return out
}

/**
 * 取一个搜索词在目标市场的商品块价格。
 *
 * 失败不抛错 —— 回空 products + error，让上层判 UNKNOWN 而不是崩掉整批。
 */
export async function getPopularProducts(
  keyword: string,
  countryCode: 'au' | 'nz' = 'nz',
): Promise<PopularProductsResult> {
  if (!keyword.trim()) return { products: [], costUsd: 0, error: 'empty keyword' }

  try {
    const res = await fetch(
      `${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`,
      {
        method: 'POST',
        headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify([{
          keyword,
          location_code: LOCATION_CODE[countryCode],
          language_code: 'en',
          se_domain: SE_DOMAIN[countryCode],
          depth: 20,
        }]),
      },
    )
    if (!res.ok) {
      return { products: [], costUsd: 0, error: `DataForSEO SERP error: ${res.status}` }
    }

    const json = await res.json() as { cost?: number; tasks?: Array<{
      status_code?: number
      status_message?: string
    }> }
    const task = json.tasks?.[0]
    // 20000 = 成功。其它码（如 40402 Invalid Path）HTTP 也是 200，必须单独判。
    if (task?.status_code !== 20000) {
      return {
        products: [],
        costUsd: json.cost ?? 0,
        error: `DataForSEO task ${task?.status_code}: ${task?.status_message ?? 'unknown'}`,
      }
    }
    return { products: parsePopularProducts(json), costUsd: json.cost ?? 0 }
  } catch (err) {
    return {
      products: [],
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
