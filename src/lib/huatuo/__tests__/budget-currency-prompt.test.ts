import { describe, expect, it } from 'vitest'
import { buildHuatuoGenerationPrompt, buildHuatuoSelfGradePrompt } from '../prompts'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '../types'

const DISCOVERY = {
  domain: 'example.co.nz',
  business: { name: 'Example', industry: ['tours'], location: { city: 'Auckland', country: 'NZ' } },
} as DiscoveryReport

const LOOKUP = {
  benchmarks: { seo: null, social: null, ai_visibility: null, reputation: null },
  industry_category: 'inbound_tour_operator',
} as HuatuoLookupContext

const intake: PrescriptionIntake = {
  business_goal: '多接到咨询',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  budget_currency: 'NZD',
  priority_dimensions: [],
  notes: null,
}

describe('huatuo prompt budget currency', () => {
  it('writes NZ$3,000 as NZD in the generation prompt and does not call it AUD', () => {
    const prompt = buildHuatuoGenerationPrompt(DISCOVERY, intake, LOOKUP)
    expect(prompt).toContain('NZ$3,000.00')
    expect(prompt).toContain('3000 NZD')
    expect(prompt).not.toContain('AUD 3000')
    expect(prompt).not.toContain('AUD $3000')
    expect(prompt).toContain('不要换算成别的币种')
  })

  it('uses the same currency in the self-grade prompt', () => {
    const prompt = buildHuatuoSelfGradePrompt({} as PrescriptionContent, intake, LOOKUP)
    expect(prompt).toContain('3000 NZD')
    expect(prompt).not.toContain('AUD 3000')
  })
})
