import { describe, it, expect } from 'vitest'
import {
  isUnexecutedSuggestion,
  isNotEvaluable,
  type ExecutionEvidence,
  type EvaluabilityEvidence,
} from '../execution-evidence'

const none: ExecutionEvidence = {
  zhuge_session_key: null,
  payload_source: null,
  execution_item_id: null,
  action_run_id: null,
}

describe('isUnexecutedSuggestion', () => {
  it('a Zhuge weekly-plan suggestion with no card and no run was never executed', () => {
    expect(isUnexecutedSuggestion({ ...none, zhuge_session_key: 'session-1' })).toBe(true)
  })

  it('a proactive anomaly suggestion with no card and no run was never executed', () => {
    expect(isUnexecutedSuggestion({ ...none, payload_source: 'proactive_signal' })).toBe(true)
  })

  it('a suggestion linked to a card counts as executed', () => {
    expect(isUnexecutedSuggestion({ ...none, zhuge_session_key: 'session-1', execution_item_id: 'card-1' })).toBe(false)
  })

  it('a suggestion linked to a kernel run counts as executed', () => {
    expect(isUnexecutedSuggestion({ ...none, payload_source: 'proactive_signal', action_run_id: 'run-1' })).toBe(false)
  })

  it('real executions without link fields (stop-loss, ad execute, page upgrade) count as executed', () => {
    expect(isUnexecutedSuggestion(none)).toBe(false)
    expect(isUnexecutedSuggestion({ ...none, payload_source: 'stop_loss' })).toBe(false)
  })

  it('an empty session key is not a suggestion marker', () => {
    expect(isUnexecutedSuggestion({ ...none, zhuge_session_key: '' })).toBe(false)
  })
})

describe('isNotEvaluable', () => {
  const base: EvaluabilityEvidence = { ...none, discovery_id: null, vendor: null }

  it('a Zhuge suggestion is not evaluable', () => {
    expect(isNotEvaluable({ ...base, zhuge_session_key: 'session-1' })).toBe(true)
  })

  it('a discovery recommendation with no card, run, or vendor is not evaluable', () => {
    expect(isNotEvaluable({ ...base, discovery_id: 'd1' })).toBe(true)
  })

  it('a discovery recommendation linked to a card is evaluable', () => {
    expect(isNotEvaluable({ ...base, discovery_id: 'd1', execution_item_id: 'card-1' })).toBe(false)
  })

  it('a discovery recommendation linked to a kernel run is evaluable', () => {
    expect(isNotEvaluable({ ...base, discovery_id: 'd1', action_run_id: 'run-1' })).toBe(false)
  })

  it('a discovery recommendation with a meta vendor is evaluable', () => {
    expect(isNotEvaluable({ ...base, discovery_id: 'd1', vendor: 'meta' })).toBe(false)
  })

  it('a discovery recommendation with a google_ads vendor is evaluable', () => {
    expect(isNotEvaluable({ ...base, discovery_id: 'd1', vendor: 'google_ads' })).toBe(false)
  })

  it('an empty discovery_id is not a marker', () => {
    expect(isNotEvaluable({ ...base, discovery_id: '' })).toBe(false)
  })

  it('a plain action with a vendor and no markers is evaluable', () => {
    expect(isNotEvaluable({ ...base, vendor: 'meta_graph' })).toBe(false)
  })

  it('agrees with isUnexecutedSuggestion for every row without a discovery_id', () => {
    const rows: ExecutionEvidence[] = [
      { ...none, zhuge_session_key: 'session-1' },
      { ...none, payload_source: 'proactive_signal' },
      none,
    ]
    for (const row of rows) {
      expect(isNotEvaluable({ ...row, discovery_id: null, vendor: null }))
        .toBe(isUnexecutedSuggestion(row))
    }
  })
})
