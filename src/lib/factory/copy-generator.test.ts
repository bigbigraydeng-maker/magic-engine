// P21.J A3 — copy-generator 测试(魏征点名:url 强锁防幻觉域名 + fallback + 校验不过走 fallback)

import { describe, expect, it, vi, beforeEach } from 'vitest'

const callClaudeChat = vi.fn()
vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: (...a: unknown[]) => callClaudeChat(...a),
  parseJsonResponse: (t: string) => JSON.parse(t),
}))
// formatBriefForPrompt 用真实实现(读 fixture brief 字段即可,无需 mock)

import { generateAdCopy } from './copy-generator'
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
