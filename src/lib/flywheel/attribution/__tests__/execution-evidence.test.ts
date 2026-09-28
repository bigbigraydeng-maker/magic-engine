import { describe, it, expect } from 'vitest'
import { isUnexecutedSuggestion, type ExecutionEvidence } from '../execution-evidence'

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
