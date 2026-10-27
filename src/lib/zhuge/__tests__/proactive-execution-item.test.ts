/**
 * 异常检测把「要去做」写成待办时，不能再带 execution_items 上不存在的 payload 列。
 * 关联信息放进已有的 steps_json，插入才能对着现在的表成功。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; rows: unknown }>,
  signals: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/zhuge/memory-loader', () => ({
  loadZhugeFeedbackSummary: vi.fn(async () => ({
    has_content: false,
    total: 0,
    state_counts: { done: 0, dismissed: 0, irrelevant: 0 },
    dismissed_keys: [],
    irrelevant_keys: [],
    recent_events: [],
  })),
  formatZhugeFeedbackPrompt: vi.fn(() => ''),
}))

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_HAIKU: 'claude-haiku-test',
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify([{
            signal_id: 'sig-1',
            should_act: true,
            action_type: 'investigate_seo_drop',
            action_description: '排名掉了，去看落地页',
            expected_impact: 'high',
          }]),
        }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  }),
}))

function resolved(result: { data: unknown; error: { message: string } | null }, extra: Record<string, unknown> = {}) {
  const promise = Promise.resolve(result)
  return {
    ...extra,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      const api = {
        select() { return api },
        eq() { return api },
        order() { return api },
        in() { return api },
        limit() {
          return resolved({ data: table === 'anomaly_signals' ? h.signals : [], error: null })
        },
        single() {
          return resolved({ data: { name: 'Acme' }, error: null })
        },
        insert(rows: unknown) {
          h.inserts.push({ table, rows })
          const data = table === 'flywheel_actions' ? [{ id: 'action-1' }] : null
          const result = { data, error: null }
          return resolved(result, { select: () => resolved(result) })
        },
        update() { return api },
        then(onOk: (value: unknown) => unknown, onErr?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(onOk, onErr)
        },
      }
      return api
    },
  },
}))

import { runProactivePass } from '../proactive'

const PROD_EXECUTION_ITEM_COLUMNS = new Set([
  'id', 'prescription_id', 'client_id', 'finding_id', 'dimension', 'title', 'description',
  'fix_type', 'status', 'assigned_to', 'due_date', 'completed_at', 'sort_order', 'created_at',
  'updated_at', 'phase', 'steps_json', 'started_at', 'execution_target', 'content_post_id',
  'source', 'marketing_plan_id', 'action_type', 'zhuge_session_id', 'initiative_id',
  'generation_started_at', 'generation_error', 'auto_run_attempts', 'auto_run_next_at',
  'auto_run_started_at', 'auto_run_error',
])

beforeEach(() => {
  h.inserts.length = 0
  h.signals = [{
    id: 'sig-1',
    client_id: 'client-1',
    flywheel: 'geo',
    metric_key: 'mention_rate',
    rule_id: 'geo_drop',
    severity: 'high',
    current_value: 1,
    reference_value: 4,
    delta_pct: -75,
    description: 'AI 提及掉了',
    detected_at: '2026-10-26T00:00:00.000Z',
  }]
})

describe('runProactivePass execution_items insert', () => {
  it('待办插入只用表现有的列，关联 id 写在 steps_json 里', async () => {
    const result = await runProactivePass()

    expect(result.errors).toEqual([])
    expect(result.total_acted).toBe(1)

    const exec = h.inserts.find((item) => item.table === 'execution_items')
    expect(exec).toBeTruthy()
    const rows = exec?.rows as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    for (const key of Object.keys(rows[0])) {
      expect(PROD_EXECUTION_ITEM_COLUMNS.has(key)).toBe(true)
    }
    expect(rows[0]).toEqual({
      client_id: 'client-1',
      dimension: 'ai_visibility',
      title: 'Investigate Seo Drop',
      description: '排名掉了，去看落地页',
      fix_type: 'me_auto',
      action_type: 'investigate_seo_drop',
      status: 'pending',
      source: 'proactive_signal',
      sort_order: 1,
      steps_json: {
        flywheel_action_id: 'action-1',
        anomaly_signal_id: 'sig-1',
      },
    })
    expect(rows[0]).not.toHaveProperty('payload')

    const action = h.inserts.find((item) => item.table === 'flywheel_actions')
    const actionRows = action?.rows as Array<{ payload: { source: string } }>
    expect(actionRows[0].payload.source).toBe('proactive_signal')
  })
})
