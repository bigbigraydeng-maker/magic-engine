/**
 * 抽取器**绝不**再往 `client_decision_history.outcome_verdict` 写东西。
 *
 * 这个文件存在的理由是一次真实的污染（2026-09-06 发现并清理）。
 *
 * 抽取器原本有第 5 步「回填决策结论」，判据只按 `client_id` + 时间窗查 outcome，
 * **从不看这条决策关联的是哪个动作**，然后拿窗口内全部 outcome 的多数票，给该客户
 * 窗口内的每一条决策盖同一个章。生产实测：116 条自动回填只有 5 种 note，每种恰好
 * 对应一个客户 —— 一家的 50 条决策被一次性全部盖成 failure。
 *
 * 而 `memory/format.ts` 会把它拼成 `(outcome: failure)` 喂进鲁班和华佗的提示词，
 * 且 `updateDecisionOutcome` 只填 null 行、填过不复查 —— 不可逆。
 *
 * 所以这里钉的不是「少写了一个功能」，是**这条路必须保持断开**：
 * 谁要重新接上，得先给 `client_decision_history` 补一条指向 action 的关联，
 * 并让这三条断言按新判据重写 —— 而不是把它们删掉。
 */

import { describe, expect, it } from 'vitest'
import { runExtractorForClient } from '../extractor'
import { healthyAttributionRun, makeFakeSupabase, type FakeDb, type Row } from './fake-supabase'

const CLIENT = 'client-a'
/** 夹具都是 2026-06 的数据；新鲜度闸按 now 算截止时间，所以测试必须自己给钟。 */
const NOW = new Date('2026-06-03T00:00:00Z')

function outcomeRow(id: string, actionId: string, verdict: 'confirmed' | 'reversed'): Row {
  return {
    id, client_id: CLIENT, action_id: actionId,
    metric_key: 'seo.gsc.clicks', delta: 10, delta_pct: 30, confidence: 0.9,
    verdict, computed_at: '2026-06-02T00:00:00Z', window_days: 28,
  }
}

function actionRow(id: string): Row {
  return {
    id, client_id: CLIENT, action_type: 'publish_blog', flywheel: 'geo',
    vendor: null, executed_at: '2026-06-01T00:00:00Z', expected_metric: 'seo.gsc.clicks',
  }
}

/** 两条**内容完全不同**的决策，都还没有结论 —— 老代码会把它们盖成同一个章。 */
function pendingDecisions(): Row[] {
  return [
    { id: 'd-1', client_id: CLIENT, created_at: '2026-06-01T00:00:00Z',
      chosen_action: '把预算从品牌词挪到长尾词', outcome_verdict: null, outcome_notes: null },
    { id: 'd-2', client_id: CLIENT, created_at: '2026-06-01T00:00:00Z',
      chosen_action: '暂停 Messenger 自动回复', outcome_verdict: null, outcome_notes: null },
  ]
}

function db(outcomes: Row[], actions: Row[], decisions: Row[]): FakeDb {
  return {
    flywheel_outcomes: outcomes,
    flywheel_actions: actions,
    client_proven_patterns: [],
    client_failed_experiments: [],
    client_learned_preferences: [],
    client_decision_history: decisions,
    cron_run_logs: [healthyAttributionRun(NOW)],
  }
}

describe('抽取器不碰决策结论（防 2026-09-06 那次记忆污染复发）', () => {
  it('跑完之后，待定的决策仍然是待定 —— 一个章都没盖', async () => {
    const fake = db(
      [outcomeRow('o-1', 'a-1', 'reversed'), outcomeRow('o-2', 'a-2', 'reversed')],
      [actionRow('a-1'), actionRow('a-2')],
      pendingDecisions(),
    )

    await runExtractorForClient(makeFakeSupabase(fake), CLIENT, NOW)

    for (const d of fake.client_decision_history ?? []) {
      expect(d.outcome_verdict, `决策 ${d.id} 被盖了章`).toBeNull()
      expect(d.outcome_notes, `决策 ${d.id} 被写了理由`).toBeNull()
    }
  })

  it('绝不再出现 auto-derived 那种「按客户窗口多数票」的理由', async () => {
    const fake = db(
      [outcomeRow('o-1', 'a-1', 'confirmed')],
      [actionRow('a-1')],
      pendingDecisions(),
    )

    await runExtractorForClient(makeFakeSupabase(fake), CLIENT, NOW)

    const notes = (fake.client_decision_history ?? []).map((d) => String(d.outcome_notes ?? ''))
    expect(notes.some((n) => n.includes('auto-derived'))).toBe(false)
  })

  it('学习那部分照常干活 —— 摘掉的只是回填，不是整个抽取器', async () => {
    const fake = db(
      [outcomeRow('o-1', 'a-1', 'confirmed')],
      [actionRow('a-1')],
      pendingDecisions(),
    )

    const result = await runExtractorForClient(makeFakeSupabase(fake), CLIENT, NOW)

    expect(result.patterns_added).toBe(1)
    expect(result.errors).toEqual([])
  })
})
