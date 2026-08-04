import { describe, it, expect } from 'vitest'
import { applyPatch } from '../extract'
import { createBlankItinerary } from '../types'

/**
 * CTS-2026-0008 实测：15 天中国行程被抽成 route = ["Auckland"]，
 * 连带封面选图也错。出发地/中转地不是行程的一站。
 */
describe('trip.route 不应包含出发地 / 中转地', () => {
  const base = () => createBlankItinerary('T-1')

  it('剔除新西兰出发城市，保留中国停留城市', () => {
    const out = applyPatch(base(), {
      trip: { ...base().trip, route: ['Auckland', 'Beijing', "Xi'an", 'Shanghai'] },
    })
    expect(out.trip.route).toEqual(['Beijing', "Xi'an", 'Shanghai'])
  })

  it('只给出发地时留空，而不是印一个错的城市给客人', () => {
    const out = applyPatch(base(), {
      trip: { ...base().trip, route: ['Auckland'] },
    })
    expect(out.trip.route).toEqual([])
  })

  it('澳洲中转城市同样剔除', () => {
    const out = applyPatch(base(), {
      trip: { ...base().trip, route: ['Sydney', 'Chongqing'] },
    })
    expect(out.trip.route).toEqual(['Chongqing'])
  })

  it('中文出发地也认', () => {
    const out = applyPatch(base(), {
      trip: { ...base().trip, route: ['奥克兰', '重庆'] },
    })
    expect(out.trip.route).toEqual(['重庆'])
  })

  it('纯中国路线原样保留', () => {
    const route = ['Beijing', "Xi'an", 'Chongqing', 'Shanghai']
    const out = applyPatch(base(), { trip: { ...base().trip, route } })
    expect(out.trip.route).toEqual(route)
  })
})
