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

// 【考卷1】Agent 闭环升级第 0 步（docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md §3.1）。
// 广告自动暂停在「提议那一刻」就写一行 flywheel_actions（vendor='meta'，状态在 payload.status 里），
// 演练、被拦、失败、等批准的行没有任何东西真的发生过。给这些行补上观察指标之前，
// 结论计算必须先把它们认成「没执行」——现在认不出来，所以下面四道是「已知待修·第 1 步」：
// 第 1 步修好后把 it.fails 改成 it。输入里的 payload_status 是第 1 步要加的字段名（暂定）。
describe('【考卷1】广告自动暂停的提议行不算「已执行」', () => {
  const base: EvaluabilityEvidence = { ...none, discovery_id: null, vendor: 'meta' }

  for (const status of ['dry_run_logged', 'blocked', 'failed', 'awaiting_approval']) {
    it.fails(`【已知待修·第1步】payload.status=${status} 的暂停提议行应判为不可评估`, () => {
      const row = { ...base, payload_status: status }
      expect(isNotEvaluable(row)).toBe(true)
    })
  }

  it('真执行的暂停（行上有内核运行编号）算可评估', () => {
    expect(isNotEvaluable({ ...base, action_run_id: 'run-1' })).toBe(false)
  })
})
