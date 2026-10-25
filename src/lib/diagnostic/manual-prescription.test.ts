import { describe, expect, it } from 'vitest'
import {
  MANUAL_PRESCRIPTION_AGENT,
  goalIdsWithManualDraft,
  isManualDraftRow,
  parseManualPaste,
  parseManualPrescriptionBody,
} from './manual-prescription'

const CLIENT = 'client-1'

function action(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    phase: 1,
    title: '建成暂停',
    description: '人工执行',
    dimension: 'ads',
    fix_type: 'fde_manual',
    module: 'manual',
    execution_target: { flywheel: 'ads', mode: 'external_manual', vendor: 'fde' },
    effort: 'low',
    impact: 'high',
    finding_ids: [],
    ...over,
  }
}

function phase(over: Record<string, unknown> = {}, actionOver: Record<string, unknown> = {}) {
  return {
    phase_number: 1,
    name: '准备',
    duration_weeks: 1,
    initiative_seed: {
      initiative_type: 'demand_generation',
      title: '建系列',
      posture: 'fast',
      budget_percent: 100,
      hypothesis: '假设',
    },
    actions: [action(actionOver)],
    ...over,
  }
}

function body(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT,
    goal_id: 'goal-1',
    status: 'approved',
    agent_name: 'huatuo',
    version: 99,
    content: {
      summary: '人工草稿',
      kpi_targets: [
        { metric: '线索', current_value: null, target_value: 3, unit: '条', dimension: 'ads' },
      ],
      budget_allocation: [],
      phases: [phase()],
    },
    generation_meta: { source: 'huatuo', source_refs: ['note-1'] },
    ...over,
  }
}

describe('parseManualPrescriptionBody', () => {
  it('accepts the supplied payload shape and forces a manual marker', () => {
    const parsed = parseManualPrescriptionBody(body(), CLIENT)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.goalId).toBe('goal-1')
    expect(parsed.content.phases).toHaveLength(1)
    expect(parsed.content.phases[0].actions[0].fix_type).toBe('fde_manual')
    expect(parsed.generationMeta.source).toBe('manual')
    expect(parsed.generationMeta.prescriber).toBe(MANUAL_PRESCRIPTION_AGENT)
    expect(parsed.generationMeta.source_refs).toEqual(['note-1'])
  })

  it('accepts a second phase with zero budget so the total stays at 100', () => {
    const parsed = parseManualPrescriptionBody(body({
      content: {
        summary: '两阶段',
        kpi_targets: [],
        budget_allocation: [],
        phases: [
          phase(),
          phase({
            phase_number: 2,
            name: '每天推进',
            initiative_seed: {
              initiative_type: 'demand_generation',
              title: '管预算',
              posture: 'slow',
              budget_percent: 0,
            },
            actions: [action({ id: 'a2', phase: 2 })],
          }),
        ],
      },
    }), CLIENT)
    expect(parsed.ok).toBe(true)
  })

  it('rejects an action that is not manual', () => {
    const parsed = parseManualPrescriptionBody(body({
      content: {
        summary: '含自动动作',
        kpi_targets: [],
        budget_allocation: [],
        phases: [phase({}, { fix_type: 'me_auto', module: 'ads_intelligence' })],
      },
    }), CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.status).toBe(422)
    expect(parsed.error).toContain('不是人工执行')
  })

  it('rejects fde_manual when the module is not manual', () => {
    const parsed = parseManualPrescriptionBody(body({
      content: {
        summary: '模块不对',
        kpi_targets: [],
        budget_allocation: [],
        phases: [phase({}, { module: 'ads_intelligence' })],
      },
    }), CLIENT)
    expect(parsed.ok).toBe(false)
  })

  it('rejects a posture outside the allowed set', () => {
    const parsed = parseManualPrescriptionBody(body({
      content: {
        summary: '姿态不对',
        kpi_targets: [],
        budget_allocation: [],
        phases: [phase({
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: '建系列',
            posture: 'measured',
            budget_percent: 100,
          },
        })],
      },
    }), CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('posture')
  })

  it('rejects budget percents that add up past 100', () => {
    const parsed = parseManualPrescriptionBody(body({
      content: {
        summary: '预算超了',
        kpi_targets: [],
        budget_allocation: [],
        phases: [
          phase(),
          phase({
            phase_number: 2,
            name: '再来',
            actions: [action({ id: 'a2' })],
            initiative_seed: {
              initiative_type: 'demand_generation',
              title: '再来',
              posture: 'slow',
              budget_percent: 50,
            },
          }),
        ],
      },
    }), CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('100')
  })

  it('rejects a client id that does not match the url', () => {
    const parsed = parseManualPrescriptionBody(body({ client_id: 'other' }), CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.status).toBe(422)
  })

  it('requires goal_id', () => {
    const parsed = parseManualPrescriptionBody(body({ goal_id: '  ' }), CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.status).toBe(400)
  })
})

describe('parseManualPaste', () => {
  it('uses the url goal when the paste is only the content object', () => {
    const content = body().content
    const parsed = parseManualPaste(content, 'goal-from-url', CLIENT)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.goalId).toBe('goal-from-url')
  })

  it('rejects when the url goal and the json goal disagree', () => {
    const parsed = parseManualPaste(body(), 'other-goal', CLIENT)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('不一致')
  })
})

describe('manual draft marker', () => {
  it('matches the prescriber name or a manual source, and only while draft', () => {
    expect(isManualDraftRow({ status: 'draft', agent_name: MANUAL_PRESCRIPTION_AGENT })).toBe(true)
    expect(isManualDraftRow({ status: 'draft', agent_name: 'huatuo', generation_meta: { source: 'manual' } })).toBe(true)
    expect(isManualDraftRow({ status: 'approved', agent_name: MANUAL_PRESCRIPTION_AGENT })).toBe(false)
    expect(isManualDraftRow({ status: 'draft', agent_name: 'huatuo' })).toBe(false)
  })

  it('collects goal ids for one client only', () => {
    const ids = goalIdsWithManualDraft([
      { client_id: CLIENT, status: 'draft', goal_id: 'g1', agent_name: MANUAL_PRESCRIPTION_AGENT },
      { client_id: 'other', status: 'draft', goal_id: 'g2', agent_name: MANUAL_PRESCRIPTION_AGENT },
      { client_id: CLIENT, status: 'draft', goal_id: 'g3', agent_name: 'huatuo', generation_meta: { source: 'manual' } },
      { client_id: CLIENT, status: 'rejected', goal_id: 'g4', agent_name: MANUAL_PRESCRIPTION_AGENT },
    ], CLIENT)
    expect(Array.from(ids).sort()).toEqual(['g1', 'g3'])
  })
})
