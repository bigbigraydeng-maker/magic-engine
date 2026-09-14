import { describe, expect, it, vi } from 'vitest'

const callClaudeChat = vi.hoisted(() => vi.fn())
vi.mock('@/lib/anthropic/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/anthropic/client')>('@/lib/anthropic/client')
  return { ...actual, callClaudeChat }
})

import { analyzeJobSignals } from '../job-analysis'

const observation = {
  client_id: '00000000-0000-0000-0000-000000000001', source_type: 'jobs' as const, source_tier: 'B' as const,
  source_name: 'SEEK', source_url: 'https://www.seek.co.nz/job/1', canonical_url: 'https://www.seek.co.nz/job/1',
  title: 'China Travel Consultant', excerpt: '公司：Example Tours\n简介：Manage China itineraries.', competitor_domain: null,
  published_at: '2026-09-13T00:00:00.000Z', observed_at: '2026-09-13T01:00:00.000Z', valid_until: null,
  content_hash: 'a'.repeat(64), status: 'observed' as const,
}

describe('SEEK job analysis', () => {
  it('extracts company and explicit China relevance with the cheap model', async () => {
    callClaudeChat.mockResolvedValue({ text: JSON.stringify({ items: [{ index: 0, company_summary: '经营中国旅游产品', job_summary: '负责中国线路咨询与销售', china_relevance: 'explicit', relevance_reason: 'JD 写明 China itineraries', confidence: 0.9 }] }), cost_usd: 0.001 })
    const result = await analyzeJobSignals([observation])
    expect(callClaudeChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }))
    expect(result[0].analysis).toMatchObject({ company_summary: '经营中国旅游产品', china_relevance: 'explicit', confidence: 0.9 })
  })

  it('keeps raw evidence when the model is unavailable', async () => {
    callClaudeChat.mockRejectedValue(new Error('provider unavailable'))
    const result = await analyzeJobSignals([observation])
    expect(result[0]).toEqual(observation)
  })
})
