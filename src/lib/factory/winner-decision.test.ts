import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row, type Tables } from '@/lib/kernel/__tests__/fake-supabase'
import { mergePerformanceSegment, recordWinnerDecision, toBoardItem, WINNER_EVENT_CONFIRMED } from './winner-decision'
import { judgeWinner, type WinnerRow } from './winner-gate'

const STAMP = '2026-11-04T07:48:49.640Z'
const ID = '86948d4f-69db-426a-a68d-0f19a6058f96'

function seed(performance: Record<string, unknown>): Tables {
  return {
    winner_structures: [
      {
        id: ID,
        client_id: 'c0000000-0000-0000-0000-000000000000',
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
    id: String(r.id),
    client_id: String(r.client_id),
    status: String(r.status),
    performance: r.performance,
    hook_segment: {},
    middle_segment: {},
    cta_segment: {},
    win_reason_tags: [],
    cost_per_thruplay: null,
    current_frequency: null,
    updated_at: String(r.updated_at),
  }
}

function perfOf(tables: Tables): Record<string, unknown> {
  const p = tables.winner_structures[0].performance
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
}

const checked = { program_check: { state: 'needs_human', at: STAMP, reason: 'source_video_unavailable' }, cost_per_result: 4.57, leads: 116 }

describe('recordWinnerDecision', () => {
  it('认：只写 pm_decision 一段，其它字段原样保留；发 confirmed 事件；之后可用', async () => {
    const tables = seed({ ...checked })
    const send = vi.fn().mockResolvedValue({ event_ids: ['e1'] })
    const res = await recordWinnerDecision(createFakeSupabase(tables), {
      winnerId: ID, decision: 'approved', by: 'lisa@ctstours.co.nz', role: 'client_staff', now: new Date(), send,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.event_sent).toBe(true)
    const perf = perfOf(tables)
    expect(perf.leads).toBe(116)
    expect(perf.program_check).toEqual(checked.program_check)
    expect(perf.pm_decision).toMatchObject({ decision: 'approved', role: 'client_staff', acknowledged_check_state: 'needs_human' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: WINNER_EVENT_CONFIRMED, id: res.data.request_id }))
    const row = readRow(tables.winner_structures[0])
    expect(judgeWinner(row, Date.now())).toEqual({ usable: true, costPerResult: 4.57 })
    expect(toBoardItem(row, Date.now()).state).toBe('confirmed')
  })

  it('还没复核 → 409，不写', async () => {
    const tables = seed({ cost_per_result: 4.57 })
    const res = await recordWinnerDecision(createFakeSupabase(tables), {
      winnerId: ID, decision: 'approved', by: 'pm@magiclab.nz', role: 'magic_lab', now: new Date(), send: vi.fn(),
    })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(perfOf(tables).pm_decision).toBeUndefined()
  })

  it('事件发不出去 → 决定照样记下，回执写明没发出去', async () => {
    const tables = seed({ ...checked })
    const send = vi.fn().mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    const res = await recordWinnerDecision(createFakeSupabase(tables), {
      winnerId: ID, decision: 'approved', by: 'pm@magiclab.nz', role: 'magic_lab', now: new Date(), send,
    })
    expect(res.ok && res.data.event_sent).toBe(false)
    expect(res.ok && res.data.event_error).toBe('INNGEST_EVENT_KEY_MISSING')
    expect(perfOf(tables).pm_decision).toBeDefined()
  })

  it('PM 推翻员工认过的 → 回执建议改回只认 PM', async () => {
    const tables = seed({ ...checked })
    const sb = createFakeSupabase(tables)
    await recordWinnerDecision(sb, { winnerId: ID, decision: 'approved', by: 'lisa@ctstours.co.nz', role: 'client_staff', now: new Date(), send: vi.fn() })
    const res = await recordWinnerDecision(sb, { winnerId: ID, decision: 'rejected', by: 'pm@magiclab.nz', role: 'magic_lab', now: new Date(Date.now() + 1000), send: vi.fn() })
    expect(res.ok && res.data.suggest_pm_only).toBe(true)
  })
})

describe('mergePerformanceSegment 乐观锁', () => {
  it('拿着旧版本去写 → 409，不覆盖别人刚写的', async () => {
    const tables = seed({ ...checked })
    const stale = { id: ID, performance: { ...checked }, updated_at: '2026-01-01T00:00:00.000Z' }
    const res = await mergePerformanceSegment(createFakeSupabase(tables), stale, 'frames', ['x.png'], new Date().toISOString())
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(perfOf(tables).frames).toBeUndefined()
  })
})
