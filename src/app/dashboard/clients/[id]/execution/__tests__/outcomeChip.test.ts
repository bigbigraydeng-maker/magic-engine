import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AUTONOMOUS_GROUP_ID, buildExecutionGroups, formatOutcomeLabel } from '../execution-view-model'

type OutcomeSummary = Parameters<typeof formatOutcomeLabel>[0]
type ExecutionGroupItem = Parameters<typeof buildExecutionGroups>[0][number]

const executionPageSource = readFileSync(
  join(process.cwd(), 'src', 'app', 'dashboard', 'clients', '[id]', 'execution', 'page.tsx'),
  'utf8',
)

const baseOutcome: OutcomeSummary = {
  verdict: 'confirmed',
  metric_key: 'geo.query.mention_rate',
  delta: 0.25,
  delta_pct: 25,
  confidence: 0.8,
  computed_at: '2026-05-17T00:00:00Z',
}

const baseItem: ExecutionGroupItem = {
  id: 'item-1',
  prescription_id: 'prescription-1',
  client_id: 'client-1',
  finding_id: null,
  dimension: 'seo',
  phase: 1,
  title: 'Fix title',
  description: 'Fix the title',
  fix_type: 'me_auto',
  status: 'pending',
  steps_json: null,
  execution_target: null,
  assigned_to: null,
  due_date: null,
  started_at: null,
  completed_at: null,
  sort_order: 1,
  created_at: '2026-05-22T00:00:00Z',
  updated_at: '2026-05-22T00:00:00Z',
  content_post_id: null,
  source: 'diagnostic',
  marketing_plan_id: null,
  logs: [],
  outcome: null,
  linked_post: null,
}

const approvedPrescription = [
  {
    id: 'prescription-1',
    status: 'approved' as const,
    supplements_id: null,
    supersedes_id: null,
    generated_at: '2026-05-21T00:00:00Z',
  },
]

describe('formatOutcomeLabel', () => {
  it('renders a positive delta_pct with a plus sign', () => {
    expect(formatOutcomeLabel(baseOutcome)).toBe('Mention rate +25%, confirmed (confidence 0.80)')
  })

  it('renders a negative delta_pct with a minus sign', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      verdict: 'reversed',
      delta_pct: -12,
      delta: -0.12,
      confidence: 0.6,
    })).toBe('Mention rate -12%, reversed (confidence 0.60)')
  })

  it('renders zero delta_pct as 0%', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      delta_pct: 0,
    })).toBe('Mention rate 0%, confirmed (confidence 0.80)')
  })

  it('falls back to fixed delta when delta_pct is null', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      delta_pct: null,
      delta: 0.071,
    })).toBe('Mention rate +0.07, confirmed (confidence 0.80)')
  })

  it('omits delta text when both delta_pct and delta are null', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      delta_pct: null,
      delta: null,
    })).toBe('Mention rate confirmed (confidence 0.80)')
  })

  it('formats confidence with two decimal places', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      verdict: 'inconclusive',
      delta_pct: 1,
      confidence: 0.236,
    })).toBe('Mention rate +1%, inconclusive (confidence 0.24)')
  })
})

describe('VERDICT_META fallback', () => {
  it('falls back to inconclusive styling for unknown verdict strings', () => {
    expect(executionPageSource).toMatch(/VERDICT_META\[outcome\.verdict\]\s*\?\?\s*VERDICT_META\.inconclusive/)
  })

  it('keeps confirmed label text and green styling', () => {
    expect(formatOutcomeLabel(baseOutcome)).toContain('confirmed')
    expect(executionPageSource).toContain('bg-green-50 border-green-200 text-green-700')
  })

  it('keeps inconclusive label text and yellow styling', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      verdict: 'inconclusive',
      delta_pct: 1,
      confidence: 0.2,
    })).toContain('inconclusive')
    expect(executionPageSource).toContain('bg-yellow-50 border-yellow-200 text-yellow-700')
  })

  it('keeps reversed label text and red styling', () => {
    expect(formatOutcomeLabel({
      ...baseOutcome,
      verdict: 'reversed',
      delta_pct: -5,
      delta: -0.05,
      confidence: 0.5,
    })).toContain('reversed')
    expect(executionPageSource).toContain('bg-red-50 border-red-200 text-red-700')
  })
})

describe('buildExecutionGroups', () => {
  it('returns an empty array when there are no items', () => {
    expect(buildExecutionGroups([], approvedPrescription)).toEqual([])
  })

  it('keeps autonomous items out of prescription groups when every item is autonomous', () => {
    const groups = buildExecutionGroups([
      {
        ...baseItem,
        id: 'action-1',
        prescription_id: AUTONOMOUS_GROUP_ID,
        title: 'Generate GEO post',
        status: 'completed',
        source_kind: 'flywheel_action',
        flywheel_action_id: 'action-1',
      },
      {
        ...baseItem,
        id: 'action-2',
        prescription_id: AUTONOMOUS_GROUP_ID,
        title: 'Generate SEO post',
        status: 'completed',
        source_kind: 'flywheel_action',
        flywheel_action_id: 'action-2',
      },
    ], approvedPrescription)

    expect(groups).toHaveLength(1)
    expect(groups[0].pid).toBe(AUTONOMOUS_GROUP_ID)
    expect(groups[0].items).toHaveLength(2)
  })

  it('keeps outcome-backed flywheel actions in the autonomous lane', () => {
    const groups = buildExecutionGroups([
      baseItem,
      {
        ...baseItem,
        id: 'action-1',
        prescription_id: AUTONOMOUS_GROUP_ID,
        title: 'Generate NZ tours post',
        status: 'completed',
        source_kind: 'flywheel_action',
        flywheel_action_id: 'action-1',
        outcome: baseOutcome,
      },
    ], approvedPrescription)

    expect(groups[0].pid).toBe(AUTONOMOUS_GROUP_ID)
    expect(groups[0].label).toBe('\u98de\u8f6e\u81ea\u4e3b\u884c\u52a8')
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].outcome).toEqual(baseOutcome)
    expect(groups[1].pid).toBe('prescription-1')
  })
})
