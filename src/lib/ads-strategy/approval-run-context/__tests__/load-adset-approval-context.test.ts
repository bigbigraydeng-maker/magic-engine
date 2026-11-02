import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/kernel/__tests__/fake-supabase'
import { loadAdsetApprovalContext } from '../load-adset-approval-context'
import { readbackDisplayLabel } from '../types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const ADSET = '52596939123725'
const NOW = new Date('2026-11-02T12:00:00.000Z')

afterEach(() => {
  vi.useRealTimers()
})

function runRow(partial: Row): Row {
  return {
    client_id: CLIENT,
    action_key: 'ads.scale_unit_budget',
    action_version: 1,
    idempotency_key: 'k',
    input: { adset_id: ADSET, ad_account_id: 'act_demo' },
    ...partial,
  }
}

describe('loadAdsetApprovalContext', () => {
  it('有上次动作时返回摘要与读回', async () => {
    const prevId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const currentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: currentId,
          status: 'pending_approval',
          created_at: '2026-11-02T11:00:00Z',
          finished_at: null,
        }),
        runRow({
          id: prevId,
          action_key: 'ads.auto_pause_on_d3',
          status: 'succeeded',
          finished_at: '2026-10-01T10:00:00Z',
        }),
      ],
      action_run_steps: [{
        run_id: prevId,
        step_key: 'readback',
        status: 'succeeded',
        verification: { passed: true, method: 'ads_readback_integrity' },
      }],
    })

    const ctx = await loadAdsetApprovalContext(sb, {
      clientId: CLIENT,
      adsetId: ADSET,
      thisRunId: currentId,
      thisRunStatus: 'pending_approval',
      now: NOW,
    })
    expect(ctx.lastOnAdset.kind).toBe('ok')
    if (ctx.lastOnAdset.kind === 'ok') {
      expect(ctx.lastOnAdset.data.summary).toContain('D3')
      expect(readbackDisplayLabel(ctx.lastOnAdset.data.readback)).toBe('读回一致')
    }
    expect(ctx.cooldown.kind).toBe('clear')
    expect(ctx.thisRunReadback).toBe('pending')
  })

  it('无上次动作时为 none', async () => {
    const currentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: currentId,
          status: 'pending_approval',
          finished_at: null,
        }),
      ],
      action_run_steps: [],
    })
    const ctx = await loadAdsetApprovalContext(sb, {
      clientId: CLIENT,
      adsetId: ADSET,
      thisRunId: currentId,
      thisRunStatus: 'pending_approval',
      now: NOW,
    })
    expect(ctx.lastOnAdset.kind).toBe('none')
  })

  it('72 小时内同组有动作时给出冷却说明', async () => {
    const currentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const prevId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const finishedAt = '2026-11-02T06:00:00.000Z'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: currentId,
          status: 'pending_approval',
          finished_at: null,
        }),
        runRow({
          id: prevId,
          status: 'succeeded',
          finished_at: finishedAt,
        }),
      ],
      action_run_steps: [],
    })
    const ctx = await loadAdsetApprovalContext(sb, {
      clientId: CLIENT,
      adsetId: ADSET,
      thisRunId: currentId,
      thisRunStatus: 'pending_approval',
      now: NOW,
    })
    expect(ctx.cooldown.kind).toBe('ok')
    if (ctx.cooldown.kind === 'ok') {
      expect(ctx.cooldown.data.untilIso).toBe(new Date(Date.parse(finishedAt) + 72 * 3_600_000).toISOString())
    }
  })

  it('读回不一致时标 inconsistent', async () => {
    const runId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: runId,
          status: 'succeeded',
          finished_at: '2026-10-15T08:00:00Z',
        }),
      ],
      action_run_steps: [{
        run_id: runId,
        step_key: 'readback',
        status: 'succeeded',
        verification: { passed: false, method: 'ads_readback_integrity' },
      }],
    })
    const ctx = await loadAdsetApprovalContext(sb, {
      clientId: CLIENT,
      adsetId: ADSET,
      thisRunId: runId,
      thisRunStatus: 'succeeded',
      now: NOW,
    })
    expect(ctx.thisRunReadback).toBe('inconsistent')
    expect(readbackDisplayLabel(ctx.thisRunReadback)).toBe('读回不一致')
  })
})
