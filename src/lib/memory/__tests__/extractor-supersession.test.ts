/**
 * 记忆抽取器：样本口径（一个动作 = 一个案例）+ 结论翻转时的正反经验互斥。
 *
 * Issue #859 架构判断 6。这两条是 memory-extractor 上生产（以及打开
 * ATTRIBUTION_DUAL_WINDOW_ENABLED）之前必须先站住的东西。
 */

import { describe, it, expect } from 'vitest'
import { runExtractorForClient } from '../extractor'
import { makeFakeSupabase, type FakeDb, type Row } from './fake-supabase'

const CLIENT = 'client-a'
const ACTION = 'action-1'

/** 一个 GSC 动作一次快照产出的三行 outcome —— 三个读数，一个事件。 */
function threeReadingsOf(
  actionId: string,
  verdict: 'confirmed' | 'reversed',
  idPrefix = 'o',
): Row[] {
  return [
    { id: `${idPrefix}-clicks`,      client_id: CLIENT, action_id: actionId, metric_key: 'seo.gsc.clicks',       delta: 10, delta_pct: 12, confidence: 0.9, verdict, computed_at: '2026-06-02T00:00:00Z', window_days: 28 },
    { id: `${idPrefix}-impr`,        client_id: CLIENT, action_id: actionId, metric_key: 'seo.gsc.impressions',  delta: 90, delta_pct: 30, confidence: 0.9, verdict, computed_at: '2026-06-02T00:00:00Z', window_days: 28 },
    { id: `${idPrefix}-pos`,         client_id: CLIENT, action_id: actionId, metric_key: 'seo.gsc.avg_position', delta: -1, delta_pct: -8, confidence: 0.9, verdict, computed_at: '2026-06-02T00:00:00Z', window_days: 28 },
  ]
}

function actionRow(id: string, actionType = 'publish_blog'): Row {
  return {
    id,
    client_id: CLIENT,
    action_type: actionType,
    flywheel: 'seo',
    vendor: null,
    executed_at: '2026-06-01T00:00:00Z',
    expected_metric: 'seo.gsc.clicks',
  }
}

function baseDb(outcomes: Row[], actions: Row[]): FakeDb {
  return {
    flywheel_outcomes: outcomes,
    flywheel_actions: actions,
    client_proven_patterns: [],
    client_failed_experiments: [],
    client_learned_preferences: [],
    client_decision_history: [],
  }
}

const active = (rows: Row[] | undefined) => (rows ?? []).filter(r => r.is_active === true)

describe('抽取器：一个动作 = 一个案例', () => {
  it('同一动作的三行 outcome 只留下一条经验，不是三条', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.outcomes_processed).toBe(3)
    expect(result.actions_processed).toBe(1)
    expect(result.patterns_added).toBe(1)
    expect(db.client_proven_patterns).toHaveLength(1)
    // 代表读数取动作承诺的那个指标，不是字典序最小的 avg_position
    expect(String(db.client_proven_patterns[0].source_id)).toBe('o-clicks')
    expect(db.client_proven_patterns[0].source_action_id).toBe(ACTION)
  })

  it('代表读数取动作承诺的指标，不是兜底排序里的第一名', async () => {
    // 这个动作承诺的是 impressions。两个指标结论相反：
    //   clicks      → reversed
    //   impressions → confirmed（它承诺的那个）
    // 少读 expected_metric 的话，兜底排序会把 clicks 选成代表（它排在
    // impressions 前面），于是这个动作被记成「失败经验」—— 记反了，不是记少了。
    const db = baseDb(
      [
        { id: 'o-clicks', client_id: CLIENT, action_id: ACTION, metric_key: 'seo.gsc.clicks',      delta: -5, delta_pct: -9, confidence: 0.9, verdict: 'reversed',  computed_at: '2026-06-02T00:00:00Z', window_days: 28 },
        { id: 'o-impr',   client_id: CLIENT, action_id: ACTION, metric_key: 'seo.gsc.impressions', delta: 90, delta_pct: 30, confidence: 0.9, verdict: 'confirmed', computed_at: '2026-06-02T00:00:00Z', window_days: 28 },
      ],
      [{ ...actionRow(ACTION), expected_metric: 'seo.gsc.impressions' }],
    )

    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.patterns_added).toBe(1)
    expect(result.experiments_added).toBe(0)
    expect(String(db.client_proven_patterns[0].source_id)).toBe('o-impr')
    expect(active(db.client_failed_experiments)).toHaveLength(0)
  })

  it('偏好阈值数的是动作个数，不是 outcome 行数', async () => {
    // 2 个动作 × 3 行 = 6 行 confirmed。按行数数早就过了 3 的阈值；按动作数不够。
    const twoActions = ['a1', 'a2']
    const db = baseDb(
      twoActions.flatMap((a, i) => threeReadingsOf(a, 'confirmed', `o${i}`)),
      twoActions.map(a => actionRow(a)),
    )
    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.outcomes_processed).toBe(6)
    expect(result.actions_processed).toBe(2)
    expect(result.preferences_added).toBe(0)
    expect(db.client_learned_preferences).toHaveLength(0)
  })

  it('够 3 个动作才写偏好，且文案说的是动作数', async () => {
    const threeActions = ['a1', 'a2', 'a3']
    const db = baseDb(
      threeActions.flatMap((a, i) => threeReadingsOf(a, 'confirmed', `o${i}`)),
      threeActions.map(a => actionRow(a)),
    )
    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.preferences_added).toBe(1)
    expect(String(db.client_learned_preferences[0].content)).toContain('3 个动作 confirmed')
  })
})

describe('抽取器：结论翻转时正反经验互斥', () => {
  it('confirmed → reversed：正面经验下架，反面经验生效', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    const supabase = makeFakeSupabase(db)

    await runExtractorForClient(supabase, CLIENT)
    expect(active(db.client_proven_patterns)).toHaveLength(1)

    // 同一批 outcome 行被原地改成 reversed（PR #862 之后 upsert 就是这个行为）
    for (const row of db.flywheel_outcomes) row.verdict = 'reversed'
    const second = await runExtractorForClient(supabase, CLIENT)

    expect(second.experiments_added).toBe(1)
    expect(active(db.client_failed_experiments)).toHaveLength(1)
    // 关键断言：正面经验必须不再生效，否则 agent 同时读到「管用」和「不管用」
    expect(active(db.client_proven_patterns)).toHaveLength(0)
    expect(second.memories_superseded).toBeGreaterThan(0)
  })

  it('再翻回 confirmed：正面经验重新生效，且不新增行', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    const supabase = makeFakeSupabase(db)

    await runExtractorForClient(supabase, CLIENT)
    for (const row of db.flywheel_outcomes) row.verdict = 'reversed'
    await runExtractorForClient(supabase, CLIENT)
    for (const row of db.flywheel_outcomes) row.verdict = 'confirmed'
    const third = await runExtractorForClient(supabase, CLIENT)

    // 老逻辑（见过这个 source_id 就跳过）到这一步就卡死了：正面经验永远打不开
    expect(active(db.client_proven_patterns)).toHaveLength(1)
    expect(active(db.client_failed_experiments)).toHaveLength(0)
    expect(third.memories_reactivated).toBe(1)
    expect(db.client_proven_patterns).toHaveLength(1)
    expect(db.client_failed_experiments).toHaveLength(1)
  })

  it('反复跑是幂等的：不长新行', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    const supabase = makeFakeSupabase(db)

    await runExtractorForClient(supabase, CLIENT)
    await runExtractorForClient(supabase, CLIENT)
    const third = await runExtractorForClient(supabase, CLIENT)

    expect(db.client_proven_patterns).toHaveLength(1)
    expect(third.patterns_added).toBe(0)
  })
})

describe('抽取器：存量记忆行', () => {
  it('20260812100000 之前写的行按 outcome_id 认领回来，不重复写', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    db.client_proven_patterns = [{
      id: 'legacy-1',
      client_id: CLIENT,
      pattern_type: 'format',
      pattern_content: '旧口径写的经验',
      source_table: 'flywheel_outcomes',
      source_id: 'o-clicks',
      source_action_id: null,   // 存量行没有动作身份
      is_active: true,
      created_at: '2026-05-01T00:00:00Z',
    }]

    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.patterns_added).toBe(0)
    expect(db.client_proven_patterns).toHaveLength(1)
    expect(db.client_proven_patterns[0].source_action_id).toBe(ACTION)
  })

  it('同一动作的多条存量重复行，只留一条生效', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    // 老逻辑每行 outcome 写一条 —— 一个动作留下三条「经验」
    db.client_proven_patterns = ['o-clicks', 'o-impr', 'o-pos'].map((sid, i) => ({
      id: `legacy-${i}`,
      client_id: CLIENT,
      pattern_type: 'format',
      pattern_content: `旧口径 ${sid}`,
      source_table: 'flywheel_outcomes',
      source_id: sid,
      source_action_id: null,
      is_active: true,
      created_at: `2026-05-0${i + 1}T00:00:00Z`,
    }))

    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.patterns_added).toBe(0)
    expect(db.client_proven_patterns).toHaveLength(3)  // 一行都不删
    expect(active(db.client_proven_patterns)).toHaveLength(1)
    expect(active(db.client_proven_patterns)[0].id).toBe('legacy-0')  // 留最早那条
    expect(result.memories_superseded).toBe(2)
  })
})

describe('抽取器：读不到存量记忆时', () => {
  it('停手，不写 —— 否则会把「已有的」当成「没有的」写出重复', async () => {
    const db = baseDb(threeReadingsOf(ACTION, 'confirmed'), [actionRow(ACTION)])
    const supabase = makeFakeSupabase(db, { failSelectOn: ['client_proven_patterns'] })

    const result = await runExtractorForClient(supabase, CLIENT)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join(' ')).toContain('load existing memories')
    expect(result.patterns_added).toBe(0)
    expect(db.client_proven_patterns).toHaveLength(0)
    expect(db.client_learned_preferences).toHaveLength(0)
  })
})

describe('抽取器：低置信度', () => {
  it('confidence 低于门槛的动作不写任何经验', async () => {
    const outcomes = threeReadingsOf(ACTION, 'confirmed').map(r => ({ ...r, confidence: 0.3 }))
    const db = baseDb(outcomes, [actionRow(ACTION)])

    const result = await runExtractorForClient(makeFakeSupabase(db), CLIENT)

    expect(result.patterns_added).toBe(0)
    expect(db.client_proven_patterns).toHaveLength(0)
  })
})
