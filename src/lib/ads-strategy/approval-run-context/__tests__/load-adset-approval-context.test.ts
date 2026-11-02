import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/kernel/__tests__/fake-supabase'
import {
  cooldownEntityIdsFromRunInput,
  loadAdsetApprovalContext,
  readbackFromSteps,
  verificationStepKeysForAction,
} from '../load-adset-approval-context'
import { readbackDisplayLabel } from '../types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const ADSET = '52596939123725'
const CAMPAIGN = '120210987654321'
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

describe('verificationStepKeysForAction', () => {
  it('D3 用 verify，不用 readback', () => {
    expect(verificationStepKeysForAction('ads.auto_pause_on_d3')).toEqual(['verify'])
  })

  it('O1 用 readback', () => {
    expect(verificationStepKeysForAction('ads.scale_unit_budget')).toEqual(['readback'])
  })
})

describe('readbackFromSteps', () => {
  it('pending 批准前若步上已有 verification.passed false，先报 inconsistent', () => {
    const display = readbackFromSteps(
      [{
        step_key: 'readback',
        status: 'failed',
        verification: { passed: false, method: 'ads_readback_integrity' },
      }],
      'ads.scale_unit_budget',
      'pending_approval',
    )
    expect(display).toBe('inconsistent')
  })
})

describe('cooldownEntityIdsFromRunInput', () => {
  it('CBO O1 含 campaign_id 时与 envelope 一致查系列+广告组', () => {
    expect(
      cooldownEntityIdsFromRunInput(
        'ads.scale_unit_budget',
        { adset_id: ADSET, campaign_id: CAMPAIGN },
        ADSET,
      ),
    ).toEqual([CAMPAIGN, ADSET])
  })
})

describe('loadAdsetApprovalContext', () => {
  it('有上次动作时返回摘要与读回（D3 从 verify 步读 verification）', async () => {
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
        step_key: 'verify',
        status: 'succeeded',
        verification: { passed: true, method: 'ads_pause_integrity' },
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

  it('CBO O1：系列级近期动作也触发冷却（不只查广告组）', async () => {
    const currentId = '11111111-1111-4111-8111-111111111111'
    const campaignRunId = '22222222-2222-4222-8222-222222222222'
    const finishedAt = '2026-11-02T06:00:00.000Z'
    const otherAdset = '99988877766655'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: currentId,
          status: 'pending_approval',
          finished_at: null,
          input: {
            adset_id: ADSET,
            campaign_id: CAMPAIGN,
            ad_account_id: 'act_demo',
          },
        }),
        runRow({
          id: campaignRunId,
          action_key: 'ads.scale_unit_budget',
          status: 'succeeded',
          finished_at: finishedAt,
          input: {
            campaign_id: CAMPAIGN,
            adset_id: otherAdset,
            ad_account_id: 'act_demo',
          },
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
  })

  it('读回不一致时标 inconsistent（已完成 run）', async () => {
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

  it('O1 读回步失败且 verification 已落库时 pending 仍显示不一致', async () => {
    const runId = '33333333-3333-4333-8333-333333333333'
    const sb = createFakeSupabase({
      action_runs: [
        runRow({
          id: runId,
          status: 'pending_approval',
          finished_at: null,
        }),
      ],
      action_run_steps: [{
        run_id: runId,
        step_key: 'readback',
        status: 'failed',
        verification: { passed: false, method: 'ads_readback_integrity' },
      }],
    })
    const ctx = await loadAdsetApprovalContext(sb, {
      clientId: CLIENT,
      adsetId: ADSET,
      thisRunId: runId,
      thisRunStatus: 'pending_approval',
      now: NOW,
    })
    expect(ctx.thisRunReadback).toBe('inconsistent')
  })
})
