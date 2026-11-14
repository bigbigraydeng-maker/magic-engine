/**
 * 笔记里的回电时间必须在员工原话里有依据（PM 11-15：日历里有 2 条根本没约回电）。
 * 下面每一行都是 CTS 生产库里 11-10 起的真实笔记：笔记时间、AI 当时给的回电（都是新西兰当地时间）、原话。
 */

import { describe, expect, it } from 'vitest'
import { groundCallbackAt, callbackDayCandidates } from '../note-callback-grounding'
import { groundNoteParse } from '../note-grounding'
import type { NoteParse } from '../note-parser'

const TZ = 'Pacific/Auckland'
/** '11-13 17:00' → 2026-11-13 17:00 新西兰当地（夏令时 +13:00）。 */
const nz = (s: string): string => {
  const [md, hm] = s.split(' ')
  return new Date(`2026-${md}T${hm}:00+13:00`).toISOString()
}
const ground = (notedAt: string, ai: string, note: string): string | null =>
  groundCallbackAt(note, nz(ai), { now: new Date(nz(notedAt)), timeZone: TZ })

describe('🔴 没约回电、AI 却编了时间 → 置空（生产里 25 条）', () => {
  const invented: Array<[string, string, string, string]> = [
    ['11-06 16:20', '11-13 09:00', 'please follow up the CATALOG 2027', '同一句「跟进目录」'],
    ['11-11 17:10', '11-18 09:00', 'please follow up 2027 catalogue', '同一句「跟进目录」'],
    ['11-13 14:36', '11-20 09:00', 'please follow up 2027 catalogue', '同一句「跟进目录」，日期又不同'],
    ['11-14 17:08', '11-14 09:00', 'please follow up 2027 catalgoue', '回电比笔记还早'],
    ['11-08 15:44', '11-13 09:00', 'please follow up Best of China 13 May 2027 departure itinerary', '拿出发日 13 当日期'],
    ['11-13 14:33', '11-13 09:00', 'I will follow up Best of china 13 May departure', '出发日'],
    ['11-13 14:31', '11-15 09:00', 'I will follow up best of china 15 day tour', '拿天数 15 当日期'],
    ['11-11 17:01', '11-26 09:00', 'I will follow up best of china 15 days tour may departure', '天数 + may departure'],
    ['11-13 14:36', '11-18 09:00', 'I wil Follow up Tale of two cities 18 march 2027 departure', '出发日'],
    ['11-12 17:57', '12-18 09:00', 'I will follow up Shanghai & beyond 18 March 2027', '没写 departure 的出发日，且离笔记 4 个月'],
    ['11-11 17:22', '11-25 09:00', 'I will follow up SHANGHAI & BEYOND 25 March Decatur', '「Decatur」是 departure 打错'],
    ['11-14 17:13', '11-14 09:00', 'please Follow up Shangahhi & Beyond 25 March 2027 depature', 'PM 点名的那条之一'],
    ['11-11 18:19', '11-14 09:00', 'follow up Tale of Two cities and Shanghai & beyond', 'PM 点名的那条之一'],
    ['11-13 15:33', '11-13 09:00', 'he will call back and I will follow up tale of two cities 18 march 2027', '客人回电、没有时间'],
    ['11-13 17:33', '11-13 09:00', 'left message and will call back and follow up Shanghai & Beyond 25 March 2027', '留言、没有时间'],
    ['11-13 17:25', '11-14 09:00', 'she is not avaliable and left the message to her husband and asked call back', '没说回电时间'],
  ]
  it.each(invented)('%s 记「%s」→ 置空（%s）', (notedAt, ai, note) => {
    expect(ground(notedAt, ai, note)).toBeNull()
  })
})

describe('员工真约了时间 → 原样保留', () => {
  const real: Array<[string, string, string]> = [
    ['11-13 17:00', '11-14 16:00', 'call back tomorrow 14 Nov 4pm'],
    ['11-14 17:15', '11-14 18:30', 'call back today 6:30om'],
    ['11-13 16:34', '11-14 09:00', 'tomorrow morning 14 May to call back'], // 月份打错成 May，仍是明天上午
    ['11-14 17:10', '11-15 14:00', '2pm tomorrow call'],
    ['11-04 17:12', '11-25 09:00', 'call back in three weeks from 4 Nov'],
    ['11-13 16:58', '11-19 09:00', 'follow up next wed or Thursday after she talked to her friends about this Shanghai tour 18 or 19 Nov to call'],
    ['11-09 17:16', '11-10 17:15', 'call tomorrow 5:15 pm 10 Nov'],
    ['11-10 16:43', '11-10 19:00', 'call back 7pm today 10 Nov'],
    ['11-09 14:22', '11-10 16:00', 'call back tomorrow 10 Nov 2027 after 4pm'], // 年份打错
    ['11-13 16:31', '11-19 09:00', 'she will travel with 4 friends and will email her the catalogue, she will meet the friends on Wednesday it will good to follow up again next Thursday'],
  ]
  it.each(real)('%s 记「%s」→ 保留 AI 给的 %s', (notedAt, ai, note) => {
    expect(ground(notedAt, ai, note)).toBe(nz(ai))
  })
})

describe('AI 的日期对不上、原话只有一个说法 → 改成原话那一天', () => {
  it('「will call tomorrow anytime」11-12 记，AI 排成 12-13 → 改成 11-13 09:00', () => {
    expect(ground('11-12 17:25', '12-13 09:00', 'always want to go to china never been and her daughter has been and will call tomorrow anytime')).toBe(nz('11-13 09:00'))
  })
  it('原话说的时刻跟着走：「2pm tomorrow」AI 给了别的日子 → 改成明天 14:00', () => {
    expect(ground('11-14 17:10', '11-30 09:00', '2pm tomorrow call')).toBe(nz('11-15 14:00'))
  })
  it('中文：周五回电（周一记），AI 排成 11-20 → 改成 11-13', () => {
    expect(ground('11-09 10:00', '11-20 09:00', '客人说周五回电')).toBe(nz('11-13 09:00'))
  })
})

describe('🔴 回电早于笔记本身的时间 → 置空', () => {
  it('今天 9 点打给他，下午 5 点才记 → 置空', () => {
    expect(ground('11-14 17:00', '11-14 09:00', 'call back today 9am')).toBeNull()
  })
  it('AI 没给回电时间 → 保持没有（不替 AI 编）', () => {
    expect(groundCallbackAt('call tomorrow', null, { now: new Date(nz('11-12 17:00')), timeZone: TZ })).toBeNull()
  })
})

describe('星期和日期同时写、对得上 → 就是那一天（哪怕就是今天）', () => {
  it('周六凌晨 1:44 记「通话次日 10 月 31 日（周六）上午 10:00 回电」→ 当天 10:00，不推到下周六', () => {
    const note = '本次电话已接通，但客户当时不方便长谈。双方约定在通话次日，即 2026 年 10 月 31 日（周六）新西兰时间上午 10:00 回电。'
    expect(groundCallbackAt(note, new Date('2026-10-31T10:00:00+13:00').toISOString(), { now: new Date('2026-10-31T01:44:00+13:00'), timeZone: TZ })).toBe(new Date('2026-10-31T10:00:00+13:00').toISOString())
  })
  it('星期和日期对不上（周五 + 11 月 20 日是周五，11 月 21 日不是）时，按各自的下一个星期几', () => {
    expect(callbackDayCandidates('call friday 21 Nov', { y: 2026, m: 11, d: 13 })).toEqual([{ y: 2026, m: 11, d: 20 }])
  })
})

describe('补强：出发日在 60 天内、相对说法和日期冲突（之前的测试盖不住）', () => {
  it('🔴 出发日在 60 天内也不是回电：「Best of China 20 Dec departure」AI 排成 12-20 → 置空', () => {
    expect(ground('11-13 16:00', '12-20 09:00', 'I will follow up Best of China 20 Dec departure')).toBeNull()
  })
  it('🔴 「departure 20 Dec」（出发日在前面）同样不算', () => {
    expect(ground('11-13 16:00', '12-20 09:00', 'follow up Shanghai tour, departure 20 Dec')).toBeNull()
  })
  it('🔴 相对说法优先于具体日期：「call tomorrow 20 Nov」→ 明天（11-14），不是 11-20', () => {
    expect(ground('11-13 16:00', '11-20 09:00', 'call tomorrow 20 Nov')).toBe(nz('11-14 09:00'))
  })
  it('只说钟点：「下午三点联系」今天或明天都认；排到下周的不认，改成今天 15:00（说的钟点要认中文数字）', () => {
    expect(ground('11-13 10:00', '11-13 15:00', '下午三点联系')).toBe(nz('11-13 15:00'))
    expect(ground('11-13 10:00', '11-14 15:00', '下午三点联系')).toBe(nz('11-14 15:00'))
    expect(ground('11-13 10:00', '11-20 15:00', '下午三点联系')).toBe(nz('11-13 15:00'))
    expect(ground('11-13 10:00', '11-20 09:00', '晚上八点半联系')).toBe(nz('11-13 20:30'))
  })
})

describe('候选日子', () => {
  const today = { y: 2026, m: 11, d: 13 } // 周五
  it('超过 60 天的具体日期不算（那是出发日，跟「约回电」按钮同一条上限）', () => {
    expect(callbackDayCandidates('follow up 25 March', today)).toEqual([])
    expect(callbackDayCandidates('call 20 Dec', today)).toEqual([{ y: 2026, m: 12, d: 20 }])
  })
  it('有相对说法时只看相对说法，不看具体日期（员工常打错月份）', () => {
    expect(callbackDayCandidates('tomorrow 14 May', today)).toEqual([{ y: 2026, m: 11, d: 14 }])
  })
  it('同样的星期几是今天时，指下周（不是今天）', () => {
    expect(callbackDayCandidates('call friday', today)).toEqual([{ y: 2026, m: 11, d: 20 }])
  })
})

describe('接进 groundNoteParse', () => {
  const parsed = (callback: string | null): NoteParse => ({
    summary: '员工记了一笔',
    outcome: 'spoke',
    do_not_contact: false,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: callback,
    mentioned_next_step: true,
  })
  const ctx = { now: new Date(nz('11-11 17:10')), timeZone: TZ }

  it('🔴 回电置空，但「有下一步」仍然是 true（客人还在跟进名单里，只是不排具体时间）', () => {
    const out = groundNoteParse('please follow up 2027 catalogue', parsed(nz('11-18 09:00')), ctx)
    expect(out.callback_at).toBeNull()
    expect(out.mentioned_next_step).toBe(true)
  })
  it('真约的保留', () => {
    expect(groundNoteParse('call back tomorrow 4pm', parsed(nz('11-12 16:00')), ctx).callback_at).toBe(nz('11-12 16:00'))
  })
  it('老调用方不带上下文时行为不变（不动别的路径）', () => {
    expect(groundNoteParse('please follow up 2027 catalogue', parsed(nz('11-18 09:00'))).callback_at).toBe(nz('11-18 09:00'))
  })
})
