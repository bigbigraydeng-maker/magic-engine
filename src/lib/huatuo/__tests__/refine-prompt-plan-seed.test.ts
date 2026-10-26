import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'm',
  parseJsonResponse: JSON.parse,
  getAnthropicClient: () => ({}),
  extractText: (blocks: Array<{ text?: string }>) => blocks.map((b) => b.text ?? '').join(''),
}))

import { generatePrescriptionWithFeedback, withoutPlanSeed } from '../agent'
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

function makePreviousContent(): PrescriptionContent {
  const content = {
    summary: 'prev',
    narrative: '',
    phases: [
      {
        phase_number: 1,
        name: 'Phase 1',
        duration_weeks: 4,
        actions: [],
        initiative_seed: {
          initiative_type: 'demand_generation',
          title: 'Lead capture',
          posture: 'fast',
          budget_percent: 40,
          hypothesis: null,
          ad_plays: [{ step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' }],
        },
      },
    ],
    kpi_targets: [],
    budget_allocation: [],
    plan_seed: {
      ad_steps: [
        {
          ad_account_id: { ok: true, value: 'act_9876543210' },
          daily_budget_cents: 123456,
        },
      ],
      notes: ['FIXTURE_PLAN_SEED_MARKER'],
    },
  }
  return content as unknown as PrescriptionContent
}

function makeFakeClient() {
  const create = vi.fn(async (..._args: unknown[]) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          summary: 's',
          phases: [],
          kpi_targets: [],
          budget_allocation: [],
        }),
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'end_turn',
  }))
  return { client: { messages: { create } } as unknown as Parameters<typeof generatePrescriptionWithFeedback>[0], create }
}

describe('withoutPlanSeed', () => {
  it('returns a copy without plan_seed and does not mutate the input', () => {
    const input = makePreviousContent()
    const stripped = withoutPlanSeed(input)

    expect(stripped).not.toBe(input)
    expect('plan_seed' in stripped).toBe(false)
    expect(stripped.summary).toBe(input.summary)
    expect(stripped.phases).toBe(input.phases)
    expect(stripped.kpi_targets).toBe(input.kpi_targets)
    expect(stripped.budget_allocation).toBe(input.budget_allocation)

    expect(input.plan_seed).toBeDefined()
  })
})

describe('generatePrescriptionWithFeedback prompt hygiene', () => {
  it('strips plan_seed from the previous-content block but keeps ad_plays', async () => {
    const { client, create } = makeFakeClient()
    const previousContent = makePreviousContent()

    await generatePrescriptionWithFeedback(client, DISCOVERY, intake, LOOKUP, {
      previousContent,
      weaknesses: [],
    })

    expect(create).toHaveBeenCalledTimes(1)
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const prompt = call.messages[0].content

    expect(prompt).not.toContain('act_9876543210')
    expect(prompt).not.toContain('123456')
    expect(prompt).not.toContain('FIXTURE_PLAN_SEED_MARKER')
    expect(prompt).not.toContain('plan_seed')

    expect(prompt).toContain('lead_form_harvest')
    expect(prompt).toContain('上一轮处方 JSON')
  })

  it('does not mutate the caller previousContent (plan_seed still present)', async () => {
    const { client } = makeFakeClient()
    const previousContent = makePreviousContent()

    await generatePrescriptionWithFeedback(client, DISCOVERY, intake, LOOKUP, {
      previousContent,
      weaknesses: [],
    })

    expect(previousContent.plan_seed).toBeDefined()
  })
})
