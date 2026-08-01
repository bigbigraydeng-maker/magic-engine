/**
 * 邮件在时间线上叫什么。
 *
 * 2026-08-02 PM 反馈：CRM 里出现「打开了《 (copy 01)》」，看不懂。根因是有人在
 * Mailchimp 里复制邮件没改名，campaign 的内部名字面就是 " (copy 01)"，而旧逻辑
 * `title || subject` 认为它非空即有效。
 */

import { describe, expect, it } from 'vitest'
import { campaignLabel } from '../sync'

describe('campaignLabel', () => {
  it('🔴 内部名是「(copy 01)」这种垃圾 → 用主题，不用它', () => {
    expect(campaignLabel({ title: ' (copy 01)', subject: 'no visa needed for China' }))
      .toBe('no visa needed for China')
  })

  it('主题优先于内部名 —— 主题才是客户看到的那行字', () => {
    expect(campaignLabel({ title: 'auto_e3_batch_20260716', subject: '4 天后出发的团还有位' }))
      .toBe('4 天后出发的团还有位')
  })

  it('去掉 Mailchimp 的合并标记，别把 *|FNAME|* 铺给销售看', () => {
    expect(campaignLabel({ title: '', subject: 'Kia ora *|FNAME|* — no visa needed for China' }))
      .toBe('Kia ora — no visa needed for China')
  })

  it('没有主题就退回内部名（总比没有强）', () => {
    expect(campaignLabel({ title: 'auto_e2_batch_20260718', subject: '' }))
      .toBe('auto_e2_batch_20260718')
  })

  it('两个都是垃圾 → 「一封邮件」，宁可不说也不铺内部标签', () => {
    expect(campaignLabel({ title: '(未命名)', subject: '' })).toBe('一封邮件')
    expect(campaignLabel({ title: 'copy of Newsletter', subject: '   ' })).toBe('一封邮件')
    expect(campaignLabel({})).toBe('一封邮件')
  })
})
