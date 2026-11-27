/**
 * 第 7 天跟进信：谁今天该收。PM 11-27「继续做第二件，第 7 天跟进信」；设计 2026-11-14 重排 v1 §2；
 * #3965 审查（子牙、魏征）第一轮的修改各有一条测试。
 */
import { describe, expect, it } from 'vitest'
import { calendarDays, day7Status, type Day7Input } from '../day7'
import { day7RequestId } from '../day7-list'
import type { CameBackRow } from '../came-back'

const NOW = new Date('2026-11-27T22:00:00.000Z') // 28 Nov 11:00 Auckland
const D = 24 * 3_600_000
const TZ = 'Pacific/Auckland'
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const sent = (at: string): CameBackRow => ({ channel: 'email', direction: 'outbound', occurred_at: at, raw: null, metadata: { automated: false }, source: 'microsoft_mail' })
const input = (p: Partial<Day7Input> & { since: string }): Day7Input => ({
  touches: [sent(p.since)], lastClickAt: null, lastSendAt: null, stopped: false, timeZone: TZ, ...p,
})
const v = (p: Partial<Day7Input> & { since: string }) => day7Status(input(p), NOW)

describe('day7Status', () => {
  it('due from day 7 to day 29 when nothing happened since the catalogue', () => {
    expect(v({ since: ago(10 * D) })).toEqual({ status: 'due', day: 10 })
    expect(v({ since: ago(7 * D) }).status).toBe('due')
  })

  it('counts client-local calendar days, not 24-hour blocks (魏征 P2)', () => {
    // Sent 21 Nov 15:00 Auckland; 28 Nov 11:00 Auckland is day 7 although only 6 days 20 hours passed.
    expect(calendarDays('2026-11-21T02:00:00.000Z', NOW, TZ)).toBe(7)
    expect(v({ since: '2026-11-21T02:00:00.000Z' }).status).toBe('due')
  })

  it('not yet before day 7, and no longer from day 30', () => {
    expect(v({ since: ago(6 * D) }).status).toBe('not_yet')
    expect(v({ since: ago(30 * D) }).status).toBe('past_30')
  })

  it('the stop line, judged live, takes precedence: booked / talked / came back since this morning (P1)', () => {
    expect(v({ since: ago(10 * D), stopped: true }).status).toBe('stopped')
  })

  it('a guest who opened what we sent belongs to staff (today list), not to this letter', () => {
    expect(v({ since: ago(10 * D), lastClickAt: ago(2 * D) }).status).toBe('clicked')
    expect(v({ since: ago(10 * D), lastClickAt: ago(11 * D) }).status).toBe('due')
  })

  it('one follow-up only: a person writing by e-mail, WhatsApp or Messenger, or a send in the log, takes the guest off', () => {
    const since = ago(10 * D)
    expect(v({ since, touches: [sent(since), sent(ago(2 * D))] }).status).toBe('already_written')
    const wa: CameBackRow = { ...sent(ago(2 * D)), channel: 'whatsapp', source: 'whatsapp' }
    expect(v({ since, touches: [sent(since), wa] }).status).toBe('already_written')
    // An unknown-outcome send writes no timeline line, only the send log (魏征 P1-2, 子牙 P1-2).
    expect(v({ since, lastSendAt: ago(D) }).status).toBe('already_written')
    const bulk: CameBackRow = { ...sent(ago(2 * D)), source: 'mailchimp', metadata: {} }
    expect(v({ since, touches: [sent(since), bulk] }).status).toBe('due')
  })
})

describe('day7RequestId', () => {
  it('is one fixed UUID per guest and round of follow-up, so a second send is refused anywhere', () => {
    const a = day7RequestId('c1', '2026-11-10T01:00:00.000Z')
    expect(a).toBe(day7RequestId('c1', '2026-11-10T01:00:00+00:00'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(day7RequestId('c1', '2026-11-20T01:00:00.000Z')).not.toBe(a)
    expect(day7RequestId('c2', '2026-11-10T01:00:00.000Z')).not.toBe(a)
  })
})
