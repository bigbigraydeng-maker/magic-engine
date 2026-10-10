/**
 * formatEmailPerformance — 邮件渠道历史表现格式化。
 *
 * 只测这个纯函数：调用方（route.ts）负责"只有客户配了邮件渠道才调用"这道闸，
 * 本函数本身只管把传进来的数据格式化成 prompt 文本，不做业务判断。
 */

import { describe, expect, it } from 'vitest'
import { formatEmailPerformance } from '../generator'

describe('formatEmailPerformance', () => {
  it('有历史发送记录时，逐条列出日期/主题/发送量/打开率/点击率', () => {
    const text = formatEmailPerformance(
      [
        {
          title: 'auto_e1_batch_20260901',
          subject: 'Your China itinerary inside',
          sentAt: '2026-09-01T20:14:15+00:00',
          emailsSent: 192,
          openRate: 46.8,
          clickRate: 13.2,
        },
      ],
      0,
    )
    expect(text).toContain('2026-09-01')
    expect(text).toContain('Your China itinerary inside')
    expect(text).toContain('sent to 192')
    expect(text).toContain('open rate 46.8%')
    expect(text).toContain('click rate 13.2%')
  })

  it('没有历史发送记录时，明确说明"没有历史"而不是留空', () => {
    const text = formatEmailPerformance([], 0)
    expect(text).toContain('No campaigns sent in the last 60 days')
  })

  it('主题为空时退回 title，不留空白', () => {
    const text = formatEmailPerformance(
      [{ title: 'auto_e2_batch_20260718', subject: '', sentAt: '2026-07-18T20:27:45+00:00', emailsSent: 50, openRate: 52, clickRate: 8 }],
      0,
    )
    expect(text).toContain('auto_e2_batch_20260718')
  })

  it('最近 7 天有自动欢迎序列触达时，标注碰撞提示', () => {
    const text = formatEmailPerformance([], 12)
    expect(text).toContain('12 contact(s) received an automated welcome-sequence email')
  })

  it('最近 7 天没有自动欢迎序列触达时，明确说明"没有"', () => {
    const text = formatEmailPerformance([], 0)
    expect(text).toContain('No automated welcome-sequence activity detected')
  })
})
