import { describe, it, expect } from 'vitest'
import { parsePopularProducts } from '../popular-products'

/**
 * 🔴 假件的字段结构是 2026-08-16 从 DataForSEO 真实响应实采下来的
 *    （NZ / "portable blender"），**不是照着解析代码编的**。
 *    自编形状会让「查询写错」这类 bug 测不出来 —— 测试全绿、生产全空。
 */
function realElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'popular_products_element',
    title: 'NutriBullet McLaren Portable Blender',
    url: null,          // 实采恒为 null
    domain: null,       // 实采恒为 null
    description: 'JB Hi-Fi & more',
    more_sellers: true,
    seller: 'JB Hi-Fi',
    image_url: 'https://api.dataforseo.com/cdn/i/08161116-1718-0139-0000-d48501664ebc:0',
    price: {
      current: 58,
      regular: 99,
      max_value: null,
      currency: 'NZD',
      is_price_range: false,
      displayed_price: '$58.00 $99',
    },
    rating: { rating_type: 'Max5', value: 4.2, votes_count: 1800, rating_max: 5 },
    product_identifiers: {
      product_id: '8967718295516597675',
      data_docid: '10636519381673420090',
      gid: '3387538701020223422',
    },
    ...overrides,
  }
}

/** 把若干块包成一份完整响应 —— 嵌套层级照真实响应。 */
function response(blocks: readonly Record<string, unknown>[]): unknown {
  return { tasks: [{ result: [{ items: blocks }] }] }
}

function productsBlock(elements: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'popular_products', rank_group: 1, items: elements }
}

describe('parsePopularProducts', () => {
  it('从真实结构里解出标价、币种、卖家', () => {
    const out = parsePopularProducts(response([productsBlock([realElement()])]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      title: 'NutriBullet McLaren Portable Blender',
      price: 58,
      currency: 'NZD',
      seller: 'JB Hi-Fi',
      regularPrice: 99,
      hasMoreSellers: true,
    })
  })

  it('多个商品块的条目全都收上来（实测一次回 5 个块）', () => {
    const out = parsePopularProducts(response([
      productsBlock([realElement(), realElement({ seller: 'PB Tech' })]),
      productsBlock([realElement({ seller: 'Briscoes' })]),
    ]))
    expect(out).toHaveLength(3)
    expect(out.map((p) => p.seller)).toEqual(['JB Hi-Fi', 'PB Tech', 'Briscoes'])
  })

  it('🔴 非商品块一律不碰 —— organic / people_also_ask 混在同一个 items 里', () => {
    const out = parsePopularProducts(response([
      { type: 'organic', domain: 'www.kmart.co.nz', title: '不是商品块' },
      { type: 'people_also_ask', items: [{ title: '也不是' }] },
      productsBlock([realElement()]),
    ]))
    expect(out).toHaveLength(1)
    expect(out[0].seller).toBe('JB Hi-Fi')
  })

  it('🔴 区间价有上限 → 取中点；没上限 → 整条丢弃，不拿下限冒充', () => {
    const withMax = realElement({
      price: { current: 40, max_value: 60, currency: 'NZD', is_price_range: true },
    })
    const noMax = realElement({
      price: { current: 40, max_value: null, currency: 'NZD', is_price_range: true },
    })
    expect(parsePopularProducts(response([productsBlock([withMax])]))[0].price).toBe(50)
    expect(parsePopularProducts(response([productsBlock([noMax])]))).toHaveLength(0)
  })

  it('🔴 没有价格或没有币种的条目丢弃，不给 0', () => {
    const noPrice = realElement({ price: null })
    const zero = realElement({ price: { current: 0, currency: 'NZD', is_price_range: false } })
    const noCurrency = realElement({
      price: { current: 58, currency: null, is_price_range: false },
    })
    const out = parsePopularProducts(response([
      productsBlock([noPrice, zero, noCurrency]),
    ]))
    expect(out).toHaveLength(0)
  })

  it('币种不是 NZD 也照样解出来 —— 过滤交给上层，这里不偷偷丢', () => {
    const aud = realElement({
      price: { current: 47.45, currency: 'AUD', is_price_range: false },
    })
    const out = parsePopularProducts(response([productsBlock([aud])]))
    expect(out).toHaveLength(1)
    expect(out[0].currency).toBe('AUD')
  })

  it('🔴 响应里根本没有商品块 → 空数组，不抛错', () => {
    expect(parsePopularProducts(response([{ type: 'organic' }]))).toEqual([])
    expect(parsePopularProducts({ tasks: [] })).toEqual([])
    expect(parsePopularProducts(null)).toEqual([])
    expect(parsePopularProducts(undefined)).toEqual([])
  })

  it('regular 缺失时 regularPrice 为 null，不回落成 current', () => {
    const noRegular = realElement({
      price: { current: 58, regular: null, currency: 'NZD', is_price_range: false },
    })
    expect(parsePopularProducts(response([productsBlock([noRegular])]))[0].regularPrice).toBeNull()
  })
})
