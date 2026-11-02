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
  const base: EvaluabilityEvidence = { ...none, discovery_id: null, vendor: null, action_type: null, payload_status: null }

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
      expect(isNotEvaluable({ ...row, discovery_id: null, vendor: null, action_type: null, payload_status: null }))
        .toBe(isUnexecutedSuggestion(row))
    }
  })
})

// 【考卷1】Agent 闭环升级（docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md §3.1）。
// 广告自动暂停在「提议那一刻」就写一行 flywheel_actions（vendor='meta'，状态在 payload.status 里），
// 演练、被拦、失败、等批准、被驳回的行没有任何东西真的发生过，结论计算必须认成「没执行」。
// 第 0 步时这四道是「已知待修」（it.fails），第 1 步修好后翻成正式题。
describe('【考卷1】广告自动暂停的提议行不算「已执行」', () => {
  const base: EvaluabilityEvidence = {
    ...none, discovery_id: null, vendor: 'meta', action_type: 'ads.auto_pause_on_d3', payload_status: null,
  }

  for (const status of ['dry_run_logged', 'blocked', 'failed', 'awaiting_approval', 'rejected']) {
    it(`payload.status=${status} 的暂停提议行判为不可评估`, () => {
      expect(isNotEvaluable({ ...base, payload_status: status })).toBe(true)
    })
  }

  it('没有状态的暂停行也不算执行（宁可不评，不拿提议时间当执行时间）', () => {
    expect(isNotEvaluable(base)).toBe(true)
  })

  it('批准后真暂停了（paused，行上有内核运行编号）算可评估', () => {
    expect(isNotEvaluable({ ...base, payload_status: 'paused', action_run_id: 'run-1' })).toBe(false)
  })

  it('别的动作类型不受这条规则影响（payload.status=failed 的社媒帖子照旧）', () => {
    expect(isNotEvaluable({ ...base, action_type: 'social.publish_post', vendor: 'meta_graph', payload_status: 'failed' })).toBe(false)
  })
})
