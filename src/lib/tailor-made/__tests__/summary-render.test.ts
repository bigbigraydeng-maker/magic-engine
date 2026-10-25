/**
 * 一页摘要的渲染层：确认模板真的找得到、数据真的注入进去了，
 * 以及顾问填的文本（可能带引号 / HTML 特殊字符）不会把注入搞坏。
 */
import { describe, it, expect } from 'vitest'
import { renderOnePagerHtml } from '../summary-render'
import { createBlankItinerary, type TailorMadeItinerary } from '../types'

function sample(): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0042')
  it.client = { name: 'Jazz & "Family"', travellers: '5 passengers' }
  it.trip.title = 'China Icons Collection'
  it.trip.route = ['Beijing', "Xi'an", 'Shanghai']
  it.trip.dateRange = '1 Nov – 15 Nov 2027'
  it.trip.duration = '15 days'
  it.trip.summary = 'A highlights-only tour of three icon cities.'
  it.trip.highlights = ['Great Wall at Mutianyu', 'Terracotta Warriors']
  it.pricing.amount = 5280
  it.pricing.currency = 'NZD'
  return it
}

describe('renderOnePagerHtml', () => {
  it('渲染出标题、路线、报价编号，并把数据标记替换掉', async () => {
    const html = await renderOnePagerHtml(sample())
    expect(html).toContain('__DATA_START__')
    expect(html).toContain('CTS-2026-0042')
    expect(html).toContain('China Icons Collection')
    for (const city of ['Beijing', "Xi'an", 'Shanghai']) expect(html).toContain(city)
    expect(html).toContain('Great Wall at Mutianyu')
  })

  it('价格缺失时带 amountNote，不是空白或编造的数字', async () => {
    const it = sample()
    it.pricing.amount = null
    it.pricing.amountNote = 'Quotation to follow'
    const html = await renderOnePagerHtml(it)
    expect(html).toContain('Quotation to follow')
  })

  it('客户名里的引号安全注入——不会提前截断 JSON', async () => {
    const html = await renderOnePagerHtml(sample())
    const json = html.slice(
      html.indexOf('/*__DATA_START__*/') + '/*__DATA_START__*/'.length,
      html.indexOf('/*__DATA_END__*/')
    )
    const parsed = JSON.parse(json) as { client: { name: string } }
    expect(parsed.client.name).toBe('Jazz & "Family"')
  })

  it('缺 logo 也照样出稿，不让顾问点了只看到报错', async () => {
    const html = await renderOnePagerHtml(sample())
    expect(html).toContain('__DATA_END__')
  })
})
