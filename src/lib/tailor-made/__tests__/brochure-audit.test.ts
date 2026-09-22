/**
 * CTS-2026-0030 真实事故：长江三峡三天卡片全用同一张图（当时图库只有一张
 * yangtze-gorges）。PM 拍板软提醒——标出来，不挡「标记已发送」。
 */

import { describe, it, expect } from 'vitest'
import { auditBrochureImages, brochureAuditSummary } from '../brochure-audit'
import { blankBrochureCity, blankBrochureCard, type TailorMadeBrochure } from '../brochure-types'

function blankBrochure(): TailorMadeBrochure {
  return {
    cover: { image: '', eyebrow: '', title: '', cities: [], meta: [], footNote: '' },
    overview: { eyebrow: '', title: '', intro: '', note: { title: '', body: '' } },
    cities: [],
    closing: { eyebrow: '', title: '', body: '', signOff: '' },
    credits: [],
  }
}

describe('auditBrochureImages', () => {
  it('flags two cards in the same city sharing one image', () => {
    const brochure = blankBrochure()
    const city = blankBrochureCity('Yangtze River Cruise')
    city.blocks = [
      { ...blankBrochureCard(), day: 'Day 10', title: 'Chengdu → Yangtze River Cruise', image: 'hero:yangtze-gorges' },
      { ...blankBrochureCard(), day: 'Day 11', title: 'Yangtze River — Three Gorges', image: 'hero:yangtze-gorges' },
      { ...blankBrochureCard(), day: 'Day 13', title: 'Yangtze River — Three Gorges', image: 'hero:yangtze-gorges' },
    ]
    brochure.cities = [city]

    const findings = auditBrochureImages(brochure)

    expect(findings).toHaveLength(1)
    expect(findings[0].level).toBe('warn')
    expect(findings[0].where).toContain('Yangtze River Cruise')
    expect(findings[0].what).toContain('Day 10')
    expect(findings[0].what).toContain('Day 11')
    expect(findings[0].what).toContain('Day 13')
  })

  it('does not flag the same image reused across different cities', () => {
    const brochure = blankBrochure()
    const beijing = blankBrochureCity('Beijing')
    beijing.blocks = [{ ...blankBrochureCard(), title: 'Great Wall', image: 'hero:great-wall' }]
    const xian = blankBrochureCity("Xi'an")
    xian.blocks = [{ ...blankBrochureCard(), title: 'City Wall', image: 'hero:xian-city-wall' }]
    brochure.cities = [beijing, xian]

    expect(auditBrochureImages(brochure)).toHaveLength(0)
  })

  it('does not flag distinct images, or empty image slots', () => {
    const brochure = blankBrochure()
    const city = blankBrochureCity('Xi\'an')
    city.hero.image = 'hero:xian-city-wall'
    city.blocks = [
      { ...blankBrochureCard(), title: 'Bell Tower', image: 'hero:xian-bell-tower' },
      { ...blankBrochureCard(), title: 'Free afternoon', image: '' },
      { eyebrow: '', title: 'Note', body: 'Bring a coat in winter.' },
    ]
    brochure.cities = [city]

    expect(auditBrochureImages(brochure)).toHaveLength(0)
  })

  it('counts the city hero image toward the same duplicate group as its cards', () => {
    const brochure = blankBrochure()
    const city = blankBrochureCity('Beijing')
    city.hero.image = 'hero:great-wall'
    city.hero.title = 'The Great Wall at Mutianyu'
    city.blocks = [{ ...blankBrochureCard(), title: 'Great Wall (again)', image: 'hero:great-wall' }]
    brochure.cities = [city]

    const findings = auditBrochureImages(brochure)
    expect(findings).toHaveLength(1)
    expect(findings[0].what).toContain('The Great Wall at Mutianyu')
    expect(findings[0].what).toContain('Great Wall (again)')
  })
})

describe('brochureAuditSummary', () => {
  it('summarises no findings', () => {
    expect(brochureAuditSummary([])).toBe('没有撞图')
  })

  it('counts findings', () => {
    expect(
      brochureAuditSummary([{ level: 'warn', where: 'a', what: 'b' }])
    ).toBe('1 处撞图')
  })
})
