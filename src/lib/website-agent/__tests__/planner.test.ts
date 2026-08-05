import { describe, expect, it } from 'vitest'
import type { StrategyItem } from '@/lib/strategy/types'
import { planWebsiteGrowth } from '../planner'
import type { WebsiteGrowthAgentInput, WebsitePageSignal } from '../types'

function page(overrides: Partial<WebsitePageSignal> = {}): WebsitePageSignal {
  return {
    id: 'page-1',
    url: 'https://example.com/service',
    title: 'Service',
    page_type: 'service',
    topics: [],
    primary_keyword: 'example service',
    word_count: 700,
    has_geo_block: true,
    status_code: 200,
    ...overrides,
  }
}

function strategy(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    id: 'strategy-1',
    client_id: 'client-1',
    strategy_run_id: 'run-1',
    action_type: 'new_blog',
    content_mode: 'unified',
    priority: 'high',
    priority_score: 80,
    proposed_title: 'Useful guide',
    rationale: 'A tracked keyword opportunity exists.',
    content_angle: null,
    source_page_id: null,
    source_query_id: null,
    source_keyword: 'useful guide',
    keyword_volume: 100,
    keyword_kd: 30,
    status: 'pending',
    linked_blog_post_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function input(overrides: Partial<WebsiteGrowthAgentInput> = {}): WebsiteGrowthAgentInput {
  return {
    clientId: 'client-1',
    domain: 'example.com',
    pages: [],
    strategyItems: [],
    now: new Date('2026-08-05T00:00:00.000Z'),
    ...overrides,
  }
}

describe('planWebsiteGrowth', () => {
  it('puts broken pages ahead of content and GEO work', () => {
    const plan = planWebsiteGrowth(input({
      pages: [page({ status_code: 404, word_count: 100, has_geo_block: false })],
      strategyItems: [strategy()],
    }))

    expect(plan.actions[0].action_type).toBe('website.repair_broken_page')
    expect(plan.actions[0].evidence_refs).toContain('status_code:404')
    expect(plan.actions).toHaveLength(3)
  })

  it('keeps GEO below core commercial-page quality work', () => {
    const plan = planWebsiteGrowth(input({
      pages: [page({ word_count: 120, has_geo_block: false })],
    }))

    expect(plan.actions[0].lane).toBe('content_intent')
    expect(plan.actions.find((action) => action.lane === 'ai_visibility')?.score)
      .toBeLessThan(plan.actions[0].score)
  })

  it('suppresses repeatedly dismissed suggestions', () => {
    const target = 'website:geo:example.com/service'
    const plan = planWebsiteGrowth(input({
      pages: [page({ has_geo_block: false })],
      feedback: {
        has_content: true,
        total: 2,
        state_counts: { done: 0, dismissed: 2, irrelevant: 0 },
        dismissed_keys: [target],
        irrelevant_keys: [],
        recent_events: [],
      },
    }))

    expect(plan.actions).toHaveLength(0)
    expect(plan.learning.suppressed_suggestions).toBe(1)
  })

  it('boosts a previously successful action family', () => {
    const plan = planWebsiteGrowth(input({
      pages: [page({ title: null })],
      memory: {
        preferences: [],
        proven_patterns: [],
        failed_experiments: [],
        recent_decisions: [{
          decision_context: 'website',
          chosen_action: 'cms_meta_update',
          alternatives_rejected: [],
          reasoning: 'Worked before',
          outcome_verdict: 'success',
          created_at: '2026-08-01T00:00:00.000Z',
        }],
        has_content: true,
      },
    }))

    expect(plan.actions[0].learning_adjustment).toBe(6)
    expect(plan.actions[0].learning_reasons).toContain('boosted by a successful prior decision')
  })

  it('returns at most the requested number of evidence-backed actions', () => {
    const plan = planWebsiteGrowth(input({
      pages: [
        page({ id: 'a', url: 'https://example.com/a', status_code: 404 }),
        page({ id: 'b', url: 'https://example.com/b', title: null }),
        page({ id: 'c', url: 'https://example.com/c', word_count: 20 }),
      ],
      maxActions: 2,
    }))

    expect(plan.actions).toHaveLength(2)
    expect(plan.actions.every((action) => action.evidence_refs.length > 0)).toBe(true)
  })
})

