/**
 * Mailchimp 读取层。
 *
 * 这份逻辑决定「谁该被排到销售名单最前面」，所以错了不是数字难看，
 * 是最热的客人被漏掉、或者根本没反应的人被当成热的去打扰。
 */

import { describe, expect, it } from 'vitest'
import {
  datacenterFromKey,
  toPercent,
  normaliseCampaign,
  mergeActivity,
  MailchimpError,
} from '../client'

describe('key 里的数据中心', () => {
  it('从 key 末尾取 host', () => {
    expect(datacenterFromKey('abc123def456-us14')).toBe('us14')
    expect(datacenterFromKey('  abc-us21  ')).toBe('us21')
  })

  /** 复制 key 时漏掉后缀是最常见的错。早点说人话，别等调用时甩一个 401。 */
  it('没后缀就当场说清楚，不留到调用时报 401', () => {
    expect(() => datacenterFromKey('abc123def456')).toThrow(MailchimpError)
    expect(() => datacenterFromKey('abc123def456')).toThrow(/数据中心/)
    expect(() => datacenterFromKey('')).toThrow()
  })
})

describe('比例换算', () => {
  it('0–1 小数换成百分数，保留一位', () => {
    expect(toPercent(0.582)).toBe(58.2)
    expect(toPercent(0.3333)).toBe(33.3)
    expect(toPercent(0)).toBe(0)
  })

  it('缺字段不炸，算 0', () => {
    expect(toPercent(undefined)).toBe(0)
    expect(toPercent(null)).toBe(0)
  })
})

describe('邮件汇总', () => {
  it('取标题、主题、发送时间和统计', () => {
    const c = normaliseCampaign({
      id: 'abc',
      settings: { title: 'Reborn E1 Enquiry R1', subject_line: '你的中国行' },
      send_time: '2026-07-06T09:00:00+00:00',
      emails_sent: 108,
      report_summary: { opens: 90, unique_opens: 62, clicks: 18, open_rate: 0.574, click_rate: 0.167 },
    })
    expect(c.title).toBe('Reborn E1 Enquiry R1')
    expect(c.emailsSent).toBe(108)
    expect(c.uniqueOpens).toBe(62)
    expect(c.openRate).toBe(57.4)
    expect(c.clickRate).toBe(16.7)
  })

  it('没有 report_summary 也不炸（刚发出去还没统计）', () => {
    const c = normaliseCampaign({ id: 'x', settings: {}, emails_sent: 0 })
    expect(c.openRate).toBe(0)
    expect(c.title).toBe('(未命名)')
    expect(c.sentAt).toBeNull()
  })
})

describe('合并「谁打开了」和「谁点了」', () => {
  it('两份名单合成每人一条', () => {
    const out = mergeActivity(
      [{ email_address: 'a@x.com', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'b@x.com', timestamp: '2026-07-20T02:00:00Z' }],
    )
    expect(out).toHaveLength(2)
    expect(out.find((m) => m.email === 'a@x.com')).toMatchObject({ opened: true, clicked: false })
    expect(out.find((m) => m.email === 'b@x.com')).toMatchObject({ clicked: true })
  })

  /**
   * 这条是这份文件的重点：Mailchimp 靠一个隐藏图片记「打开」，客户端拦图片时
   * 就记不到。于是会出现「点了链接但没算打开」—— 如果照搬，最热的那批人
   * （真的点进来看了行程）会被当成没反应，掉出销售名单。
   */
  it('点了链接就必然算看过 —— 图片被拦时 Mailchimp 记不到打开', () => {
    const out = mergeActivity([], [{ email_address: 'c@x.com', timestamp: '2026-07-20T03:00:00Z' }])
    expect(out[0]).toMatchObject({ email: 'c@x.com', opened: true, clicked: true })
  })

  it('同一个人在两份名单里 → 合成一条，两个标记都在', () => {
    const out = mergeActivity(
      [{ email_address: 'd@x.com', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'd@x.com', timestamp: '2026-07-20T05:00:00Z' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ opened: true, clicked: true })
    // 时间取最晚那次动作
    expect(out[0].lastActionAt).toBe('2026-07-20T05:00:00Z')
  })

  it('邮箱大小写和空格不算两个人', () => {
    const out = mergeActivity(
      [{ email_address: '  Dave@Outlook.com ', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'dave@outlook.com', timestamp: '2026-07-20T02:00:00Z' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0].email).toBe('dave@outlook.com')
  })

  it('脏数据（没邮箱 / 空串）直接丢掉，不制造幽灵联系人', () => {
    const out = mergeActivity(
      [{ last_open: '2026-07-20T01:00:00Z' }, { email_address: '   ' }],
      [{ email_address: undefined }],
    )
    expect(out).toHaveLength(0)
  })

  it('两边都空 → 空数组，不炸', () => {
    expect(mergeActivity([], [])).toEqual([])
  })
})
