import { describe, it, expect } from 'vitest'
import {
  readEffectiveClientKind,
  hasKindOverviewSection,
  kindFeatureFlags,
} from './kind-features'

describe('readEffectiveClientKind', () => {
  it('空值按普通客户', () => {
    expect(readEffectiveClientKind(null)).toBe('standard')
    expect(readEffectiveClientKind(undefined)).toBe('standard')
    expect(readEffectiveClientKind('nope')).toBe('standard')
  })

  it('个人 IP 能认出来', () => {
    expect(readEffectiveClientKind('personal_ip')).toBe('personal_ip')
  })
})

describe('kindFeatureFlags', () => {
  const standardAll = {
    workflow_progress: true,
    next_step: true,
    brand_health: true,
    zhuge_priority: true,
    intelligence_summary: true,
    brief_banner: true,
    personal_ip_metrics: false,
  }

  it('普通客户与缺省一致 —— 与改前概览相同', () => {
    expect(kindFeatureFlags('standard')).toEqual(standardAll)
    expect(kindFeatureFlags(null)).toEqual(standardAll)
    expect(kindFeatureFlags(undefined)).toEqual(standardAll)
  })

  it('个人 IP 首屏五格，隐藏 DAPE 大卡', () => {
    expect(kindFeatureFlags('personal_ip')).toEqual({
      workflow_progress: false,
      next_step: true,
      brand_health: false,
      zhuge_priority: false,
      intelligence_summary: false,
      brief_banner: true,
      personal_ip_metrics: true,
    })
  })
})

describe('hasKindOverviewSection', () => {
  it('普通客户看不到个人 IP 五格', () => {
    expect(hasKindOverviewSection('standard', 'personal_ip_metrics')).toBe(false)
  })
})
