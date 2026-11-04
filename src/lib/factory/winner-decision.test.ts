import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row, type Tables } from '@/lib/kernel/__tests__/fake-supabase'
import { mergePerformance, recordWinnerDecision, toBoardItem, WINNER_EVENT_CONFIRMED } from './winner-decision'
import { judgeWinner, pmOnlyFrom, type ConfirmerDirectory, type WinnerRow } from './winner-gate'

const STAMP = '2026-11-04T07:48:49.640Z'
const ID = '86948d4f-69db-426a-a68d-0f19a6058f96'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const DIR: ConfirmerDirectory = { isGlobalAdmin: (e) => e === 'pm@magiclab.nz', staffEmails: new Set(['lisa@ctstours.co.nz']), pmOnly: false }

function seed(performance: Record<string, unknown>, factoryConfig: Record<string, unknown> | null = { auto_order_enabled: false }): Tables {
  return {
    clients: [{ id: CLIENT, factory_config: factoryConfig }],
    winner_structures: [
      {
        id: ID,
        client_id: CLIENT,
        status: 'active',
        hook_segment: { description: 'price card first' },
        middle_segment: { description: 'one landmark one inclusion' },
        cta_segment: { description: 'end card repeats offer' },
        win_reason_tags: ['price_first_frame'],
        cost_per_thruplay: null,
        current_frequency: 2.62,
        updated_at: STAMP,
        performance,
      },
    ],
  }
}

/** 把假库里那一行按真表列读成 WinnerRow（逐列取，不做类型强转） */
function readRow(r: Row): WinnerRow {
  return {
    id: String(r.id), client_id: String(r.client_id), status: String(r.status), performance: r.performance,
    hook_segment: {}, middle_segment: {}, cta_segment: {}, win_reason_tags: [], cost_per_thruplay: null,
    current_frequency: null, updated_at: String(r.updated_at),
  }
}

function perfOf(tables: Tables): Record<string, unknown> {
  const p = tables.winner_structures[0].performance
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
}

const passed = { program_check: { state: 'passed', at: STAMP }, cost_per_result: 4.57, result_type: 'lead', leads: 116 }
const staff = { by: 'lisa@ctstours.co.nz', role: 'client_staff' as const }
const pm = { by: 'pm@magiclab.nz', role: 'magic_lab' as const }

describe('recordWinnerDecision', () => {
  it('认：只写 pm_decision / 历史，其它字段原样保留；回执带花费 0；发 confirmed 事件；之后可用', async () => {
    const tables = seed({ ...passed })
    const send = vi.fn().mockResolvedValue({ event_ids: ['e1'] })
    const res = await recordWinnerDecision(createFakeSupabase(tables), { winnerId: ID, decision: 'approved', ...staff, now: new Date(), send })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toMatchObject({ event_sent: true, cost_usd: 0, pm_only_marked: false, pm_only_failed: false })
    const perf = perfOf(tables)
    expect(perf.leads).toBe(116)
    expect(perf.program_check).toEqual(passed.program_check)
    expect(perf.pm_decision).toMatchObject({ decision: 'approved', role: 'client_staff' })
    expect(perf.pm_decision_history).toEqual([])
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: WINNER_EVENT_CONFIRMED, id: res.data.request_id }))
    const row = readRow(tables.winner_structures[0])
    expect(judgeWinner(row, Date.now(), DIR)).toMatchObject({ usable: true })
    expect(toBoardItem(row, Date.now(), DIR).state).toBe('confirmed')
  })

  it.each([
    ['没复核', { cost_per_result: 4.57 }],
    ['复核没完成（needs_human）', { ...passed, program_check: { state: 'needs_human', at: STAMP, reason: 'source_video_unavailable' } }],
    ['复核不合格（failed）', { ...passed, program_check: { state: 'failed', at: STAMP } }],
  ])('%s → 409，不写', async (_name, perf) => {
    const tables = seed(perf)
    const res = await recordWinnerDecision(createFakeSupabase(tables), { winnerId: ID, decision: 'approved', ...pm, now: new Date(), send: vi.fn() })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(perfOf(tables).pm_decision).toBeUndefined()
  })

  it('员工改不了 Magic Lab 定的决定 → 403；之前的决定保留', async () => {
    const tables = seed({ ...passed })
    const sb = createFakeSupabase(tables)
    await recordWinnerDecision(sb, { winnerId: ID, decision: 'approved', ...pm, now: new Date(), send: vi.fn() })
    const res = await recordWinnerDecision(sb, { winnerId: ID, decision: 'rejected', ...staff, now: new Date(Date.now() + 1000), send: vi.fn() })
    expect(res).toMatchObject({ ok: false, status: 403 })
    expect(perfOf(tables).pm_decision).toMatchObject({ decision: 'approved', role: 'magic_lab' })
  })

  it('PM 推翻员工认过的 → 历史留着上一次；这条赢家带只认 PM 标记（同一次写入）；客户配置同步只加两个键', async () => {
    const tables = seed({ ...passed })
    const sb = createFakeSupabase(tables)
    await recordWinnerDecision(sb, { winnerId: ID, decision: 'approved', ...staff, now: new Date(), send: vi.fn() })
    const res = await recordWinnerDecision(sb, { winnerId: ID, decision: 'rejected', ...pm, now: new Date(Date.now() + 1000), send: vi.fn() })
    expect(res.ok && res.data).toMatchObject({ pm_only_marked: true, pm_only_config_written: true, pm_only_failed: false })
    const perf = perfOf(tables)
    expect(Array.isArray(perf.pm_decision_history) && perf.pm_decision_history.length).toBe(1)
    expect(perf.pm_only_required).toMatchObject({ by: 'pm@magiclab.nz', reason: 'pm_overturned_staff_approval' })
    const cfg = tables.clients[0].factory_config as Record<string, unknown>
    expect(cfg.auto_order_enabled).toBe(false)
    expect(cfg.winner_confirm_pm_only).toBe(true)
    expect(cfg.winner_confirm_pm_only_receipt).toMatchObject({ by: 'pm@magiclab.nz', winner_id: ID })
  })

  it('客户配置写失败 → 不静默：回执 pm_only_failed=true 带原因；标记照样写进赢家行，之后员工确认的仍判不可用', async () => {
    const tables = seed({ ...passed })
    const sb = createFakeSupabase(tables, { failOn: [{ table: 'clients', op: 'update', message: 'gateway rejected' }] })
    await recordWinnerDecision(sb, { winnerId: ID, decision: 'approved', ...staff, now: new Date(), send: vi.fn() })
    const res = await recordWinnerDecision(sb, { winnerId: ID, decision: 'rejected', ...pm, now: new Date(Date.now() + 1000), send: vi.fn() })
    expect(res.ok && res.data).toMatchObject({ pm_only_marked: true, pm_only_config_written: false, pm_only_failed: true, pm_only_error: 'gateway rejected' })
    expect((tables.clients[0].factory_config as Record<string, unknown>).winner_confirm_pm_only).toBeUndefined()
    expect(perfOf(tables).pm_only_required).toBeDefined()
    const marked = readRow(tables.winner_structures[0])
    const dir = { ...DIR, pmOnly: pmOnlyFrom([marked], tables.clients[0].factory_config) }
    expect(dir.pmOnly).toBe(true)
  })

  it('历史最多留 20 条：连点 22 次只留最近的 20 条', async () => {
    const tables = seed({ ...passed })
    const sb = createFakeSupabase(tables)
    const t0 = Date.now()
    for (let i = 0; i < 22; i++) {
      const r = await recordWinnerDecision(sb, { winnerId: ID, decision: i % 2 ? 'rejected' : 'approved', ...pm, now: new Date(t0 + i * 1000), send: vi.fn() })
      expect(r.ok).toBe(true)
    }
    const history = perfOf(tables).pm_decision_history
    expect(Array.isArray(history) && history.length).toBe(20)
  })

  it('事件发不出去 → 决定照样记下，回执写明没发出去', async () => {
    const tables = seed({ ...passed })
    const send = vi.fn().mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    const res = await recordWinnerDecision(createFakeSupabase(tables), { winnerId: ID, decision: 'approved', ...pm, now: new Date(), send })
    expect(res.ok && res.data.event_sent).toBe(false)
    expect(res.ok && res.data.event_error).toBe('INNGEST_EVENT_KEY_MISSING')
    expect(perfOf(tables).pm_decision).toBeDefined()
  })
})

describe('mergePerformance 乐观锁', () => {
  it('拿着旧版本去写 → 409，不覆盖别人刚写的', async () => {
    const tables = seed({ ...passed })
    const stale = { id: ID, performance: { ...passed }, updated_at: '2026-01-01T00:00:00.000Z' }
    const res = await mergePerformance(createFakeSupabase(tables), stale, { frames: ['x.png'] }, new Date().toISOString())
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(perfOf(tables).frames).toBeUndefined()
  })
})

describe('看板状态', () => {
  it('复核没完成 → 不可用（不是等你认），原因如实', () => {
    const r = readRow(seed({ ...passed, program_check: { state: 'needs_human', at: STAMP, reason: 'source_video_unavailable' } }).winner_structures[0])
    expect(toBoardItem(r, Date.now(), DIR)).toMatchObject({ state: 'unusable', reason: 'program_check_not_passed' })
  })
})
