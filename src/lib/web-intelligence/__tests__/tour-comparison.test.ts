import { describe, expect, it, vi } from 'vitest'

const { callClaudeChat } = vi.hoisted(() => ({ callClaudeChat: vi.fn() }))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat, MODEL_HAIKU: 'haiku-test', parseJsonResponse: JSON.parse }))

import { compareTours, tourComparisonPrompt, validateTourComparison } from '../tour-comparison'

const input = {
  market_scope: ['中国'],
  client_product: { name: 'CTS China Highlights', source_url: 'https://cts.example/tours/china', record: { name: 'CTS China Highlights', durationDays: 15, price: 'NZD 8,999pp', route: 'Beijing - Xian - Shanghai', departureWindow: 'October 2026', includes: 'Flights and hotels', positioning: 'small group', audience: 'NZ travellers', itinerary: ['Day 1: Beijing', 'Day 2: Great Wall'] } },
  competitor_product: { name: 'Wendy China Discovery', source_url: 'https://wendy.example/tours/china', observed_at: '2026-09-11T00:00:00Z', record: { name: 'Wendy China Discovery', durationDays: 17, price: 'NZD 9,480pp', route: 'Beijing - Xian - Shanghai - Suzhou', departureWindow: 'October 2026', includes: 'Flights, hotels and rail', positioning: 'guided group', audience: 'NZ travellers', itinerary: ['Day 1: Beijing', 'Day 2: Great Wall'] } },
} as const

describe('Tour comparison contract', () => {
  it('keeps the comparison focused on consumer-visible fields', () => {
    const payload = JSON.parse(tourComparisonPrompt(input)) as Record<string, unknown>
    expect(payload.market_scope).toEqual(['中国'])
    expect((payload.client_product as { fields: Record<string, unknown> }).fields.duration_days).toBe(15)
    expect(tourComparisonPrompt(input)).not.toContain('销量')
  })

  it('uses Haiku for a bounded comparison call', async () => {
    callClaudeChat.mockResolvedValue({ text: '{}', input_tokens: 10, output_tokens: 10, cost_usd: 0.00006 })
    await compareTours(input)
    expect(callClaudeChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'haiku-test', maxOutputTokens: 1200, singleAttempt: true }))
  })

  it('rejects a model-invented source URL', () => {
    const result = { summary: '比较', client_strengths: [], competitor_strengths: [], differences: ['竞品多一个城市'], recommendations: ['人工评估路线取舍'], unknowns: [], confidence: 0.7, evidence_urls: ['https://evil.example/source'] }
    expect(() => validateTourComparison(JSON.stringify(result), input)).toThrow('invented_tour_comparison_source')
  })

  it('accepts only supplied source URLs', () => {
    const result = { summary: '比较', client_strengths: ['行程更短'], competitor_strengths: ['多一个城市'], differences: ['天数和城市覆盖不同'], recommendations: ['人工评估是否保留苏州'], unknowns: ['未提供余位'], confidence: 0.7, evidence_urls: [input.client_product.source_url, input.competitor_product.source_url] }
    expect(validateTourComparison(JSON.stringify(result), input).evidence_urls).toEqual([input.client_product.source_url, input.competitor_product.source_url])
  })
})
