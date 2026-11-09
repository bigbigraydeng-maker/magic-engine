import { describe, it, expect } from 'vitest'
import { verifyItineraryCities, CTS_TRAVEL_GAZETTEER } from './itinerary-city-guard'

const SHANGHAI_TOUR = ['Shanghai', 'Suzhou', 'Wuxi', 'Hangzhou'] as const

describe('verifyItineraryCities', () => {
  it('上海团放行：价格段无地名，其余城市都在行程内', () => {
    const result = verifyItineraryCities(
      ['NZ$2,699 per person · twin share', 'Suzhou gardens', 'Wuxi canal', 'The Bund'],
      SHANGHAI_TOUR,
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('pass')

    const priceItem = result.items.find((i) => i.segmentIndex === 0)
    expect(priceItem?.code).toBe('NO_PLACE_CLAIMED')

    const cityItems = result.items.filter((i) => i.segmentIndex !== 0)
    expect(cityItems.length).toBeGreaterThan(0)
    for (const item of cityItems) {
      expect(item.code).toBe('CITY_ON_ITINERARY')
    }
  })

  it('塞长城拦下（英文）：Great Wall 属北京，不在上海团', () => {
    const result = verifyItineraryCities(
      ['NZ$2,699 per person · twin share', 'Suzhou gardens', 'Wuxi canal', 'The Bund', 'Great Wall'],
      SHANGHAI_TOUR,
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('block')
    const off = result.items.find((i) => i.code === 'CITY_OFF_ITINERARY')
    expect(off).toBeDefined()
    expect(off?.city).toBe('Beijing')
  })

  it('塞长城拦下（中文）：长城游览', () => {
    const result = verifyItineraryCities(
      ['长城游览'],
      SHANGHAI_TOUR,
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('block')
    const off = result.items.find((i) => i.code === 'CITY_OFF_ITINERARY')
    expect(off).toBeDefined()
    expect(off?.city).toBe('Beijing')
  })

  it('没清单标疑：拿不到授权城市清单 → NO_ITINERARY', () => {
    const result = verifyItineraryCities(
      ['The Bund'],
      [],
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('flag')
    const item = result.items.find((i) => i.segmentIndex === 0)
    expect(item?.code).toBe('NO_ITINERARY')
  })

  it('歧义标疑：China 映到多个城市 → PLACE_UNMAPPED', () => {
    const result = verifyItineraryCities(
      ['China highlights'],
      ['Shanghai'],
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('flag')
    const item = result.items.find((i) => i.code === 'PLACE_UNMAPPED')
    expect(item).toBeDefined()
  })

  it('词边界：Chinatown 不得命中 china', () => {
    const result = verifyItineraryCities(
      ['Chinatown food tour'],
      ['Shanghai'],
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('pass')
    const item = result.items.find((i) => i.segmentIndex === 0)
    expect(item?.code).toBe('NO_PLACE_CLAIMED')
  })

  it('非地名全放行：价格 / 天数 / CTA 都不命中', () => {
    const result = verifyItineraryCities(
      ['10 days', 'flights included', 'Sign up now'],
      ['Shanghai'],
      CTS_TRAVEL_GAZETTEER,
    )

    expect(result.verdict).toBe('pass')
    for (const item of result.items) {
      expect(item.code).toBe('NO_PLACE_CLAIMED')
    }
  })
})
