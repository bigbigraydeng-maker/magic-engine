/**
 * DAPE W3 — Tests for the prescription `narrative` field plumbing.
 *
 * Verifies:
 *   1. The generation system prompt instructs Claude to emit `narrative`.
 *   2. The normalizer accepts an optional `narrative` string and defaults to ''.
 *   3. The normalizer tolerates legacy responses (no narrative field) without
 *      breaking shape.
 *
 * We don't hit Anthropic — we exercise the deterministic parts only.
 */

import { describe, it, expect } from 'vitest'
import {
  HUATUO_GENERATION_SYSTEM_PROMPT,
  buildHuatuoGenerationPrompt,
} from '../prompts'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '../types'

// Re-export the normalizer for testing. It's not exported by `agent.ts`, so we
// re-implement the contract here via the public seam: simulate parseJsonResponse
// returning Partial<PrescriptionContent> and assert what the agent would do.
// (If the contract changes we'll catch it because the test imports the type.)
import type { PrescriptionContent } from '@/types/diagnostic'

/**
 * Mirror of normalizePrescriptionContent — kept in lockstep with agent.ts.
 * Updated alongside agent.ts in this same DAPE W3 PR; a future split should
 * make this an exported pure function.
 */
function normalizePrescriptionContent(
  p: Partial<PrescriptionContent>,
): PrescriptionContent {
  return {
    summary: typeof p.summary === 'string' ? p.summary : '',
    narrative: typeof p.narrative === 'string' ? p.narrative : '',
    phases: Array.isArray(p.phases)
      ? p.phases.map(ph => ({
          phase_number: typeof ph.phase_number === 'number' ? ph.phase_number : 0,
          name: typeof ph.name === 'string' ? ph.name : '',
          duration_weeks: typeof ph.duration_weeks === 'number' ? ph.duration_weeks : 0,
          actions: Array.isArray(ph.actions) ? ph.actions : [],
        }))
      : [],
    kpi_targets: Array.isArray(p.kpi_targets) ? p.kpi_targets : [],
    budget_allocation: Array.isArray(p.budget_allocation) ? p.budget_allocation : [],
  }
}

describe('huatuo prescription narrative plumbing', () => {
  describe('prompt', () => {
    it('system prompt mentions narrative in the output schema', () => {
      expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain('"narrative"')
      expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/200.*400/)
    })

    it('generation prompt is built without crashing when no priorContext / memoryContext given', () => {
      const discovery = makeFakeDiscovery()
      const intake = makeFakeIntake()
      const lookup = makeFakeLookup()
      const out = buildHuatuoGenerationPrompt(discovery, intake, lookup)
      expect(typeof out).toBe('string')
      expect(out.length).toBeGreaterThan(100)
    })
  })

  describe('normalizePrescriptionContent', () => {
    it('preserves narrative when present', () => {
      const result = normalizePrescriptionContent({
        summary: 'short',
        narrative: '本周最大问题是 SEO 流量持续下滑。处方分 3 阶段……',
        phases: [],
        kpi_targets: [],
        budget_allocation: [],
      })
      expect(result.narrative).toContain('SEO 流量')
    })

    it('defaults narrative to empty string when missing', () => {
      const result = normalizePrescriptionContent({
        summary: 'short',
        phases: [],
        kpi_targets: [],
        budget_allocation: [],
      })
      expect(result.narrative).toBe('')
    })

    it('treats non-string narrative as missing', () => {
      const result = normalizePrescriptionContent({
        summary: '',
        // simulate Claude returning null
        narrative: null as unknown as string,
        phases: [],
        kpi_targets: [],
        budget_allocation: [],
      })
      expect(result.narrative).toBe('')
    })
  })
})

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeFakeDiscovery(): DiscoveryReport {
  return {
    domain: 'example.com.au',
    business: {
      name: 'Example AU',
      industry: ['tourism'],
      location: { country: 'AU', city: 'Sydney' },
    },
    diagnosis: {
      crisis_type: 'reputation_decline',
      key_finding: 'reviews dropped',
      scores: {
        seo: 60, social: 40, reputation: 30, ai_visibility: 50, overall: 45,
      },
      actions: {
        quick_fix: ['Reply to top 5 negative reviews'],
        important: ['Set up GBP review automation'],
        talk_to_us: [],
      },
    },
  } as unknown as DiscoveryReport
}

function makeFakeIntake(): PrescriptionIntake {
  // Test fixture: only the fields the prompt builder reads matter.
  // Cast through `unknown` because the real type carries more required props
  // that aren't relevant to this narrative-plumbing test.
  return ({
    business_goal: 'rebuild reputation',
    timeline_urgency: 'medium',
    monthly_budget_aud: 3000,
    priority_dimensions: ['reputation'],
    notes: null,
  } as unknown) as PrescriptionIntake
}

function makeFakeLookup(): HuatuoLookupContext {
  return ({
    benchmarks: {},
    industry_category: 'tourism',
    trend_summary: null,
    seasonal_calendar: null,
    industry_interest: null,
    similar_cases: null,
    outcome_confidence: {},
  } as unknown) as HuatuoLookupContext
}
