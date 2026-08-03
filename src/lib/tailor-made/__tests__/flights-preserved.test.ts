import { describe, it, expect } from 'vitest'
import { applyPatch } from '../extract'
import { createBlankItinerary, type TailorMadeFlight } from '../types'

/**
 * 甲方实测：「第一版我记得是看到航班信息了，然后又重新生成了一版」——
 * 重新导入行程把已读到的航段冲掉了。
 *
 * extractItinerary 不把 flights 传给模型（那是另一份文件的事），
 * 所以 patch 里永远没有 flights；合并时必须原样保留。
 */
describe('重新导入行程不能冲掉已读到的航班', () => {
  const flights: TailorMadeFlight[] = [
    { date: '1 Nov', flightNo: 'NZ 468', from: 'Wellington', to: 'Auckland', departTime: '17:10', arriveTime: '18:15' },
  ]

  it('patch 没带 flights 时，原有航段原样保留', () => {
    const current = { ...createBlankItinerary('T-1'), flights, bookingRef: 'DFSNHG' }
    const out = applyPatch(current, {
      trip: { ...current.trip, title: 'China Icons', route: ['Beijing'] },
    })
    expect(out.flights).toEqual(flights)
    expect(out.bookingRef).toBe('DFSNHG')
  })

  it('重新导入整份行程（days 全换）也不影响航段', () => {
    const current = { ...createBlankItinerary('T-1'), flights }
    const out = applyPatch(current, {
      days: [
        { day: 1, date: '1 Nov', weekday: 'Sat', route: 'Beijing', body: 'x' },
        { day: 2, date: '2 Nov', weekday: 'Sun', route: 'Beijing', body: 'y' },
      ],
    })
    expect(out.days).toHaveLength(2)
    expect(out.flights).toEqual(flights)
  })

  it('明确传入新航段时才覆盖', () => {
    const current = { ...createBlankItinerary('T-1'), flights }
    const next: TailorMadeFlight[] = [
      { date: '5 Dec', flightNo: 'CA 783', from: 'Auckland', to: 'Beijing', departTime: '20:30', arriveTime: '05:00' },
    ]
    const out = applyPatch(current, { flights: next })
    expect(out.flights).toEqual(next)
  })
})
