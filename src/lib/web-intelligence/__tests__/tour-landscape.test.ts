import { describe, expect, it } from 'vitest'
import { ensureActionableTourLandscape, formatTourLandscapeChatReply, tourLandscapePrompt, validateTourLandscape } from '../tour-landscape'

describe('tour landscape summary', () => {
  it('validates bounded summary output', () => {
    const result = validateTourLandscape({ headline: '价格带分层明显', market_summary: '竞品覆盖多个城市和不同天数。', client_opportunities: ['突出短途产品'], client_risks: ['价格带竞争'], recommended_focus: ['补齐日期'], unknowns: ['余位'], confidence: 1.4 })
    expect(result.confidence).toBe(1)
    expect(result.client_opportunities).toEqual(['突出短途产品'])
  })

  it('asks the model for a portfolio view rather than one-to-one matching', () => {
    expect(tourLandscapePrompt({ client_name: 'Example', client_products: [], competitor_products: [] })).toContain('而不是逐团横向配对')
  })

  it('grounds the summary in dated industry evidence without overgeneralising', () => {
    const prompt = tourLandscapePrompt({
      client_name: 'CTS',
      client_products: [],
      competitor_products: [],
      external_signals: [{ source_type: 'industry_media', source_name: 'Travel Today', source_url: 'https://example.com/story', title: 'China travel demand update', excerpt: 'A specific reported change.', observed_at: '2026-09-12T00:00:00.000Z' }],
    })
    expect(prompt).toContain('China travel demand update')
    expect(prompt).toContain('2026-09-12T00:00:00.000Z')
    expect(prompt).toContain('不得因为一篇文章就声称整个市场发生变化')
  })

  it('labels traffic estimates as an auxiliary low-confidence signal', () => {
    const prompt = tourLandscapePrompt({ client_name: 'CTS', client_products: [], competitor_products: [], traffic_signals: [{ domain: 'competitor.example', observed_at: '2026-09-12', estimated_visits: 1200, previous_estimated_visits: 1000, visits_change_pct: 20, excerpt: 'Public estimate' }] })
    expect(prompt).toContain('公开估算，低置信度')
    expect(prompt).toContain('不得据此声称竞品销售增长')
    expect(prompt).toContain('competitor.example')
  })

  it('bounds injected client memory so it cannot overwhelm the analysis prompt', () => {
    const prompt = tourLandscapePrompt({ client_name: 'Example', client_products: [], competitor_products: [], memory_context: 'x'.repeat(10000) })
    expect(prompt).not.toContain('x'.repeat(5001))
    expect(prompt).toContain('x'.repeat(5000))
  })

  it('renders JSON chat replies as readable business sections', () => {
    const result = formatTourLandscapeChatReply('```json\n{"headline":"先核查 Signature","market_summary":"CTS 18天产品为 NZD 7,999。","client_opportunities":["核对路线差异"],"client_risks":["不要立即降价"]}\n```')
    expect(result).toContain('结论：先核查 Signature')
    expect(result).toContain('依据：CTS 18天产品为 NZD 7,999。')
    expect(result).toContain('建议：\n- 核对路线差异')
    expect(result).not.toContain('```json')
  })

  it('fills missing action sections without replacing a concrete AI market summary', () => {
    const landscape = ensureActionableTourLandscape(validateTourLandscape({
      headline: '中长线产品存在价格重叠',
      market_summary: 'China Uncovered 为21天、NZD 10,480；CTS Signature覆盖17-27天和NZD 7,999-10,899。',
      client_opportunities: [], client_risks: [], recommended_focus: [], unknowns: [], confidence: 0.7,
    }), {
      client_name: 'CTS',
      market_scope: ['china'],
      client_products: [{ name: 'Signature', destination: 'China', route: 'Beijing Shanghai', duration_days: 21, price: 'NZD 10480', departure_window: '2027', includes: 'Flights hotels', positioning: 'premium', audience: 'NZ travellers' }],
      competitor_products: [{ domain: 'wendy.example', source_url: 'https://wendy.example/china', observed_at: '2026-09-12', records: [] }],
    })
    expect(landscape.market_summary).toContain('China Uncovered')
    expect(landscape.client_opportunities.length).toBeGreaterThan(0)
    expect(landscape.client_risks.length).toBeGreaterThan(0)
    expect(landscape.recommended_focus.length).toBeGreaterThan(0)
    expect(landscape.unknowns.length).toBeGreaterThan(0)
  })
})
