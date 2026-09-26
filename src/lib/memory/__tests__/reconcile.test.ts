/**
 * 1b 对账的三个积木：哪些行该下架、归因什么时候算停摆、偏好什么时候按住不下架。
 * 用按表建模的假 Supabase，所以过滤条件写错时测试会红。
 */

import { describe, it, expect } from 'vitest'
import {
  applyDeactivations,
  loadAttributionHealth,
  planPreferenceDeactivations,
  type PreferenceRow,
} from '../reconcile'
import { makeFakeSupabase, type FakeDb, type Row } from './fake-supabase'

const NOW = new Date('2026-09-26T00:00:00Z')
const HOUR = 3_600_000
const iso = (msBeforeNow: number) => new Date(NOW.getTime() - msBeforeNow).toISOString()

function mem(id: string, clientId = 'client-a'): Row {
  return { id, client_id: clientId, is_active: true }
}

function run(
  id: string,
  status: string,
  finishedMsAgo: number | null,
  summary: unknown = { gsc: { errors: [], outcomes_written: 10 } },
): Row {
  return {
    id,
    job_name: 'attribution-cron',
    status,
    started_at: iso((finishedMsAgo ?? 0) + 60_000),
    finished_at: finishedMsAgo === null ? null : iso(finishedMsAgo),
    summary,
  }
}

function pref(id: string, over: Partial<PreferenceRow> = {}): PreferenceRow {
  return {
    id,
    content: "3 个动作 confirmed: action_type='cms_update_existing' 在 seo 飞轮持续跑赢",
    flywheel: 'seo',
    preference_type: 'format',
    is_active: true,
    extracted_from_table: 'flywheel_outcomes',
    ...over,
  }
}

const isActive = (db: FakeDb, table: string, id: string) =>
  (db[table] ?? []).find((r) => r.id === id)?.is_active

describe('applyDeactivations', () => {
  it('只切本客户的行：同一个 id 属于别的客户时不动', async () => {
    const db: FakeDb = { client_proven_patterns: [mem('p1'), mem('p2', 'client-b')] }
    const { errors } = await applyDeactivations(makeFakeSupabase(db), 'client-a', [
      { table: 'client_proven_patterns', id: 'p1', reason: 'stale' },
      { table: 'client_proven_patterns', id: 'p2', reason: 'stale' },
    ])
    expect(errors).toEqual([])
    expect(isActive(db, 'client_proven_patterns', 'p1')).toBe(false)
    expect(isActive(db, 'client_proven_patterns', 'p2')).toBe(true)
  })

  it('一张表写失败：另一张表照做，失败的不进回滚清单，错误带表名', async () => {
    const db: FakeDb = {
      client_proven_patterns: [mem('p1')],
      client_failed_experiments: [mem('f1')],
    }
    const supabase = makeFakeSupabase(db, { failUpdateOn: ['client_proven_patterns'] })
    const planned = [
      { table: 'client_proven_patterns' as const, id: 'p1', reason: 'stale' as const },
      { table: 'client_failed_experiments' as const, id: 'f1', reason: 'stale' as const },
    ]
    const { done, errors } = await applyDeactivations(supabase, 'client-a', planned)
    expect(done).toEqual([{ table: 'client_failed_experiments', id: 'f1', reason: 'stale' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('client_proven_patterns')
    expect(isActive(db, 'client_proven_patterns', 'p1')).toBe(true)
    expect(isActive(db, 'client_failed_experiments', 'f1')).toBe(false)
  })

  it('写的时候抛异常也不往外抛，其余照做', async () => {
    const db: FakeDb = {
      client_proven_patterns: [mem('p1')],
      client_failed_experiments: [mem('f1')],
    }
    const supabase = makeFakeSupabase(db, { throwUpdateOn: ['client_failed_experiments'] })
    const planned = [
      { table: 'client_proven_patterns' as const, id: 'p1', reason: 'stale' as const },
      { table: 'client_failed_experiments' as const, id: 'f1', reason: 'stale' as const },
    ]
    const r = await applyDeactivations(supabase, 'client-a', planned)
    expect(r.done).toEqual([{ table: 'client_proven_patterns', id: 'p1', reason: 'stale' }])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('simulated update exception')
    expect(isActive(db, 'client_failed_experiments', 'f1')).toBe(true)
  })

  it('超过一批（150 行）会分批写完', async () => {
    const rows = Array.from({ length: 151 }, (_, i) => mem(`p${i}`))
    const db: FakeDb = { client_proven_patterns: rows }
    const planned = rows.map((r) => ({
      table: 'client_proven_patterns' as const,
      id: r.id as string,
      reason: 'no_strong_verdict' as const,
    }))
    const { done, errors } = await applyDeactivations(makeFakeSupabase(db), 'client-a', planned)
    expect(done).toHaveLength(151)
    expect(errors).toEqual([])
    expect(db.client_proven_patterns.every((r) => r.is_active === false)).toBe(true)
  })

  it('没有要下架的行：什么都不写', async () => {
    const r = await applyDeactivations(makeFakeSupabase({}), 'client-a', [])
    expect(r).toEqual({ done: [], errors: [] })
  })
})

describe('loadAttributionHealth', () => {
  it('最近一次完成的运行在 24 小时内且 GSC 正常：健康', async () => {
    const db: FakeDb = { cron_run_logs: [run('r1', 'completed', 1 * HOUR)] }
    const health = await loadAttributionHealth(makeFakeSupabase(db), NOW)
    expect(health.healthy).toBe(true)
  })

  it('最近一次完成的运行超过 24 小时：停摆', async () => {
    const db: FakeDb = { cron_run_logs: [run('r1', 'completed', 25 * HOUR)] }
    const health = await loadAttributionHealth(makeFakeSupabase(db), NOW)
    expect(health.healthy).toBe(false)
    expect(health.detail).toContain('finished')
  })

  it('GSC 那一轮报错且一条都没写：停摆', async () => {
    const db: FakeDb = {
      cron_run_logs: [run('r1', 'completed', HOUR, { gsc: { errors: ['boom'], outcomes_written: 0 } })],
    }
    const health = await loadAttributionHealth(makeFakeSupabase(db), NOW)
    expect(health.healthy).toBe(false)
    expect(health.detail).toContain('GSC')
  })

  it('GSC 零星报错但写进了结论：不算停摆', async () => {
    const db: FakeDb = {
      cron_run_logs: [run('r1', 'completed', HOUR, { gsc: { errors: ['fetch failed'], outcomes_written: 630 } })],
    }
    const health = await loadAttributionHealth(makeFakeSupabase(db), NOW)
    expect(health.healthy).toBe(true)
  })

  it('更新的一条还在跑（running）不算数，看的是最后一次完成的', async () => {
    const stalled: FakeDb = { cron_run_logs: [run('r-old', 'completed', 30 * HOUR), run('r-new', 'running', null)] }
    expect((await loadAttributionHealth(makeFakeSupabase(stalled), NOW)).healthy).toBe(false)

    const ok: FakeDb = { cron_run_logs: [run('r-ok', 'completed', 2 * HOUR), run('r-new', 'running', null)] }
    expect((await loadAttributionHealth(makeFakeSupabase(ok), NOW)).healthy).toBe(true)
  })

  it('没有任何完成记录：停摆', async () => {
    const health = await loadAttributionHealth(makeFakeSupabase({ cron_run_logs: [] }), NOW)
    expect(health.healthy).toBe(false)
  })

  it('读不到运行记录：按停摆处理', async () => {
    const db: FakeDb = { cron_run_logs: [run('r1', 'completed', HOUR)] }
    const supabase = makeFakeSupabase(db, { failSelectOn: ['cron_run_logs'] })
    const health = await loadAttributionHealth(supabase, NOW)
    expect(health.healthy).toBe(false)
    expect(health.detail).toContain('unreadable')
  })

  it('运行记录没有 gsc 那一段：不因此判停摆', async () => {
    const db: FakeDb = { cron_run_logs: [run('r1', 'completed', HOUR, {})] }
    const health = await loadAttributionHealth(makeFakeSupabase(db), NOW)
    expect(health.healthy).toBe(true)
  })
})

describe('planPreferenceDeactivations', () => {
  it('支撑不足：下架', () => {
    expect(planPreferenceDeactivations([pref('x')], new Map(), 3)).toEqual({
      planned: [{ table: 'client_learned_preferences', id: 'x', reason: 'preference_no_support' }],
      held: 0,
    })
  })

  it('支撑够 3 个：留着', () => {
    const support = new Map([['seo::cms_update_existing', 3]])
    expect(planPreferenceDeactivations([pref('x')], support, 3)).toEqual({ planned: [], held: 0 })
  })

  it('归因停摆且这类动作的支撑可能只是被拉低：按住不下架，计数', () => {
    const hold = new Set(['seo::cms_update_existing'])
    expect(planPreferenceDeactivations([pref('x')], new Map(), 3, hold)).toEqual({ planned: [], held: 1 })
  })

  it('按住只管名单里的那一类，别的类照样下架', () => {
    const rows = [
      pref('x'),
      pref('y', { content: "3 个动作 confirmed: action_type='seo.refresh_blog' 在 seo 飞轮持续跑赢" }),
    ]
    const hold = new Set(['seo::cms_update_existing'])
    expect(planPreferenceDeactivations(rows, new Map(), 3, hold)).toEqual({
      planned: [{ table: 'client_learned_preferences', id: 'y', reason: 'preference_no_support' }],
      held: 1,
    })
  })

  it('别的来源写的偏好（周报汇总）不碰', () => {
    const rows = [pref('x', { extracted_from_table: 'learning_rollup_weekly' })]
    expect(planPreferenceDeactivations(rows, new Map(), 3)).toEqual({ planned: [], held: 0 })
  })

  it('名单外的支柱不碰', () => {
    const rows = [
      pref('x', {
        flywheel: 'geo',
        content: "3 个动作 confirmed: action_type='publish_geo_snippet' 在 geo 飞轮持续跑赢",
      }),
    ]
    expect(planPreferenceDeactivations(rows, new Map(), 3)).toEqual({ planned: [], held: 0 })
  })

  it('已经停用的、没有 action_type 标记的都不碰', () => {
    const rows = [pref('a', { is_active: false }), pref('b', { content: 'free text without marker' })]
    expect(planPreferenceDeactivations(rows, new Map(), 3)).toEqual({ planned: [], held: 0 })
  })
})
