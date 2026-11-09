/**
 * D3 暂停待批准的读法：真相是 `action_runs`，账表只补展示字段。
 *
 * 🔴 每条都对应一个真实失败形状：
 *   · 版本号取提交时写进账表的旧值 → run 被重签后这条永远批不了；
 *   · 按账表 status 过滤 → 账表漏记的 run 从页面和待办里消失（通用待办已不兜底）；
 *   · 审批请求挂歪了还给 id → 页面让人点一个必然失败的按钮；
 *   · 客户过滤可选 / 账表反查不看客户 → 别的客户的数据贴到这个客户页面上；
 *   · 升序截断 → 截掉的恰好是今天新出的那条。
 */

import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type Row, type FakeSupabaseOptions } from '@/lib/kernel/__tests__/fake-supabase'
import {
  listPendingAdsAutoPauseAllClients,
  listPendingAdsAutoPauseForClient,
} from '../auto-pause-pending'

const D3 = 'ads.auto_pause_on_d3'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

let seq = 0
function uuid(): string {
  seq += 1
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

interface Seed { runs: Row[]; decisions: Row[]; ledger: Row[] }

function pendingRun(seed: Seed, opts: { client?: string; status?: string; createdAt?: string; adset?: string } = {}) {
  const runId = uuid()
  const decisionId = uuid()
  const client = opts.client ?? CLIENT
  seed.runs.push({
    id: runId, client_id: client, action_key: D3, action_version: 1, idempotency_key: `k-${runId}`,
    status: opts.status ?? 'pending_approval', authorization_decision_id: decisionId,
    input: { ad_account_id: 'act_1', adset_id: opts.adset ?? 'adset-1', diagnosis_code: 'D3', insight_date: '2026-09-25' },
    rationale: '花钱没结果（run 自己的依据）', created_at: opts.createdAt ?? '2026-09-25T00:00:00Z',
  })
  seed.decisions.push({
    id: decisionId, action_run_id: runId, client_id: client, action_key: D3, action_version: 1,
    idempotency_key: `k-${runId}`, verdict: 'require_approval',
  })
  return { runId, decisionId }
}

function ledgerFor(seed: Seed, runId: string, payload: Row, client = CLIENT) {
  seed.ledger.push({
    id: uuid(), client_id: client, flywheel: 'ads', action_type: D3,
    payload: { status: 'awaiting_approval', action_run_id: runId, ...payload },
  })
}

function sb(seed: Seed, options: FakeSupabaseOptions = {}) {
  return createFakeSupabase(
    { action_runs: seed.runs, authorization_decisions: seed.decisions, flywheel_actions: seed.ledger },
    options,
  )
}

const empty = (): Seed => ({ runs: [], decisions: [], ledger: [] })

describe('版本号：取此刻 run 上挂着的那份，不取账表里提交时的旧值', () => {
  it('🔴 run 被重挂到新的审批请求 → 列表给新 id', async () => {
    const seed = empty()
    const { runId, decisionId } = pendingRun(seed)
    ledgerFor(seed, runId, { authorization_decision_id: '99999999-9999-4999-8999-999999999999', adset_name: '圣诞团' })

    const { items } = await listPendingAdsAutoPauseForClient(sb(seed), CLIENT)
    expect(items).toHaveLength(1)
    expect(items[0].expectedDecisionId).toBe(decisionId)
    expect(items[0].adsetName).toBe('圣诞团')
  })

  it('🔴 审批请求挂歪了（属于别的 run）→ 照列，但 id 为 null（不能批）', async () => {
    const seed = empty()
    const a = pendingRun(seed)
    const b = pendingRun(seed)
    seed.runs.find((r) => r.id === a.runId)!.authorization_decision_id = b.decisionId

    const { items } = await listPendingAdsAutoPauseForClient(sb(seed), CLIENT)
    expect(items.find((i) => i.runId === a.runId)!.expectedDecisionId).toBeNull()
    expect(items.find((i) => i.runId === b.runId)!.expectedDecisionId).toBe(b.decisionId)
  })
})

describe('真相是 action_runs', () => {
  it('🔴 账表漏记的 run 照样列出，展示字段回落到 run 自己的入参和依据', async () => {
    const seed = empty()
    const { runId } = pendingRun(seed, { adset: 'adset-orphan' })
    const { items } = await listPendingAdsAutoPauseAllClients(sb(seed))
    expect(items).toEqual([
      expect.objectContaining({
        runId, adsetId: 'adset-orphan', adsetName: null, diagnosisTitle: '花钱没结果（run 自己的依据）',
      }),
    ])
  })

  it('🔴 账表还写着 awaiting_approval、但 run 已经不在等批准 → 不列', async () => {
    const seed = empty()
    const { runId } = pendingRun(seed, { status: 'authorized' })
    ledgerFor(seed, runId, {})
    expect((await listPendingAdsAutoPauseForClient(sb(seed), CLIENT)).items).toEqual([])
  })

  it('补展示字段读失败 → 只降级（名字为空），待批准一条不少', async () => {
    const seed = empty()
    const { runId } = pendingRun(seed)
    ledgerFor(seed, runId, { adset_name: '圣诞团' })
    const { items } = await listPendingAdsAutoPauseForClient(
      sb(seed, { failOn: [{ table: 'flywheel_actions', op: 'select', message: 'boom' }] }),
      CLIENT,
    )
    expect(items).toHaveLength(1)
    expect(items[0].adsetName).toBeNull()
  })
})

describe('客户隔离', () => {
  it('🔴 客户版只返回这个客户的', async () => {
    const seed = empty()
    const mine = pendingRun(seed)
    pendingRun(seed, { client: OTHER_CLIENT })
    const { items } = await listPendingAdsAutoPauseForClient(sb(seed), CLIENT)
    expect(items.map((i) => i.runId)).toEqual([mine.runId])
  })

  it('🔴 账表里同一个 run id 挂在别的客户名下 → 不拿它的广告组名', async () => {
    const seed = empty()
    const { runId } = pendingRun(seed)
    ledgerFor(seed, runId, { adset_name: '别的客户的广告组' }, OTHER_CLIENT)
    const { items } = await listPendingAdsAutoPauseAllClients(sb(seed))
    expect(items[0].adsetName).toBeNull()
  })
})

describe('截断不静默、不丢最新的', () => {
  it('🔴 101 条 → 列最新的 100 条，hasMore=true，最老那条被截', async () => {
    const seed = empty()
    const ids = Array.from({ length: 101 }, (_, i) =>
      pendingRun(seed, { createdAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString() }).runId,
    )
    const { items, hasMore } = await listPendingAdsAutoPauseAllClients(sb(seed))
    expect(hasMore).toBe(true)
    expect(items).toHaveLength(100)
    expect(items[0].runId).toBe(ids[100])
    expect(items.map((i) => i.runId)).not.toContain(ids[0])
  })
})
