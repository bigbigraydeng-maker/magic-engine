import { describe, expect, it } from 'vitest'

import { shortCampaignName, shortCampaignNames } from '../campaign-labels'

describe('shortCampaignName', () => {
  it('keeps the lead part of a long mixed-language title and drops the trailing "Campaign" label', () => {
    expect(shortCampaignName('Spring Launch · Four Tours · Daily Plan · Campaign')).toBe('Spring Launch')
    expect(shortCampaignName('春季招募 · 四个团 · 每日计划 · Campaign')).toBe('春季招募')
    expect(shortCampaignName('品牌曝光引擎 — FB+IG 30 天内容矩阵 · Campaign')).toBe('品牌曝光引擎')
    expect(shortCampaignName('十月广告冲刺 · Campaign')).toBe('十月广告冲刺')
  })

  it('only cuts at separators that have spaces around them', () => {
    expect(shortCampaignName('FB+IG 30-day matrix - phase 2')).toBe('FB+IG 30-day matrix')
    expect(shortCampaignName('Q4-2026 sprint')).toBe('Q4-2026 sprint')
    expect(shortCampaignName('A | B')).toBe('A')
  })

  it('leaves short or odd titles readable and never returns an empty name', () => {
    expect(shortCampaignName('Summer Sale')).toBe('Summer Sale')
    expect(shortCampaignName('  Summer   Sale  ')).toBe('Summer Sale')
    expect(shortCampaignName('Campaign')).toBe('Campaign')
    expect(shortCampaignName('· Campaign')).not.toBe('')
    expect(shortCampaignName('')).toBe('')
  })

  it('clips a very long lead part', () => {
    const name = shortCampaignName('A very long campaign name that keeps going and going without any separator at all')
    expect(name.length).toBeLessThanOrEqual(22)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('shortCampaignNames', () => {
  it('gives each campaign its short name when they are all different', () => {
    expect(shortCampaignNames(['One · a · Campaign', 'Two · b · Campaign'])).toEqual(['One', 'Two'])
  })

  it('adds the next part of the title when two short names would be the same', () => {
    expect(shortCampaignNames(['Spring · Leads · Campaign', 'Spring · Brand · Campaign', 'Autumn · Campaign'])).toEqual([
      'Spring · Leads',
      'Spring · Brand',
      'Autumn',
    ])
  })

  it('identical titles stay identical (nothing to tell apart), without looping forever', () => {
    expect(shortCampaignNames(['Same · Campaign', 'Same · Campaign'])).toEqual(['Same', 'Same'])
    expect(shortCampaignNames([])).toEqual([])
  })
})
