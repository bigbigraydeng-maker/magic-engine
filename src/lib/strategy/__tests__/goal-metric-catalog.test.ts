import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { buildQualifiedMentionVerification } from '@/lib/geo-module/verification'
import {
  GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
  PRIMARY_METRIC_CATALOG,
  getRecommendedMetrics,
} from '@/types/strategy'
import { createGoal } from '../goals'

describe('GEO qualified mention Goal metric', () => {
  it('reuses the exact Verification identity once', () => {
    expect(GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY).toBe(
      buildQualifiedMentionVerification().metricRef,
    )

    const matches = PRIMARY_METRIC_CATALOG.filter(
      metric => metric.key === GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      measurement: 'verification',
      unit: 'qualified queries / pinned cohort',
      default_direction: 'increase',
    })
  })

  it.each(['new_market', 'event_campaign', 'geographic_expansion', 'reputation_recovery'] as const)(
    'is selectable for awareness/%s without a client-specific branch',
    subType => {
      const metrics = getRecommendedMetrics('awareness', subType)
      expect(metrics.map(metric => metric.key)).toContain(GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY)
    },
  )

  it('preserves the exact metric key through the existing Goal insert path', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'goal-1', primary_metric_key: GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY },
      error: null,
    })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient

    const result = await createGoal(supabase, 'client-1', {
      intent: 'awareness',
      sub_type: 'new_market',
      title: 'Governed GEO visibility lift',
      primary_metric_key: GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
      primary_metric_label: 'AI 合格提及覆盖',
      primary_metric_unit: 'qualified queries / pinned cohort',
      baseline_value: 1,
      target_value: 4,
      target_direction: 'increase',
      period_start: '2026-08-22',
      period_end: '2026-09-05',
      fde_reasoning: 'Final settlement requires the pinned cohort and governed Verification evidence.',
    })

    expect(result.ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-1',
      primary_metric_key: GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
      baseline_value: 1,
      target_value: 4,
    }))
  })
})
