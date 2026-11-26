/**
 * 每日咨询早报 · 归类、取「问什么」、脱敏、渲染、「昨天」的边界。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildEnquiryDigest,
  groupByPerson,
  humanizeOption,
  interestOf,
  messageOf,
  topInterests,
  type EnquiryTouchRow,
} from '../enquiry-daily-digest'
import {
  buildEnquiryBody,
  buildEnquirySubject,
  dayLabel,
  sendEnquiryDailyDigest,
} from '../enquiry-daily-render'
import { yesterdayWindow } from '../enquiry-daily-load'
import type { DigestMailer } from '../digest-shared'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const TZ = 'Pacific/Auckland'

function row(over: Partial<EnquiryTouchRow>): EnquiryTouchRow {
  return {
    contact_id: 'p1',
    channel: 'meta_lead_form',
    source: 'meta_lead_form',
    occurred_at: '2026-11-23T20:00:00Z',
    summary: null,
    raw: null,
    metadata: null,
    ...over,
  }
}

const fbSilk = row({ contact_id: 'p1', metadata: { tour_interest_raw: 'silk_road_–_18_days' } })
const webShanghai = row({
  contact_id: 'p2',
  channel: 'web_form',
  source: 'web_form',
  occurred_at: '2026-11-23T22:00:00Z',
  raw: '兴趣: China Discovery — Shanghai & Beyond\n留言: Two of us, call me on 021 555 1234 or a.b@example.com',
  metadata: { source_url: '/tours/china/discovery/shanghai-surroundings' },
})

describe('问的是哪个团', () => {
  it('Facebook 表单：下划线选项翻成人话', () => {
    expect(interestOf(fbSilk)).toBe('Silk road – 18 days')
    expect(humanizeOption('still_deciding_–_show_me_all')).toBe('Still deciding – show me all')
  })

  it('官网表单：取「兴趣」那一行；没有就退回页面地址', () => {
    expect(interestOf(webShanghai)).toBe('China Discovery — Shanghai & Beyond')
    expect(interestOf(row({ channel: 'web_form', raw: null, metadata: { source_url: '/tours/china/discovery/beijing-xian' } })))
      .toBe('Beijing xian (website page)')
  })

  it('🔴 「问哪个团」里客人写的电话邮箱也要掐掉', () => {
    const free = row({ metadata: { tour_interest_raw: 'Yellowstone, call me 021 555 1234 or x@y.com' } })
    const got = interestOf(free) ?? ''
    expect(got).toContain('Yellowstone')
    expect(got).not.toContain('555 1234')
    expect(got).not.toContain('@y.com')
  })

  it('完整网址也说成页面名', () => {
    expect(interestOf(row({ channel: 'web_form', raw: null, metadata: { source_url: 'https://www.ctstours.co.nz/tours/japan/explorer?x=1' } })))
      .toBe('Explorer (website page)')
  })

  it('认不出来就是 null，不编', () => {
    expect(interestOf(row({ metadata: {} }))).toBeNull()
    expect(interestOf(row({ channel: 'messenger' }))).toBeNull()
  })
})

describe('🔴 留言脱敏', () => {
  it('掐掉电话和邮箱，保留真有用的话', () => {
    const msg = messageOf(webShanghai) ?? ''
    expect(msg).toContain('Two of us')
    expect(msg).not.toContain('021 555 1234')
    expect(msg).not.toContain('@example.com')
  })

  it('官网表单接口存的是原样留言（没有「留言:」标签），也要读出来', () => {
    const plain = row({ channel: 'web_form', source: 'web_form', raw: 'Do you have tours for two elderly travellers?' })
    expect(messageOf(plain)).toBe('Do you have tours for two elderly travellers?')
  })

  it('回电预约的问答摘要不当留言', () => {
    expect(messageOf(row({ channel: 'web_form', source: 'site_callback_request', raw: 'pace: easy' }))).toBeNull()
  })

  it('有「兴趣:」没「留言:」= 客人没写话，不把兴趣当留言', () => {
    expect(messageOf(row({ channel: 'web_form', raw: '兴趣: General Inquiry' }))).toBeNull()
  })

  it('太长就截断', () => {
    const long = row({ channel: 'web_form', raw: `兴趣: X\n留言: ${'word '.repeat(200)}` })
    expect((messageOf(long) ?? '').length).toBeLessThanOrEqual(221)
  })
})

describe('一个人一行', () => {
  it('同一个人填了两张表只占一行，两个渠道都标出来', () => {
    const names = new Map([['p1', 'Mary Smith']])
    const twice = row({ contact_id: 'p1', channel: 'web_form', raw: '兴趣: General Inquiry\n留言: hi', occurred_at: '2026-11-23T23:00:00Z' })
    const { entries, orphans } = groupByPerson([twice, fbSilk], names)
    expect(entries).toHaveLength(1)
    expect(entries[0].channels).toEqual(['meta_lead_form', 'web_form'])
    expect(entries[0].interest).toBe('Silk road – 18 days')
    expect(entries[0].message).toBe('hi')
    expect(orphans).toBe(0)
  })

  it('查不到这个人照样列（不让他消失），并计入孤儿数', () => {
    const { entries, orphans } = groupByPerson([fbSilk], new Map())
    expect(entries).toHaveLength(1)
    expect(entries[0].contactId).toBeNull()
    expect(orphans).toBe(1)
  })

  it('私信 / WhatsApp 单独一段，不算进咨询数', () => {
    const chat = row({ contact_id: 'p3', channel: 'messenger', source: 'messenger' })
    const d = buildEnquiryDigest([fbSilk, webShanghai, chat], new Map([['p1', 'A'], ['p2', 'B'], ['p3', 'C']]))
    expect(d.enquiries).toHaveLength(2)
    expect(d.chats).toHaveLength(1)
  })

  it('ME 自己的测试线索不算进咨询数，只计数', () => {
    const d = buildEnquiryDigest([fbSilk, webShanghai], new Map([['p1', 'ME Test Lead 20261009'], ['p2', 'Real Person']]))
    expect(d.enquiries).toHaveLength(1)
    expect(d.testExcluded).toBe(1)
  })

  it('「问什么」按人头归类，多的在前', () => {
    const d = buildEnquiryDigest(
      [fbSilk, row({ contact_id: 'p4', metadata: { tour_interest_raw: 'silk_road_–_18_days' } }), webShanghai],
      new Map([['p1', 'A'], ['p2', 'B'], ['p4', 'D']]),
    )
    expect(topInterests(d.enquiries)[0]).toEqual({ interest: 'Silk road – 18 days', count: 2 })
  })
})

describe('「昨天」按新西兰日历日算', () => {
  it('11-25 早上 8:15（新西兰）→ 昨天 = 11-24 整天', () => {
    const now = new Date('2026-11-24T19:15:00Z') // NZDT 11-25 08:15
    const w = yesterdayWindow(now, TZ)
    expect(new Date(w.startMs).toISOString()).toBe('2026-11-23T11:00:00.000Z')
    expect(new Date(w.endMs).toISOString()).toBe('2026-11-24T11:00:00.000Z')
    expect(dayLabel(w.startMs, TZ)).toMatch(/24 Nov/)
  })

  it('换夏令时那天只有 23 小时，也不错位', () => {
    const now = new Date('2026-09-27T20:00:00Z') // NZDT 09-28 09:00；09-27 凌晨换季
    const w = yesterdayWindow(now, TZ)
    expect((w.endMs - w.startMs) / 3_600_000).toBe(23)
  })
})

describe('信的内容', () => {
  const digest = buildEnquiryDigest([fbSilk, webShanghai], new Map([['p1', 'Mary Smith'], ['p2', 'john@example.com']]))

  it('主题行说清几个咨询', () => {
    expect(buildEnquirySubject('CTS Tours NZ', 'Tue 24 Nov', digest)).toContain('2 new enquiries')
  })

  it('🔴 正文不带客人的邮箱和电话，但有直达后台的链接', () => {
    const html = buildEnquiryBody({ clientId: CLIENT, clientName: 'CTS Tours NZ', day: 'Tue 24 Nov', timeZone: TZ, digest })
    expect(html).not.toContain('@example.com')
    expect(html).not.toContain('555 1234')
    expect(html).toContain('/crm/all?contact=p1')
    expect(html).toContain('Silk road – 18 days')
  })

  it('0 个咨询也照说「0」，不装作没这封信', () => {
    const empty = buildEnquiryDigest([], new Map())
    const html = buildEnquiryBody({ clientId: CLIENT, clientName: 'CTS', day: 'Tue 24 Nov', timeZone: TZ, digest: empty })
    expect(html).toContain('No new enquiries')
    expect(buildEnquirySubject('CTS', 'Tue 24 Nov', empty)).toContain('0 new enquiries')
  })

  it('🔴 没有收件人就不发，不猜地址', async () => {
    const send = vi.fn()
    const mailer: DigestMailer = { emails: { send } }
    const r = await sendEnquiryDailyDigest({
      clientId: CLIENT, clientName: 'CTS', day: 'x', timeZone: TZ, digest,
      recipients: [], apiKey: 'k', mailerFactory: () => mailer,
    })
    expect(r.sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
