import { describe, expect, it } from 'vitest'
import { normaliseInsight } from '../metrics'

describe('normaliseInsight 透传版位/设备/地区维度字段', () => {
  it('保留 publisher_platform/platform_position/device_platform/country——2026-09-23 生产事故：这几个字段被漏掉，导致版位/设备/地区三张图表全部显示占位符（“?”“其他”）', () => {
    const row = {
      spend: '10', impressions: '100', clicks: '5',
      publisher_platform: 'facebook', platform_position: 'feed',
      device_platform: 'mobile_app', country: 'NZ',
    }
    const result = normaliseInsight(row, 'lead')
    expect(result.publisher_platform).toBe('facebook')
    expect(result.platform_position).toBe('feed')
    expect(result.device_platform).toBe('mobile_app')
    expect(result.country).toBe('NZ')
  })

  it('仍然保留原有的 age/gender 透传', () => {
    const row = { spend: '10', impressions: '100', clicks: '5', age: '25-34', gender: 'female' }
    const result = normaliseInsight(row, 'lead')
    expect(result.age).toBe('25-34')
    expect(result.gender).toBe('female')
  })

  it('维度字段缺失时不产生该键，而不是写入 undefined', () => {
    const result = normaliseInsight({ spend: '10', impressions: '100', clicks: '5' }, 'lead')
    expect(result).not.toHaveProperty('publisher_platform')
    expect(result).not.toHaveProperty('device_platform')
    expect(result).not.toHaveProperty('country')
  })
})
