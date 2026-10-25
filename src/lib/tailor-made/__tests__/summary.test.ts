/**
 * 一页摘要是从已经写好的行程单挑字段，不是另一份要填的文档。
 * 这里锁住两件事：
 *  - 挑字段挑对了（不编造、不丢关键信息）
 *  - 「条数 / 长度超了就裁」这条规则真的在裁，不是只在注释里说说
 *    （一页纸版面固定，装不下的内容会把价格区块挤到下一页，等于没有一页摘要）
 */
import { describe, it, expect } from 'vitest'
import { buildOnePageSummary, MAX_SUMMARY_CHARS, MAX_SUMMARY_HIGHLIGHTS } from '../summary'
import { createBlankItinerary, type TailorMadeItinerary } from '../types'

function sample(): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0099')
  it.meta.consultant = { name: 'Jane Lee', title: 'China Travel Specialist', phone: '0800 287 888', email: 'jane@ctstours.co.nz' }
  it.client = { name: 'Mr & Mrs Thompson', travellers: '2 adults, twin share' }
  it.trip = {
    title: 'China Grand Discovery Tour',
    route: ['Beijing', "Xi'an", 'Shanghai'],
    dateRange: '8 May – 28 May 2027',
    duration: '20 days',
    heroImage: '',
    summary: 'A sweeping journey across three millennia of Chinese history.',
    highlights: ['Great Wall', 'Terracotta Warriors', 'Pandas', 'Forbidden City', 'Night cruise', 'Rock carvings', 'Extra one too many'],
    facts: [{ label: 'Duration', value: '20 days / 19 nights' }],
  }
  it.days = [{ day: 1, date: '8 May', weekday: 'Saturday', route: 'Auckland → Beijing', body: 'Depart Auckland.' }]
  it.pricing = {
    basis: 'Land only, per person, based on two people sharing a twin/double room',
    currency: 'NZD',
    amount: 6480,
    amountNote: '',
    optional: [],
  }
  return it
}

describe('buildOnePageSummary', () => {
  it('挑出摘要需要的字段，逐日行程 / 航班 / 条款不带进来', () => {
    const summary = buildOnePageSummary(sample())
    expect(summary.trip.title).toBe('China Grand Discovery Tour')
    expect(summary.client.name).toBe('Mr & Mrs Thompson')
    expect(summary.pricing.amount).toBe(6480)
    expect(summary.meta.consultant.email).toBe('jane@ctstours.co.nz')
    expect(summary).not.toHaveProperty('days')
    expect(summary).not.toHaveProperty('inclusions')
  })

  it(`亮点超过 ${MAX_SUMMARY_HIGHLIGHTS} 条就截断，不是全列出来`, () => {
    const summary = buildOnePageSummary(sample())
    expect(summary.trip.highlights).toHaveLength(MAX_SUMMARY_HIGHLIGHTS)
    expect(summary.trip.highlights).toEqual([
      'Great Wall', 'Terracotta Warriors', 'Pandas', 'Forbidden City', 'Night cruise', 'Rock carvings',
    ])
  })

  it('亮点不超过上限时原样保留', () => {
    const it = sample()
    it.trip.highlights = ['Only one highlight']
    expect(buildOnePageSummary(it).trip.highlights).toEqual(['Only one highlight'])
  })

  it('概述超长时按词边界截断并加省略号', () => {
    const it = sample()
    it.trip.summary = 'word '.repeat(100).trim()
    const out = buildOnePageSummary(it).trip.summary
    expect(out.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1) // +1 容许省略号
    expect(out.endsWith('…')).toBe(true)
    expect(out.endsWith(' …')).toBe(false) // 不该在截断处留下半个空格
  })

  it('概述没超长就原样保留，不强加省略号', () => {
    const summary = buildOnePageSummary(sample())
    expect(summary.trip.summary).toBe('A sweeping journey across three millennia of Chinese history.')
  })

  it('没定价时带 amountNote 过去，不是编一个金额', () => {
    const it = sample()
    it.pricing.amount = null
    it.pricing.amountNote = 'Quotation issued separately — see covering email'
    const summary = buildOnePageSummary(it)
    expect(summary.pricing.amount).toBeNull()
    expect(summary.pricing.amountNote).toBe('Quotation issued separately — see covering email')
  })

  it('不改原对象', () => {
    const it = sample()
    buildOnePageSummary(it)
    expect(it.trip.highlights).toHaveLength(7)
  })
})
