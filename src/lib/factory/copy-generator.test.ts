// P21.J A3 — copy-generator 测试(魏征点名:url 强锁防幻觉域名 + fallback + 校验不过走 fallback)

import { describe, expect, it, vi, beforeEach } from 'vitest'

const callClaudeChat = vi.fn()
vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: (...a: unknown[]) => callClaudeChat(...a),
  parseJsonResponse: (t: string) => JSON.parse(t),
}))
// formatBriefForPrompt 用真实实现(读 fixture brief 字段即可,无需 mock)

import { ctaIntentFor, generateAdCopy, hookIntentFor } from './copy-generator'
import type { MasterBrief } from '@/types/magic-engine'

const BRIEF = {
  id: 'mb-1', brand_name: 'Oztop', website: 'oztopbuildingsupplies.com.au',
  vi_style_keywords: ['warm'], vi_dos: ['show product'], vi_donts: ['no stock photos'],
  tone: 'friendly',
} as unknown as MasterBrief

const ROLES: Array<'hook' | 'middle' | 'cta'> = ['hook', 'middle', 'cta']

// 触发 catch→fallback 分支:resolve 一段解析不了的 JSON(等价于 LLM 挂/超时,走同一个 fallback)
const BAD_JSON = { text: 'not valid json at all' }

beforeEach(() => callClaudeChat.mockReset())

describe('generateAdCopy', () => {
  it('🔴 LLM 填了别的域名 → endcard.url 被强锁回 master_brief.website(防幻觉)', async () => {
    callClaudeChat.mockResolvedValue({
      text: JSON.stringify({
        segments: [{ role: 'hook', title_sub: 'A' }, { role: 'middle', caption: 'B' }, { role: 'cta', caption: 'C' }],
        endcard: { cta: 'Visit', offer: [], url: 'https://evil-competitor.com' },
      }),
    })
    const copy = await generateAdCopy({ brief: BRIEF, angle: 'floors', rationale: 'why', segmentRoles: ROLES })
    expect(copy.endcard.url).toBe('oztopbuildingsupplies.com.au') // 不是 evil-competitor.com
  })

  it('LLM 挂/坏返回 → 品牌接地模板 fallback(用 brand_name,不硬编 CTS)', async () => {
    callClaudeChat.mockResolvedValue(BAD_JSON)
    const copy = await generateAdCopy({ brief: BRIEF, angle: 'flooring', rationale: 'why', segmentRoles: ROLES })
    expect(copy.segments.length).toBe(3)
    expect(copy.endcard.url).toBe('oztopbuildingsupplies.com.au')
    expect(JSON.stringify(copy)).not.toContain('CTS')
    expect(JSON.stringify(copy)).not.toContain('ctstours')
  })

  it('模板 fallback 按 Goal 微调 CTA:营收/线索 → 行业中立行动号召(不编行业专属服务承诺)', async () => {
    callClaudeChat.mockResolvedValue(BAD_JSON)
    const rev = await generateAdCopy({ brief: BRIEF, angle: 'walnut clearance', rationale: 'why', segmentRoles: ROLES, expectedMetric: 'monthly_revenue' })
    expect(rev.endcard.cta).toBe('Enquire now') // 魏征 B4-P1:不硬编 'Free measure & quote' 地板专属承诺
    expect(JSON.stringify(rev)).not.toMatch(/\$\d|\d+\s*%/)
    const brandGoal = await generateAdCopy({ brief: BRIEF, angle: 'flooring', rationale: 'why', segmentRoles: ROLES, expectedMetric: 'brand_search_volume' })
    expect(brandGoal.endcard.cta).toContain('Discover')
  })

  it('🔴 LLM 无视禁数字吐编造价格($29/40% off) → 整条落模板(红线代码硬拦,非空架子)', async () => {
    // 关键:这是合法 JSON、段数够、endcard 全——旧代码(无 output 拦截)会原样放行 → 数字上客户成片。
    callClaudeChat.mockResolvedValue({
      text: JSON.stringify({
        segments: [
          { role: 'hook', title_main: '$29/m² WALNUT', title_sub: 'was $59' },
          { role: 'middle', caption: '40% off this week' },
          { role: 'cta', caption: 'ends soon' },
        ],
        endcard: { cta: 'Save 40%', offer: ['$29/m²'], url: 'oztopbuildingsupplies.com.au' },
      }),
    })
    const copy = await generateAdCopy({ brief: BRIEF, angle: 'walnut clearance', rationale: 'why', segmentRoles: ROLES, expectedMetric: 'monthly_revenue' })
    expect(JSON.stringify(copy)).not.toMatch(/\$\s*\d|\d+\s*%/) // 被拦回模板 = 零编造数字
    expect(copy.endcard.cta).toBe('Enquire now') // 拿到的是模板中立 CTA,不是 LLM 的 'Save 40%'
  })

  it('LLM 返回段数不够 → 走 fallback(不放行残缺文案)', async () => {
    callClaudeChat.mockResolvedValue({
      text: JSON.stringify({ segments: [{ role: 'hook' }], endcard: { cta: 'x', offer: [], url: '' } }),
    })
    const copy = await generateAdCopy({ brief: BRIEF, angle: 'floors', rationale: 'why', segmentRoles: ROLES })
    expect(copy.segments.length).toBe(3) // fallback 补齐 3 段
  })

  it('brief 无 website → url 空(不瞎填,红线安全)', async () => {
    callClaudeChat.mockResolvedValue(BAD_JSON)
    const noUrl = { ...BRIEF, website: undefined } as unknown as MasterBrief
    const copy = await generateAdCopy({ brief: noUrl, angle: 'a', rationale: 'w', segmentRoles: ROLES })
    expect(copy.endcard.url).toBe('')
  })

  it('brief 无 brand_name → 英文中性词兜底(不让中文串进英文广告)', async () => {
    callClaudeChat.mockResolvedValue(BAD_JSON)
    const noBrand = { ...BRIEF, brand_name: undefined } as unknown as MasterBrief
    const copy = await generateAdCopy({ brief: noBrand, angle: 'a', rationale: 'w', segmentRoles: ROLES })
    expect(JSON.stringify(copy)).not.toContain('这个品牌')
    expect(copy.endcard.cta).toContain('our brand')
  })
})

describe('ctaIntentFor — B3 文案 CTA 导向 Goal 北极星(诸葛亮硬验收)', () => {
  it('brand_search_volume → 拉品牌搜索(去搜品牌)', () => {
    expect(ctaIntentFor('brand_search_volume')).toContain('品牌搜索')
  })
  it('monthly_revenue → 转化/清仓抢购', () => {
    expect(ctaIntentFor('monthly_revenue')).toContain('转化')
  })
  it('leads_count → 拿线索', () => {
    expect(ctaIntentFor('leads_count')).toContain('线索')
  })
  it('未知/null 指标 → 品牌认知兜底(不炸)', () => {
    expect(ctaIntentFor(null)).toContain('品牌认知')
    expect(ctaIntentFor(undefined)).toContain('品牌认知')
    expect(ctaIntentFor('weird_metric')).toContain('品牌认知')
  })
})

describe('hookIntentFor — B4 钩子导向 Goal 北极星(板桥:hook 是生死线)', () => {
  it('monthly_revenue → 清仓/紧迫感', () => {
    expect(hookIntentFor('monthly_revenue')).toMatch(/清仓|紧迫|限时/)
  })
  it('brand_search_volume → 品牌记忆/去搜', () => {
    expect(hookIntentFor('brand_search_volume')).toContain('品牌记忆')
  })
  it('未知/null 指标 → 停手指兜底(不炸)', () => {
    expect(hookIntentFor(null)).toContain('停手指')
    expect(hookIntentFor(undefined)).toContain('停手指')
    expect(hookIntentFor('weird_metric')).toContain('停手指')
  })
})
