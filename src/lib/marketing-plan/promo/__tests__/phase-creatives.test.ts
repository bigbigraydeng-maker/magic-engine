import { describe, expect, it } from 'vitest'
import { creativeRefsOfPhase } from '../phase-creatives'
import { baseSpec } from './fixtures'
import type { PromoSpec } from '../spec'

function withRefs(refs: string[][]): PromoSpec {
  const spec = baseSpec()
  spec.phases[0].steps = refs.map((creative_refs, i) => ({
    id: `ads-${i}`, kind: 'ads_campaign' as const,
    settings: { ad_account_id: 'act_1', daily_budget_cents: 100, audience_ref: 'aud', creative_refs, placements: [], paused_ranges: [] },
  }))
  return spec
}

describe('creativeRefsOfPhase', () => {
  it('取这个阶段所有广告步骤的素材，去重并保持顺序', () => {
    expect(creativeRefsOfPhase(withRefs([['a', 'b'], ['b', 'c']]), 'p1')).toEqual(['a', 'b', 'c'])
  })

  it('只看广告步骤，不看社媒步骤', () => {
    expect(creativeRefsOfPhase(baseSpec(), 'p1')).toEqual(['vid-1'])
  })

  it('阶段里没有广告步骤 → 空数组（不是 null）', () => {
    expect(creativeRefsOfPhase(baseSpec(), 'p2')).toEqual([])
  })

  it('读不到计划 / 找不到这个阶段 → null，页面要写「读不到素材清单」', () => {
    expect(creativeRefsOfPhase(null, 'p1')).toBeNull()
    expect(creativeRefsOfPhase(baseSpec(), 'nope')).toBeNull()
  })
})
