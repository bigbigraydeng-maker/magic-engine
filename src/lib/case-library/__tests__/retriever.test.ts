/**
 * Tests for src/lib/case-library/retriever.ts — P8.12.S2.2
 * TDD: retriever query logic + prompt formatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { retrieveSimilarCases, formatCasesForPrompt } from '../retriever'
import type { SimilarCaseResult } from '../retriever'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

function makeSupabaseMock(
  casesData: unknown[] = [],
  casesError: unknown = null,
  outcomesData: Record<string, unknown[]> = {},
) {
  const fromFn = vi.fn((table: string) => {
    if (table === 'prescription_cases') {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: casesData, error: casesError }),
      }
      return chain
    }
    if (table === 'prescription_outcomes') {
      const caseId = 'case-1' // single outcome fetch simulation
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: outcomesData[caseId] ?? [],
          error: null,
        }),
      }
      return chain
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
  })
  return { from: fromFn }
}

function makeCase(overrides: Partial<SimilarCaseResult> = {}): SimilarCaseResult {
  return {
    case_id: 'case-1',
    industry_category: 'tourism_operator',
    crisis_type: 'seo',
    monthly_budget_aud: 3000,
    market: 'AU',
    business_size: 'small',
    prescription_summary: 'Focus on local SEO and review management.',
    self_grade_overall: 8.2,
    outcome_kpis: [],
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Happy path — returns ranked cases
// ---------------------------------------------------------------------------

describe('retrieveSimilarCases — happy path', () => {
  it('returns empty array when no cases found', async () => {
    const supabase = makeSupabaseMock([])
    const result = await retrieveSimilarCases(supabase as never, {
      industry_category: 'tourism_operator',
    })
    expect(result).toEqual([])
  })

  it('returns up to limit cases when found', async () => {
    const rows = [
      { id: 'c1', industry_category: 'tourism_operator', crisis_type: 'seo',
        monthly_budget_aud: 3000, market: 'AU', business_size: 'small',
        prescription_summary: 'Summary A', self_grade_overall: 8.5, created_at: '2026-01-01T00:00:00Z' },
      { id: 'c2', industry_category: 'tourism_operator', crisis_type: 'social',
        monthly_budget_aud: 2000, market: 'AU', business_size: 'small',
        prescription_summary: 'Summary B', self_grade_overall: 7.0, created_at: '2026-02-01T00:00:00Z' },
    ]
    const supabase = makeSupabaseMock(rows)
    const result = await retrieveSimilarCases(supabase as never, {
      industry_category: 'tourism_operator',
      limit: 3,
    })
    expect(result).toHaveLength(2)
    expect(result[0].case_id).toBe('c1')
    expect(result[0].self_grade_overall).toBe(8.5)
  })

  it('maps DB row fields correctly', async () => {
    const row = {
      id: 'c1',
      industry_category: 'tourism_operator',
      crisis_type: 'reputation',
      monthly_budget_aud: 2500,
      market: 'NZ',
      business_size: 'small',
      prescription_summary: 'Manage reviews and improve presence.',
      self_grade_overall: 7.8,
      created_at: '2026-03-01T00:00:00Z',
    }
    const supabase = makeSupabaseMock([row])
    const [result] = await retrieveSimilarCases(supabase as never, {
      industry_category: 'tourism_operator',
    })
    expect(result.case_id).toBe('c1')
    expect(result.market).toBe('NZ')
    expect(result.prescription_summary).toBe('Manage reviews and improve presence.')
    expect(result.outcome_kpis).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Null / missing industry_category — returns empty without crashing
// ---------------------------------------------------------------------------

describe('retrieveSimilarCases — null industry_category', () => {
  it('returns empty array when industry_category is null', async () => {
    const supabase = makeSupabaseMock([])
    const result = await retrieveSimilarCases(supabase as never, {
      industry_category: null,
    })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. DB error — returns empty array (silent failure)
// ---------------------------------------------------------------------------

describe('retrieveSimilarCases — DB error silently returns []', () => {
  it('returns empty array on DB error', async () => {
    const supabase = makeSupabaseMock([], new Error('db timeout'))
    const result = await retrieveSimilarCases(supabase as never, {
      industry_category: 'tourism_operator',
    })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. formatCasesForPrompt
// ---------------------------------------------------------------------------

describe('formatCasesForPrompt', () => {
  it('returns empty string when no cases', () => {
    expect(formatCasesForPrompt([])).toBe('')
  })

  it('includes section header when cases present', () => {
    const cases = [makeCase()]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('## 历史相似案例参考')
  })

  it('includes case summary and grade', () => {
    const cases = [makeCase({ prescription_summary: 'Focus on GBP.', self_grade_overall: 8.2 })]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('Focus on GBP.')
    expect(text).toContain('8.2')
  })

  it('includes budget when present', () => {
    const cases = [makeCase({ monthly_budget_aud: 3000 })]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('3,000')
  })

  it('includes outcome KPIs when present', () => {
    const cases = [
      makeCase({
        outcome_kpis: [
          { kpi_metric: 'organic_traffic', actual_value: 1200, target_value: 1000, unit: '次/月', days_since_approval: 90 },
        ],
      }),
    ]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('organic_traffic')
    expect(text).toContain('1200')
  })

  it('includes no-outcome notice when outcome_kpis is empty', () => {
    const cases = [makeCase({ outcome_kpis: [] })]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('暂无实测数据')
  })

  it('renders multiple cases numbered', () => {
    const cases = [makeCase({ case_id: 'c1' }), makeCase({ case_id: 'c2' })]
    const text = formatCasesForPrompt(cases)
    expect(text).toContain('案例 1')
    expect(text).toContain('案例 2')
  })
})
