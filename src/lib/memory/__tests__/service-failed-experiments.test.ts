/**
 * client_failed_experiments 的读侧闸门。
 *
 * 这张表建表时（20260610000001）漏了 is_active，另外两张记忆表都有。于是
 * 「这招不管用」一旦写进来就撤不掉 —— 哪怕同一个动作后来被证明有效。
 * 20260812100000 补了列，读侧必须跟着过滤，否则下架等于没发生：抽取器把行
 * 关掉了，agent 照样读到。
 */

import { describe, it, expect } from 'vitest'
import { loadMemoryForClient, setDerivedMemoryActive } from '../service'
import { makeFakeSupabase, type FakeDb } from './fake-supabase'

const CLIENT = 'client-a'

function dbWith(experiments: FakeDb['x']): FakeDb {
  return {
    clients: [{ id: CLIENT, industry: 'tourism' }],
    client_learned_preferences: [],
    client_proven_patterns: [],
    client_failed_experiments: experiments,
    client_decision_history: [],
    global_learned_lessons: [],
  }
}

describe('loadFailedExperiments', () => {
  it('已下架的失败经验不再喂给 agent', async () => {
    const db = dbWith([
      { id: 'e1', client_id: CLIENT, experiment_description: '还在生效的教训', failure_reason: 'x', is_active: true,  created_at: '2026-06-01T00:00:00Z' },
      { id: 'e2', client_id: CLIENT, experiment_description: '已被推翻的教训', failure_reason: 'y', is_active: false, created_at: '2026-06-02T00:00:00Z' },
    ])

    const memory = await loadMemoryForClient(makeFakeSupabase(db), CLIENT)

    expect(memory.failed_experiments).toHaveLength(1)
    expect(memory.failed_experiments[0].experiment_description).toBe('还在生效的教训')
  })

  it('全部下架后 has_content 变 false —— 不再凭空输出记忆块', async () => {
    const db = dbWith([
      { id: 'e1', client_id: CLIENT, experiment_description: '已被推翻', failure_reason: 'y', is_active: false, created_at: '2026-06-01T00:00:00Z' },
    ])

    const memory = await loadMemoryForClient(makeFakeSupabase(db), CLIENT)

    expect(memory.failed_experiments).toHaveLength(0)
    expect(memory.has_content).toBe(false)
  })
})

describe('setDerivedMemoryActive', () => {
  it('按动作身份上下架，不误伤同客户的其他动作', async () => {
    const db = dbWith([
      { id: 'e1', client_id: CLIENT, source_action_id: 'act-1', is_active: true, experiment_description: 'a', failure_reason: 'r', created_at: '2026-06-01T00:00:00Z' },
      { id: 'e2', client_id: CLIENT, source_action_id: 'act-2', is_active: true, experiment_description: 'b', failure_reason: 'r', created_at: '2026-06-01T00:00:00Z' },
    ])
    const supabase = makeFakeSupabase(db)

    const changed = await setDerivedMemoryActive(
      supabase, 'client_failed_experiments', CLIENT, 'act-1', false,
    )

    expect(changed).toBe(1)
    expect(db.client_failed_experiments.find(r => r.id === 'e1')?.is_active).toBe(false)
    expect(db.client_failed_experiments.find(r => r.id === 'e2')?.is_active).toBe(true)
  })

  it('已经是目标状态时不重复改，返回 0', async () => {
    const db = dbWith([
      { id: 'e1', client_id: CLIENT, source_action_id: 'act-1', is_active: false, experiment_description: 'a', failure_reason: 'r', created_at: '2026-06-01T00:00:00Z' },
    ])

    const changed = await setDerivedMemoryActive(
      makeFakeSupabase(db), 'client_failed_experiments', CLIENT, 'act-1', false,
    )

    expect(changed).toBe(0)
  })

  it('别的客户的同名动作绝不被波及', async () => {
    const db = dbWith([
      { id: 'e1', client_id: CLIENT,     source_action_id: 'act-1', is_active: true, experiment_description: 'a', failure_reason: 'r', created_at: '2026-06-01T00:00:00Z' },
      { id: 'e2', client_id: 'client-b', source_action_id: 'act-1', is_active: true, experiment_description: 'b', failure_reason: 'r', created_at: '2026-06-01T00:00:00Z' },
    ])

    await setDerivedMemoryActive(makeFakeSupabase(db), 'client_failed_experiments', CLIENT, 'act-1', false)

    expect(db.client_failed_experiments.find(r => r.id === 'e2')?.is_active).toBe(true)
  })
})
