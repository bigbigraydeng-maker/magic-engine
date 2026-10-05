/**
 * query_flywheel_history — rates only over decided cases; "unknown" is never printed as 0%.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/case-library/outcome-confidence', () => ({ fetchClientOutcomeHistory: vi.fn() }))

import { fetchClientOutcomeHistory } from '@/lib/case-library/outcome-confidence'
import { queryFlywheelHistory } from '../flywheel-history'
import type { ReadonlyToolContext } from '../types'

const mockOutcome = vi.mocked(fetchClientOutcomeHistory)

function asSupabase(x: object): ReadonlyToolContext['supabase'] {
  return x as ReadonlyToolContext['supabase']
}

const CTX: ReadonlyToolContext = {
  clientId: 'client-1',
  domain: 'example.com',
  siteUrl: 'https://example.com/',
  propertyId: 'properties/1',
  supabase: asSupabase({}),
  market: 'AU',
}

type ToolOutput = {
  note?: string
  actions: Array<{
    action_type: string
    success_rate_pct: number | null
    decided_cases: number
    total_cases: number
  }>
}

async function run(): Promise<ToolOutput> {
  return JSON.parse(await queryFlywheelHistory.handler({}, CTX)) as ToolOutput
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('query_flywheel_history — honest success rates', () => {
  it('prints null, not 0% or 100%, below three decided cases', async () => {
    mockOutcome.mockResolvedValue({ 'seo.publish_blog': { successRate: 1, sampleSize: 2, totalCases: 30 } })

    const out = await run()

    expect(out.actions).toEqual([
      { action_type: 'seo.publish_blog', success_rate_pct: null, decided_cases: 2, total_cases: 30 },
    ])
  })

  it('sorts known rates first, unknown ones last', async () => {
    mockOutcome.mockResolvedValue({
      'a.x': { successRate: 0.5, sampleSize: 4, totalCases: 4 },
      'b.y': { successRate: 1, sampleSize: 3, totalCases: 10 },
      'c.z': { successRate: 0, sampleSize: 0, totalCases: 7 },
    })

    const out = await run()

    expect(out.actions.map((a) => a.action_type)).toEqual(['b.y', 'a.x', 'c.z'])
    expect(out.actions[0].success_rate_pct).toBe(100)
    expect(out.actions[2].success_rate_pct).toBeNull()
  })

  it('tells the reader how to read the numbers', async () => {
    mockOutcome.mockResolvedValue({ 'a.x': { successRate: 0.5, sampleSize: 4, totalCases: 9 } })

    const out = await run()

    expect(out.note).toContain('decided cases only')
    expect(out.note).toContain('null')
  })
})
