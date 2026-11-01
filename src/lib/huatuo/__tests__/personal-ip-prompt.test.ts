import { describe, expect, it } from 'vitest'
import { buildHuatuoGenerationPrompt, buildHuatuoSelfGradePrompt } from '../prompts'
import { readClientKind, readWeeklyShootCount } from '../personal-ip'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '../types'

const DISCOVERY = {
  domain: 'example.co.nz',
  business: { name: 'Example', industry: ['coaching'], location: { city: 'Auckland', country: 'NZ' } },
  social_profiles: [
    {
      platform: 'instagram',
      handle: '@someone',
      url: 'https://instagram.com/someone',
      confidence: 0.9,
      followers_count: 1200,
      posts_last_30d: 6,
      engagement_rate: 0.034,
    },
  ],
} as DiscoveryReport

const LOOKUP = {
  benchmarks: { seo: null, social: null, ai_visibility: null, reputation: null },
  industry_category: null,
} as HuatuoLookupContext

const standard: PrescriptionIntake = {
  business_goal: '多接到咨询',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  budget_currency: 'NZD',
  priority_dimensions: [],
  notes: null,
}

const personal: PrescriptionIntake = { ...standard, client_kind: 'personal_ip', weekly_shoot_count: 3 }

describe('personal IP prompt', () => {
  it('leaves the standard prompt byte-identical when no client kind is set', () => {
    const plain = buildHuatuoGenerationPrompt(DISCOVERY, standard, LOOKUP)
    const explicit = buildHuatuoGenerationPrompt(DISCOVERY, { ...standard, client_kind: 'standard' }, LOOKUP)
    expect(explicit).toBe(plain)
    expect(plain).not.toContain('个人 IP')
  })

  it('adds the three steps, the weekly shoot cap and the scanned raw numbers', () => {
    const prompt = buildHuatuoGenerationPrompt(DISCOVERY, personal, LOOKUP)
    expect(prompt).toContain('第 1–3 周 立人设')
    expect(prompt).toContain('第 4–7 周 放大加攒人')
    expect(prompt).toContain('前 20%')
    expect(prompt).toContain('60%')
    expect(prompt).toContain('第 8–12 周 把信任变成生意')
    expect(prompt).toContain('我是谁')
    expect(prompt).toContain('Messenger')
    expect(prompt).toContain('不要写小红书')
    expect(prompt).toContain('只作**展示参考**')
    expect(prompt).toContain('本人每周能拍**：3 条')
    expect(prompt).toContain('1200 粉丝')
    expect(prompt).toContain('近 30 天发帖 6 条')
    expect(prompt).toContain('互动率 3.4%')
    expect(prompt).toContain('不承诺涨粉')
  })

  it('says the shoot count is unknown instead of inventing one', () => {
    const prompt = buildHuatuoGenerationPrompt(DISCOVERY, { ...personal, weekly_shoot_count: null }, LOOKUP)
    expect(prompt).toContain('未提供')
  })

  it('says nothing was scanned when the profiles carry no numbers', () => {
    const bare = { ...DISCOVERY, social_profiles: [] } as unknown as DiscoveryReport
    expect(buildHuatuoGenerationPrompt(bare, personal, LOOKUP)).toContain('未扫描到粉丝数')
  })

  it('adds the self-grade check only for personal IP', () => {
    const rx = {} as PrescriptionContent
    expect(buildHuatuoSelfGradePrompt(rx, personal, LOOKUP)).toContain('有没有超过本人能拍的量')
    expect(buildHuatuoSelfGradePrompt(rx, standard, LOOKUP)).not.toContain('个人 IP')
  })
})

describe('client kind readers', () => {
  it('treats empty or unknown values as a standard client', () => {
    expect(readClientKind(null)).toBe('standard')
    expect(readClientKind(undefined)).toBe('standard')
    expect(readClientKind('whatever')).toBe('standard')
    expect(readClientKind('personal_ip')).toBe('personal_ip')
  })

  it('only accepts a positive whole number of posts per week', () => {
    expect(readWeeklyShootCount(3)).toBe(3)
    expect(readWeeklyShootCount('4')).toBe(4)
    expect(readWeeklyShootCount(0)).toBeNull()
    expect(readWeeklyShootCount(2.5)).toBeNull()
    expect(readWeeklyShootCount(null)).toBeNull()
  })
})
