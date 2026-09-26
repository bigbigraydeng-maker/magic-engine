/**
 * 1b · Memories of gated pillars (seo, ads) are only kept while their action is a valid case:
 * executed, not ads, not a whole-site metric, fresh, matured, strong. One rule switches
 * memories on and off, so repeated runs never flip them back and forth.
 */

import { describe, it, expect } from 'vitest'
import { runExtractorForAllClients, runExtractorForClient } from '../extractor'
import { healthyAttributionRun, makeFakeSupabase, type FakeDb, type Row } from './fake-supabase'

const CLIENT = 'client-a'
const NOW = new Date('2026-09-26T00:00:00Z')

const SCHEMA: Record<string, readonly string[]> = {
  flywheel_outcomes: ['id', 'client_id', 'action_id', 'metric_key', 'delta', 'delta_pct', 'confidence', 'verdict', 'computed_at', 'window_days'],
  flywheel_actions: ['id', 'client_id', 'action_type', 'flywheel', 'vendor', 'executed_at', 'expected_metric', 'execution_item_id', 'action_run_id', 'payload'],
  client_proven_patterns: ['id', 'client_id', 'pattern_type', 'pattern_content', 'performance_metric', 'flywheel', 'source_table', 'source_id', 'source_action_id', 'is_active', 'created_at'],
  client_failed_experiments: ['id', 'client_id', 'experiment_description', 'failure_reason', 'dimension', 'tried_at', 'source_table', 'source_id', 'source_action_id', 'is_active', 'created_at'],
  client_learned_preferences: ['id', 'client_id', 'preference_type', 'content', 'source', 'extracted_from_table', 'extracted_from_id', 'confidence_score', 'flywheel', 'is_active', 'created_at'],
  cron_run_logs: ['id', 'job_name', 'status', 'started_at', 'finished_at', 'summary'],
}

function action(id: string, over: Row = {}): Row {
  return {
    id,
    client_id: CLIENT,
    action_type: 'cms_update_existing',
    flywheel: 'seo',
    vendor: null,
    executed_at: '2026-08-01T00:00:00Z',
    expected_metric: 'seo.gsc.page_clicks',
    execution_item_id: 'card-1',
    action_run_id: null,
    payload: { status: 'live' },
    ...over,
  }
}

function outcome(id: string, actionId: string, over: Row = {}): Row {
  return {
    id,
    client_id: CLIENT,
    action_id: actionId,
    metric_key: 'seo.gsc.page_clicks',
    delta: 40,
    delta_pct: 100,
    confidence: 0.95,
    verdict: 'confirmed',
    computed_at: '2026-09-25T00:00:00Z',
    window_days: 28,
    ...over,
  }
}

function provenRow(id: string, over: Row = {}): Row {
  return {
    id,
    client_id: CLIENT,
    pattern_type: 'angle',
    pattern_content: 'x',
    performance_metric: 'x',
    flywheel: 'seo',
    source_table: 'flywheel_outcomes',
    source_id: null,
    source_action_id: null,
    is_active: true,
    created_at: '2026-08-10T00:00:00Z',
    ...over,
  }
}

function failedRow(id: string, over: Row = {}): Row {
  return {
    id,
    client_id: CLIENT,
    experiment_description: 'x',
    failure_reason: 'x',
    dimension: 'seo',
    tried_at: '2026-08-01T00:00:00Z',
    source_table: 'flywheel_outcomes',
    source_id: null,
    source_action_id: null,
    is_active: true,
    created_at: '2026-08-10T00:00:00Z',
    ...over,
  }
}

function prefRow(id: string, actionType: string, over: Row = {}): Row {
  return {
    id,
    client_id: CLIENT,
    preference_type: 'format',
    content: `3 个动作 confirmed: action_type='${actionType}' 在 seo 飞轮持续跑赢`,
    source: 'auto_extracted',
    extracted_from_table: 'flywheel_outcomes',
    extracted_from_id: null,
    confidence_score: 0.5,
    flywheel: 'seo',
    is_active: true,
    created_at: '2026-08-10T00:00:00Z',
    ...over,
  }
}

/** Three executed page-level actions whose outcomes stopped being recomputed (stale, not rule-invalid). */
function staleTrio(): { actions: Row[]; outcomes: Row[] } {
  const ids = ['a1', 'a2', 'a3']
  return {
    actions: ids.map((id) => action(id)),
    outcomes: ids.map((id) => outcome(`o-${id}`, id, { computed_at: '2026-09-01T00:00:00Z' })),
  }
}

/** Three executed actions judged only on a whole-site metric (invalid by rule). */
function siteLevelTrio(): { actions: Row[]; outcomes: Row[] } {
  const ids = ['s1', 's2', 's3']
  return {
    actions: ids.map((id) => action(id, { action_type: 'seo.refresh_blog', expected_metric: 'seo.gsc.clicks' })),
    outcomes: ids.map((id) => outcome(`o-${id}`, id, { metric_key: 'seo.gsc.clicks' })),
  }
}

function db(parts: { actions?: Row[]; outcomes?: Row[]; proven?: Row[]; failed?: Row[]; prefs?: Row[]; healthy?: boolean }): FakeDb {
  return {
    flywheel_actions: parts.actions ?? [],
    flywheel_outcomes: parts.outcomes ?? [],
    client_proven_patterns: parts.proven ?? [],
    client_failed_experiments: parts.failed ?? [],
    client_learned_preferences: parts.prefs ?? [],
    client_decision_history: [],
    cron_run_logs: parts.healthy === false ? [] : [healthyAttributionRun(NOW)],
  }
}

const client = (fake: FakeDb) => makeFakeSupabase(fake, { schema: SCHEMA })
const activeIds = (rows: Row[] | undefined) => (rows ?? []).filter((r) => r.is_active === true).map((r) => r.id)

describe('1b · 名单内支柱：有效案例才留得住记忆', () => {
  it('执行过、页面级、新鲜的 SEO 动作会被学进来', async () => {
    const fake = db({ actions: [action('act-page')], outcomes: [outcome('o-page', 'act-page')] })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.patterns_added).toBe(1)
    expect(activeIds(fake.client_proven_patterns)).toHaveLength(1)
    expect(fake.client_proven_patterns[0].source_action_id).toBe('act-page')
    expect(result.deactivated).toEqual([])
  })

  it('诸葛亮的建议没执行过：不学，存量记忆下架，回滚清单带表名', async () => {
    const fake = db({
      actions: [action('act-sugg', { execution_item_id: null, payload: { zhuge_session_key: 'sess-1' } })],
      outcomes: [outcome('o-sugg', 'act-sugg')],
      proven: [provenRow('p-sugg', { source_id: 'o-sugg', source_action_id: 'act-sugg' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_proven_patterns)).toEqual([])
    expect(fake.client_proven_patterns).toHaveLength(1)
    expect(result.deactivated).toEqual([
      { table: 'client_proven_patterns', id: 'p-sugg', reason: 'no_execution_evidence' },
    ])
  })

  it('主动信号建议同样不算执行过', async () => {
    const fake = db({
      actions: [action('act-pro', { execution_item_id: null, payload: { source: 'proactive_signal' } })],
      outcomes: [outcome('o-pro', 'act-pro')],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.patterns_added).toBe(0)
    expect(fake.client_proven_patterns).toEqual([])
  })

  it('ads 方向未定：强结论也不开，存量记忆下架', async () => {
    const fake = db({
      actions: [action('act-ads', { flywheel: 'ads', expected_metric: 'ads.account.cost_per_lead' })],
      outcomes: [outcome('o-ads', 'act-ads', { metric_key: 'ads.account.cost_per_lead' })],
      proven: [provenRow('p-ads', { flywheel: 'ads', source_action_id: 'act-ads' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.patterns_added).toBe(0)
    expect(activeIds(fake.client_proven_patterns)).toEqual([])
    expect(result.deactivated_by_reason.direction_unknown).toBe(1)
  })

  it('整站指标：归因停摆也照样下架（规则类理由不看归因）', async () => {
    const fake = db({
      healthy: false,
      actions: [action('act-site', { expected_metric: 'seo.gsc.clicks' })],
      outcomes: [outcome('o-site', 'act-site', { metric_key: 'seo.gsc.clicks' })],
      proven: [provenRow('p-site', { source_action_id: 'act-site' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.deactivated_by_reason.site_level_metric).toBe(1)
    expect(activeIds(fake.client_proven_patterns)).toEqual([])
    expect(result.errors.some((e) => e.includes('attribution stalled'))).toBe(true)
  })

  it('过期证据：归因正常时下架，停摆时按住', async () => {
    const fixture = (healthy: boolean) => db({
      healthy,
      actions: [action('act-old')],
      outcomes: [outcome('o-old', 'act-old', { computed_at: '2026-09-01T00:00:00Z' })],
      proven: [provenRow('p-old', { source_action_id: 'act-old' })],
    })

    const healthyFake = fixture(true)
    const healthyResult = await runExtractorForClient(client(healthyFake), CLIENT, NOW)
    expect(healthyResult.deactivated_by_reason.stale).toBe(1)

    const stalledFake = fixture(false)
    const stalledResult = await runExtractorForClient(client(stalledFake), CLIENT, NOW)
    expect(activeIds(stalledFake.client_proven_patterns)).toEqual(['p-old'])
    expect(stalledResult.skipped_attribution_stalled).toBe(1)
  })

  it('窗口没到期：结论怎么翻都不动', async () => {
    const fake = db({
      actions: [action('act-new', { executed_at: '2026-09-20T00:00:00Z' })],
      outcomes: [outcome('o-new', 'act-new')],
      proven: [provenRow('p-new', { source_action_id: 'act-new' })],
    })
    const supabase = client(fake)

    const first = await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-new'])
    expect(fake.client_failed_experiments).toEqual([])
    expect(first.skipped_immature).toBeGreaterThanOrEqual(1)

    fake.flywheel_outcomes[0].verdict = 'reversed'
    fake.flywheel_outcomes[0].confidence = 0.9
    const second = await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-new'])
    expect(fake.client_failed_experiments).toEqual([])
    expect(second.skipped_immature).toBeGreaterThanOrEqual(1)

    fake.flywheel_outcomes[0].verdict = 'confirmed'
    fake.flywheel_outcomes[0].confidence = 0.5
    const third = await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-new'])
    expect(fake.client_failed_experiments).toEqual([])
    expect(third.skipped_immature).toBeGreaterThanOrEqual(1)
  })

  it('手工入口不下架，也不会把 cron 下架的行重新打开', async () => {
    const fake = db({
      actions: [action('act-sugg', { execution_item_id: null, payload: { zhuge_session_key: 'sess-1' } })],
      outcomes: [outcome('o-sugg', 'act-sugg')],
      proven: [provenRow('p-sugg', { source_id: 'o-sugg', source_action_id: 'act-sugg' })],
    })
    const supabase = client(fake)

    const manual = await runExtractorForClient(supabase, CLIENT, NOW, { reconcile: false })
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-sugg'])
    expect(manual.deactivated).toEqual([])

    await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_proven_patterns)).toEqual([])

    const manualAgain = await runExtractorForClient(supabase, CLIENT, NOW, { reconcile: false })
    expect(activeIds(fake.client_proven_patterns)).toEqual([])
    expect(manualAgain.memories_reactivated).toBe(0)
  })

  it('对侧的老行（没有 source_action_id）会被下架', async () => {
    const fake = db({
      actions: [action('act-page')],
      outcomes: [outcome('o-page', 'act-page')],
      failed: [failedRow('f-old', { source_id: 'o-page', source_action_id: null })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_failed_experiments)).toEqual([])
    expect(result.deactivated).toContainEqual({
      table: 'client_failed_experiments',
      id: 'f-old',
      reason: 'opposite_side',
    })
    expect(activeIds(fake.client_proven_patterns)).toHaveLength(1)
  })

  it('动作行已经不在了 → action_missing', async () => {
    const fake = db({ proven: [provenRow('p-ghost', { source_action_id: 'ghost' })] })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.deactivated).toContainEqual({
      table: 'client_proven_patterns',
      id: 'p-ghost',
      reason: 'action_missing',
    })
    expect(activeIds(fake.client_proven_patterns)).toEqual([])
  })

  it('没有动作关联、来源 outcome 也没了 → source_missing', async () => {
    const fake = db({ proven: [provenRow('p-lost', { source_id: 'gone', source_action_id: null })] })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.deactivated).toContainEqual({
      table: 'client_proven_patterns',
      id: 'p-lost',
      reason: 'source_missing',
    })
    expect(activeIds(fake.client_proven_patterns)).toEqual([])
  })

  it('名单外的支柱（geo）原样不动', async () => {
    const fake = db({
      actions: [action('act-geo', {
        flywheel: 'geo',
        execution_item_id: null,
        payload: { zhuge_session_key: 'sess-9' },
        expected_metric: 'geo.query.mention_rate',
      })],
      outcomes: [
        outcome('o-geo', 'act-geo', { metric_key: 'geo.query.mention_rate' }),
        outcome('o-geo-2', 'act-geo', { metric_key: 'geo.query.share_of_voice', verdict: 'reversed' }),
      ],
      proven: [provenRow('p-geo', { flywheel: 'geo', source_action_id: 'act-geo' })],
      failed: [failedRow('f-geo', { dimension: 'ai_visibility', source_action_id: 'other-geo' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.deactivated).toEqual([])
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-geo'])
    expect(activeIds(fake.client_failed_experiments)).toEqual(['f-geo'])
  })

  it('连跑两轮：第二轮什么都不改', async () => {
    const fake = db({
      actions: [
        action('act-page'),
        action('act-sugg', { execution_item_id: null, payload: { zhuge_session_key: 'sess-1' } }),
        action('act-ads', { flywheel: 'ads', expected_metric: 'ads.account.cost_per_lead' }),
      ],
      outcomes: [
        outcome('o-page', 'act-page'),
        outcome('o-sugg', 'act-sugg'),
        outcome('o-ads', 'act-ads', { metric_key: 'ads.account.cost_per_lead' }),
      ],
      proven: [
        provenRow('p-sugg', { source_id: 'o-sugg', source_action_id: 'act-sugg' }),
        provenRow('p-ads', { flywheel: 'ads', source_action_id: 'act-ads' }),
      ],
    })
    const supabase = client(fake)

    await runExtractorForClient(supabase, CLIENT, NOW)
    const second = await runExtractorForClient(supabase, CLIENT, NOW)

    expect(second.deactivated).toEqual([])
    expect(second.patterns_added).toBe(0)
    expect(second.experiments_added).toBe(0)
    expect(second.preferences_added).toBe(0)
    expect(second.memories_reactivated).toBe(0)
    expect(second.memories_superseded).toBe(0)
  })

  it('偏好跟着同一个支撑数走：不足三个下架，回来时同一行重新打开', async () => {
    const fake = db({
      actions: [action('a1'), action('a2'), action('a3')],
      outcomes: [outcome('o1', 'a1'), outcome('o2', 'a2'), outcome('o3', 'a3')],
    })
    const supabase = client(fake)

    await runExtractorForClient(supabase, CLIENT, NOW)
    const activePrefs = fake.client_learned_preferences.filter((r) => r.is_active === true)
    expect(activePrefs).toHaveLength(1)
    expect(String(activePrefs[0].content)).toContain("action_type='cms_update_existing'")
    const prefId = activePrefs[0].id

    fake.flywheel_outcomes[2].verdict = 'inconclusive'
    const second = await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_learned_preferences)).toEqual([])
    expect(second.deactivated_by_reason.preference_no_support).toBe(1)

    fake.flywheel_outcomes[2].verdict = 'confirmed'
    await runExtractorForClient(supabase, CLIENT, NOW)
    expect(activeIds(fake.client_learned_preferences)).toEqual([prefId])
    expect(fake.client_learned_preferences).toHaveLength(1)
  })

  it('假客户端会拒绝表里没有的列', async () => {
    const res = await client(db({})).from('client_failed_experiments').select('id, flywheel')

    expect(res.error?.message).toContain('client_failed_experiments.flywheel')
  })

  it('批量跑会照顾到 outcome 全没了的客户', async () => {
    const fake = db({ proven: [provenRow('p-ghost', { source_action_id: 'ghost' })] })

    const batch = await runExtractorForAllClients(client(fake), NOW)

    expect(batch.aggregate.deactivated).toContainEqual({
      table: 'client_proven_patterns',
      id: 'p-ghost',
      reason: 'action_missing',
    })
  })

  it('FDE 手写的记忆（来源不是归因结论）一条都不碰', async () => {
    const fake = db({
      proven: [
        provenRow('p-fde', { source_table: 'execution_items', source_id: 'card-9' }),
        provenRow('p-null', { source_table: null }),
      ],
      failed: [failedRow('f-fde', { source_table: 'execution_items' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(result.deactivated).toEqual([])
    expect(activeIds(fake.client_proven_patterns)).toEqual(['p-fde', 'p-null'])
    expect(activeIds(fake.client_failed_experiments)).toEqual(['f-fde'])
  })

  it('周报汇总写的偏好不碰', async () => {
    const fake = db({
      prefs: [prefRow('pref-rollup', 'cms_update_existing', { extracted_from_table: 'learning_rollup_weekly' })],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_learned_preferences)).toEqual(['pref-rollup'])
    expect(result.deactivated).toEqual([])
  })

  it('归因停摆：偏好的支撑可能只是被拉低，按住不下架', async () => {
    const fake = db({
      healthy: false,
      ...staleTrio(),
      prefs: [prefRow('pref-stale', 'cms_update_existing')],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_learned_preferences)).toEqual(['pref-stale'])
    expect(result.deactivated_by_reason.preference_no_support).toBeUndefined()
    expect(result.skipped_attribution_stalled).toBeGreaterThanOrEqual(1)
  })

  it('同一批数据，归因正常时偏好照样下架', async () => {
    const fake = db({
      ...staleTrio(),
      prefs: [prefRow('pref-stale', 'cms_update_existing')],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_learned_preferences)).toEqual([])
    expect(result.deactivated_by_reason.preference_no_support).toBe(1)
    expect(result.deactivated).toContainEqual({
      table: 'client_learned_preferences',
      id: 'pref-stale',
      reason: 'preference_no_support',
    })
  })

  it('归因停摆也照样下架：这类动作全是整站指标', async () => {
    const fake = db({
      healthy: false,
      ...siteLevelTrio(),
      prefs: [prefRow('pref-site', 'seo.refresh_blog')],
    })

    const result = await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_learned_preferences)).toEqual([])
    expect(result.deactivated).toContainEqual({
      table: 'client_learned_preferences',
      id: 'pref-site',
      reason: 'preference_no_support',
    })
  })

  it('停摆时同一个客户两类偏好分开处理', async () => {
    const stale = staleTrio()
    const site = siteLevelTrio()
    const fake = db({
      healthy: false,
      actions: [...stale.actions, ...site.actions],
      outcomes: [...stale.outcomes, ...site.outcomes],
      prefs: [prefRow('pref-stale', 'cms_update_existing'), prefRow('pref-site', 'seo.refresh_blog')],
    })

    await runExtractorForClient(client(fake), CLIENT, NOW)

    expect(activeIds(fake.client_learned_preferences)).toEqual(['pref-stale'])
  })
})
