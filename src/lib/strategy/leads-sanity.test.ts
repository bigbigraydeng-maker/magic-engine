import { describe, it, expect } from 'vitest'
import { judgeLeadsSanity } from './leads-sanity'

describe('judgeLeadsSanity —— 客资数值不值得信', () => {
  it('🔴 CTS 真实数据：341 个客资 vs 86 次开始填表 → 不可信', () => {
    // 2026-08-04 从 GA4 直接拉的真数，别改成"看起来合理"的假数据
    const v = judgeLeadsSanity({ keyEventsByName: { generate_lead: 341 }, formStarts: 86 })
    expect(v.trustworthy).toBe(false)
    if (!v.trustworthy) {
      expect(v.reason).toBe('exceeds_form_starts')
      expect(v.humanReason).toContain('341')
      expect(v.humanReason).toContain('86')
      // 要说清楚「所以呢」，不能只报数
      expect(v.humanReason).toContain('触发条件')
    }
  })

  it('客资少于开始填表 → 正常（大部分人填一半跑了）', () => {
    expect(judgeLeadsSanity({ keyEventsByName: { generate_lead: 20 }, formStarts: 86 }).trustworthy).toBe(true)
  })

  it('客资刚好等于开始填表 → 也算正常，不吹毛求疵', () => {
    expect(judgeLeadsSanity({ keyEventsByName: { generate_lead: 86 }, formStarts: 86 }).trustworthy).toBe(true)
  })

  it('🔴 客户根本不用表单（开始填表为 0）→ 不拿它当分母冤枉人', () => {
    // 全靠电话/微信进线的客户，form_start 天然是 0，
    // 这时候用「客资 > 填表」去判会把每个这样的客户都误报一遍
    const v = judgeLeadsSanity({ keyEventsByName: { generate_lead: 50 }, formStarts: 0 })
    expect(v.trustworthy).toBe(true)
  })

  it('🔴 好几种事件都算客资 → 这个数是几件事加一起，没法对目标', () => {
    const v = judgeLeadsSanity({
      keyEventsByName: { generate_lead: 12, purchase: 3, sign_up: 5 },
      formStarts: 100,
    })
    expect(v.trustworthy).toBe(false)
    if (!v.trustworthy) {
      expect(v.reason).toBe('multiple_key_events')
      // 要列出到底是哪几种，不能只说「有多种」
      expect(v.humanReason).toContain('generate_lead')
      expect(v.humanReason).toContain('purchase')
      expect(v.humanReason).toContain('sign_up')
    }
  })

  it('🔴 一个关键事件都没标 → 说清「不是真的没人问」，别让人以为生意黄了', () => {
    const v = judgeLeadsSanity({ keyEventsByName: {}, formStarts: 40 })
    expect(v.trustworthy).toBe(false)
    if (!v.trustworthy) {
      expect(v.reason).toBe('no_key_events')
      expect(v.humanReason).toContain('不是真的没人问')
    }
  })

  it('全是 0 次的关键事件也按「没标」处理', () => {
    const v = judgeLeadsSanity({ keyEventsByName: { generate_lead: 0 }, formStarts: 40 })
    expect(v.trustworthy).toBe(false)
    if (!v.trustworthy) expect(v.reason).toBe('no_key_events')
  })

  it('单一事件 + 数量合理 → 可信', () => {
    expect(judgeLeadsSanity({ keyEventsByName: { generate_lead: 30 }, formStarts: 120 }).trustworthy).toBe(true)
  })
})
