/**
 * 「约回电」快捷选时间：时间怎么换算、怎么校验、怎么盖过 AI 的解析。
 *
 * 这些数字都是手算过的真实时刻（新西兰 2026-11-01 是周日，夏令时 UTC+13），
 * 不是拿被测函数自己的输出当期望值。
 */

import { describe, expect, it } from 'vitest'
import {
  callbackBookedMessage,
  resolveCallbackPreset,
  resolveCallbackRequest,
  withStructuredCallback,
} from '../callback-pick'
import type { NoteParse } from '../note-parser'

const NZ = 'Pacific/Auckland'
/** 新西兰周日 14:00。 */
const SUN = new Date('2026-11-01T01:00:00.000Z')

describe('三个快捷项 → 客户所在地的真实时刻', () => {
  it('明天上午 10 点 / 明天下午 2 点（周日 → 周一）', () => {
    expect(resolveCallbackPreset('tomorrow_am', SUN, NZ)).toBe('2026-11-01T21:00:00.000Z')
    expect(resolveCallbackPreset('tomorrow_pm', SUN, NZ)).toBe('2026-11-02T01:00:00.000Z')
  })

  it('下周一：周日选 → 明天；周一选 → 七天后，不是今天', () => {
    expect(resolveCallbackPreset('next_monday_am', SUN, NZ)).toBe('2026-11-01T21:00:00.000Z')
    const mon = new Date('2026-11-02T01:00:00.000Z')
    expect(resolveCallbackPreset('next_monday_am', mon, NZ)).toBe('2026-11-08T21:00:00.000Z')
  })

  it('下周一：周三选 → 本周之后的那个周一', () => {
    const wed = new Date('2026-11-04T01:00:00.000Z') // 新西兰周三 14:00
    expect(resolveCallbackPreset('next_monday_am', wed, NZ)).toBe('2026-11-08T21:00:00.000Z')
  })

  it('「明天」按客户所在地算，不按 UTC 日期（UTC 还在周日，新西兰已是周一凌晨）', () => {
    const lateNight = new Date('2026-11-01T12:30:00.000Z') // 新西兰周一 01:30
    expect(resolveCallbackPreset('tomorrow_am', lateNight, NZ)).toBe('2026-11-02T21:00:00.000Z')
  })

  it('跨月：月底选「明天」', () => {
    const endOfMonth = new Date('2026-11-30T01:00:00.000Z') // 新西兰 11/30 14:00
    expect(resolveCallbackPreset('tomorrow_am', endOfMonth, NZ)).toBe('2026-11-30T21:00:00.000Z')
  })

  it('夏令时结束那个周末：下周一上午 10 点用的是新的偏移（+12），不是选的那天的（+13）', () => {
    const sat = new Date('2027-04-03T01:00:00.000Z') // 新西兰周六 14:00，还在夏令时
    expect(resolveCallbackPreset('next_monday_am', sat, NZ)).toBe('2027-04-04T22:00:00.000Z')
  })

  it('澳洲客户按悉尼算（夏令时 UTC+11）', () => {
    expect(resolveCallbackPreset('tomorrow_am', SUN, 'Australia/Sydney')).toBe('2026-11-01T23:00:00.000Z')
  })
})

describe('服务端校验', () => {
  it('两个字段都没传 = 没约回电', () => {
    expect(resolveCallbackRequest({}, SUN, NZ)).toEqual({ ok: true, iso: null })
  })

  it('快捷项走客户时区', () => {
    expect(resolveCallbackRequest({ callbackPreset: 'tomorrow_pm' }, SUN, NZ)).toEqual({
      ok: true,
      iso: '2026-11-02T01:00:00.000Z',
    })
  })

  it('自选时间：不带时区的当地时间按客户所在地算', () => {
    expect(resolveCallbackRequest({ callbackAt: '2026-11-03T14:00' }, SUN, NZ)).toEqual({
      ok: true,
      iso: '2026-11-03T01:00:00.000Z',
    })
  })

  it('自选时间：带时区的 ISO 原样当真实时刻', () => {
    const a = resolveCallbackRequest({ callbackAt: '2026-11-03T01:00:00Z' }, SUN, NZ)
    const b = resolveCallbackRequest({ callbackAt: '2026-11-03T14:00:00+13:00' }, SUN, NZ)
    expect(a).toEqual({ ok: true, iso: '2026-11-03T01:00:00.000Z' })
    expect(b).toEqual({ ok: true, iso: '2026-11-03T01:00:00.000Z' })
  })

  it('换季当天凌晨的时间也要对（夏令时 2027-04-04 03:00 回拨；当地 00:30 还是 +13）', () => {
    const before = new Date('2027-04-01T01:00:00.000Z')
    expect(resolveCallbackRequest({ callbackAt: '2027-04-04T00:30' }, before, NZ)).toEqual({
      ok: true,
      iso: '2027-04-03T11:30:00.000Z',
    })
  })

  it('过去的时间 → 拒绝', () => {
    const r = resolveCallbackRequest({ callbackAt: '2026-10-31T10:00' }, SUN, NZ)
    expect(r.ok).toBe(false)
  })

  it('正好是现在也算过去（要的是「以后」）', () => {
    const r = resolveCallbackRequest({ callbackAt: SUN.toISOString() }, SUN, NZ)
    expect(r.ok).toBe(false)
  })

  it('60 天整可以，多一分钟就拒绝', () => {
    const at = (extraMs: number) => new Date(SUN.getTime() + 60 * 86_400_000 + extraMs).toISOString()
    expect(resolveCallbackRequest({ callbackAt: at(0) }, SUN, NZ).ok).toBe(true)
    expect(resolveCallbackRequest({ callbackAt: at(60_000) }, SUN, NZ).ok).toBe(false)
  })

  it('读不懂的格式 / 日历上不存在的日子 / 乱字段 → 拒绝', () => {
    for (const bad of ['明天下午', '2026-02-31T10:00', '2026-11-03', '2026-11-03T25:00', 12345]) {
      expect(resolveCallbackRequest({ callbackAt: bad }, SUN, NZ).ok).toBe(false)
    }
    expect(resolveCallbackRequest({ callbackPreset: 'next_year' }, SUN, NZ).ok).toBe(false)
  })

  it('快捷项和自选时间只能选一种', () => {
    const r = resolveCallbackRequest({ callbackPreset: 'tomorrow_am', callbackAt: '2026-11-03T14:00' }, SUN, NZ)
    expect(r.ok).toBe(false)
  })
})

describe('按钮选的时间盖过 AI 读出来的', () => {
  const parsed = (over: Partial<NoteParse> = {}): NoteParse => ({
    outcome: 'spoke',
    do_not_contact: false,
    travel_window: '明年三月',
    tour_interest: null,
    competitor: null,
    callback_at: '2026-11-05T00:00:00.000Z',
    summary: '聊得不错',
    ...over,
  })

  it('时间和结论被覆盖，其余字段（出行时间等）不动', () => {
    const out = withStructuredCallback(parsed(), '2026-11-02T01:00:00.000Z')
    expect(out.callback_at).toBe('2026-11-02T01:00:00.000Z')
    expect(out.outcome).toBe('callback_set')
    expect(out.mentioned_next_step).toBe(true)
    expect(out.travel_window).toBe('明年三月')
    expect(out.summary).toBe('聊得不错')
  })

  it('AI 什么都没读出来时也照样排上', () => {
    const out = withStructuredCallback(parsed({ callback_at: null }), '2026-11-02T01:00:00.000Z')
    expect(out.callback_at).toBe('2026-11-02T01:00:00.000Z')
  })

  it('没选时间 → 原样返回，AI 读出来的不动', () => {
    const p = parsed()
    expect(withStructuredCallback(p, null)).toBe(p)
    expect(withStructuredCallback(p, undefined)).toBe(p)
  })

  it('员工原话是「没接」/「先不考虑」：保留结论，只补时间', () => {
    for (const outcome of ['no_answer', 'not_interested_now'] as const) {
      const out = withStructuredCallback(parsed({ outcome }), '2026-11-02T01:00:00.000Z')
      expect(out.outcome).toBe(outcome)
      expect(out.callback_at).toBe('2026-11-02T01:00:00.000Z')
    }
  })

  it('「别再联系」和坏号码比日程硬：不排回电', () => {
    const dnc = parsed({ outcome: 'do_not_contact', do_not_contact: true, callback_at: null })
    const bad = parsed({ outcome: 'bad_number', callback_at: null })
    expect(withStructuredCallback(dnc, '2026-11-02T01:00:00.000Z')).toBe(dnc)
    expect(withStructuredCallback(bad, '2026-11-02T01:00:00.000Z')).toBe(bad)
  })
})

describe('保存后的确认话术', () => {
  it('说出具体哪天、周几、几点（客户所在地）', () => {
    const msg = callbackBookedMessage('2026-11-01T21:00:00.000Z', NZ)
    expect(msg).toContain('已约')
    expect(msg).toContain('11月2日')
    expect(msg).toContain('周一')
    expect(msg).toContain('10:00')
    expect(msg?.endsWith('回电')).toBe(true)
  })

  it('澳洲客户按悉尼显示', () => {
    // 2026-11-01T23:00Z = 悉尼周一 10:00
    expect(callbackBookedMessage('2026-11-01T23:00:00.000Z', 'Australia/Sydney')).toContain('10:00')
  })

  it('坏时间 → null，不编一句话', () => {
    expect(callbackBookedMessage('不是时间', NZ)).toBeNull()
  })
})
