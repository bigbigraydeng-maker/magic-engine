import { describe, expect, it } from 'vitest'
import { parsePrescription } from './parse'

const baseRow = {
  status: 'approved',
  goal_id: 'goal-1',
  approved_at: null,
  error_message: null,
  intake: null,
  agent_name: 'huatuo',
  generation_meta: { source: 'huatuo' },
  content: {
    phases: [{ initiative_seed: { ad_plays: [{ step_key: 'p1-1', play: 'lead_form_harvest' }] } }],
    kpi_targets: [],
  },
}

describe('parsePrescription targetCosts', () => {
  it('uses the continue line and skips pause-line thresholds', () => {
    const parsed = parsePrescription({
      ...baseRow,
      content: {
        ...baseRow.content,
        kpi_targets: [
          { metric: '目标线索成本', target_value: 11, unit: 'NZD' },
          { metric: '一条线索的成本，暂停线', target_value: 14.63, unit: 'NZD' },
        ],
      },
    })
    expect(parsed?.targetCosts).toEqual([11])
  })

  it('prefers explicit target-cost rows when both explicit and generic costs exist', () => {
    const parsed = parsePrescription({
      ...baseRow,
      content: {
        ...baseRow.content,
        kpi_targets: [
          { metric: '线索成本', target_value: 99, unit: 'NZD' },
          { metric: '目标线索成本', target_value: 11, unit: 'NZD' },
        ],
      },
    })
    expect(parsed?.targetCosts).toEqual([11])
  })

  it('keeps two different explicit targets for downstream conflict checks', () => {
    const parsed = parsePrescription({
      ...baseRow,
      content: {
        ...baseRow.content,
        kpi_targets: [
          { metric: '目标线索成本', target_value: 11, unit: 'NZD' },
          { metric: '目标成本', target_value: 12, unit: 'NZD' },
        ],
      },
    })
    expect(parsed?.targetCosts).toEqual([11, 12])
  })

  it('marks manual prescriptions from agent name or generation meta', () => {
    expect(parsePrescription({ ...baseRow, agent_name: '广告 Agent' })?.manual).toBe(true)
    expect(parsePrescription({
      ...baseRow,
      agent_name: 'huatuo',
      generation_meta: { source: 'manual' },
    })?.manual).toBe(true)
    expect(parsePrescription({ ...baseRow, agent_name: 'huatuo' })?.manual).toBe(false)
  })
})
