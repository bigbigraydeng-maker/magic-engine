/**
 * Meta 付费 vs 自然社媒。
 *
 * 付费信号才记成 meta。自然帖也用 utm_source=facebook，没有付费信号时必须是自然社媒，
 * 并且过不了广告名单沿用的同意闸（platform==='meta' 或有广告编号）。闸本身不改。
 */

import { describe, expect, it } from 'vitest'
import { attributionFromMetaLeadRow, attributionFromUtm } from '../attribution'
import { classifyMetaTouch, PAID_UTM_MEDIUMS, storedMetaAdConsent } from '../meta-touch'

const AD = '123456789012'

function consented(input: Parameters<typeof attributionFromUtm>[0]): boolean {
  const a = attributionFromUtm(input)
  return storedMetaAdConsent(a.platform, a.adId)
}

describe('classifyMetaTouch', () => {
  it('付费媒介 → meta 付费，并过现有同意闸', () => {
    for (const medium of PAID_UTM_MEDIUMS) {
      expect(classifyMetaTouch({ utmSource: 'facebook', utmMedium: medium })).toBe('meta_paid')
      expect(consented({ utm_source: 'facebook', utm_medium: medium })).toBe(true)
    }
  })

  it('organic / social 媒介 → 自然社媒，不过同意闸', () => {
    for (const medium of ['organic', 'social', 'organic_social']) {
      expect(classifyMetaTouch({ utmSource: 'facebook', utmMedium: medium })).toBe('organic_social')
      expect(consented({ utm_source: 'facebook', utm_medium: medium, utm_content: 'reel-01' })).toBe(false)
    }
  })

  it('没写媒介 → 自然社媒，不过同意闸', () => {
    expect(classifyMetaTouch({ utmSource: 'facebook' })).toBe('organic_social')
    expect(classifyMetaTouch({ utmSource: 'fb' })).toBe('organic_social')
    expect(classifyMetaTouch({ utmSource: 'instagram' })).toBe('organic_social')
    expect(classifyMetaTouch({ utmSource: 'facebook', utmMedium: 'display' })).toBe('organic_social')
    expect(consented({ utm_source: 'facebook', utm_campaign: 'page-post' })).toBe(false)
  })

  it('Meta 即时表单来源 → 付费，即使没有广告编号', () => {
    expect(classifyMetaTouch({ sourceKind: 'meta_lead_form' })).toBe('meta_paid')
    const row = attributionFromMetaLeadRow({})
    expect(row.platform).toBe('meta')
    expect(storedMetaAdConsent(row.platform, row.adId)).toBe(true)
  })

  it('只有 fbclid 不算付费；fbclid 加上广告编号才算', () => {
    expect(classifyMetaTouch({ utmSource: 'facebook', fbclid: 'click-1' })).toBe('organic_social')
    expect(consented({ utm_source: 'facebook', fbclid: 'click-1' })).toBe(false)

    expect(classifyMetaTouch({ utmSource: 'facebook', fbclid: 'click-1', utmContent: AD })).toBe('meta_paid')
    expect(classifyMetaTouch({ fbclid: 'click-1', adId: AD })).toBe('meta_paid')
    expect(classifyMetaTouch({ utmSource: 'google', fbclid: 'click-1', utmContent: AD })).toBe('not_meta')
    expect(consented({ fbclid: 'click-1', utm_content: AD })).toBe(true)
    const withClick = attributionFromUtm({ fbclid: 'click-1', utm_content: AD })
    expect(withClick.platform).toBe('meta')
    expect(withClick.adId).toBe(AD)
  })

  it('媒介写 organic 但 utm_content 是广告编号 → 仍算付费', () => {
    expect(classifyMetaTouch({ utmSource: 'facebook', utmMedium: 'organic', utmContent: AD })).toBe('meta_paid')
    expect(consented({ utm_source: 'facebook', utm_medium: 'organic', utm_content: AD })).toBe(true)
  })

  it('同意闸写法不变：meta 或广告编号才算，自然社媒不算', () => {
    expect(storedMetaAdConsent('meta', null)).toBe(true)
    expect(storedMetaAdConsent('organic_social', null)).toBe(false)
    expect(storedMetaAdConsent(null, AD)).toBe(true)
    expect(storedMetaAdConsent('web', null)).toBe(false)
    expect(storedMetaAdConsent(null, null)).toBe(false)
  })
})
