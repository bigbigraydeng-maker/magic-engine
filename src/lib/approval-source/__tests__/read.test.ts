import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import {
  approvalCardFields,
  approvalPlanHash,
  pauseCardWriteBlock,
  readApprovalSource,
  sameApprovalSource,
  type ApprovalSource,
} from '../read'

const CLIENT = 'client-1'
const OTHER = 'client-2'
const GOAL = 'goal-1'
const RX = 'rx-1'

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: RX,
    client_id: CLIENT,
    status: 'approved',
    version: 2,
    goal_id: GOAL,
    approved_at: '2026-11-08T01:00:00.000Z',
    generation_meta: {},
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    client_id: CLIENT,
    status: 'approved',
    plan_data: {},
    generation_meta: {
      from_prescription: { prescription_id: RX, version: 2 },
      blank_draft: { goal_id: GOAL },
      approval_receipt: { content_hash: 'hash-1' },
    },
    ...overrides,
  }
}

function db(extra: { prescriptions?: unknown[]; goals?: unknown[]; marketing_plans?: unknown[] } = {}) {
  return createFakeSupabase({
    prescriptions: extra.prescriptions ?? [prescription()],
    goals: extra.goals ?? [{ id: GOAL, client_id: CLIENT, status: 'active' }],
    marketing_plans: extra.marketing_plans ?? [plan()],
  })
}

describe('approval source', () => {
  it('reads one chain and ignores a manual draft', async () => {
    const sb = db({
      prescriptions: [
        prescription(),
        prescription({ id: 'rx-draft', status: 'draft', version: 3, supersedes_id: RX }),
      ],
    })
    const read = await readApprovalSource(sb, CLIENT, RX)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.source).toMatchObject({
      prescriptionId: RX,
      version: 2,
      goalId: GOAL,
      planId: 'plan-1',
      approvedOn: '2026-11-08',
      planHash: approvalPlanHash('plan-1', 'hash-1'),
    })
    expect(sameApprovalSource(read.source, { ...read.source })).toBe(true)
    expect(sameApprovalSource(read.source, { ...read.source, planId: 'plan-2' })).toBe(false)
  })

  it('does not follow another client or another goal', async () => {
    const otherClient = await readApprovalSource(db(), OTHER, RX)
    expect(otherClient.ok).toBe(false)
    const otherGoal = await readApprovalSource(db({
      marketing_plans: [plan({
        generation_meta: {
          from_prescription: { prescription_id: RX, version: 2 },
          blank_draft: { goal_id: 'goal-2' },
        },
      })],
    }), CLIENT, RX)
    expect(otherGoal.ok).toBe(false)
    if (otherGoal.ok) return
    expect(otherGoal.reason).toContain('已批准计划')
  })

  it('ignores an archived plan for the same goal and keeps the approved one', async () => {
    const read = await readApprovalSource(db({
      marketing_plans: [
        plan(),
        plan({ id: 'plan-old', status: 'archived' }),
      ],
    }), CLIENT, RX)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.source.planId).toBe('plan-1')
  })

  it('refuses two approved plans instead of picking one, and does not write', async () => {
    const log: Array<{ table: string; op: string; filters: unknown[] }> = []
    const sb = createFakeSupabase({
      prescriptions: [prescription()],
      goals: [{ id: GOAL, client_id: CLIENT, status: 'active' }],
      marketing_plans: [plan(), plan({ id: 'plan-2' })],
    }, { log: log as never })
    const read = await readApprovalSource(sb as SupabaseClient, CLIENT, RX)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toContain('没有选用')
    expect(log.some((entry) => entry.op === 'update' || entry.op === 'insert')).toBe(false)
  })

  it('blocks the pause write when the stored source is no longer that chain', async () => {
    const source: ApprovalSource = {
      prescriptionId: RX,
      version: 2,
      goalId: GOAL,
      planId: 'plan-1',
      planHash: approvalPlanHash('plan-1', 'hash-1'),
      approvedOn: '2026-11-08',
    }
    const blocked = await pauseCardWriteBlock(db({
      marketing_plans: [plan({ id: 'plan-1', status: 'draft' })],
    }), CLIENT, approvalCardFields(source))
    expect(blocked).toContain('已批准计划')
    expect(await pauseCardWriteBlock(db(), CLIENT, { adset_id: 'set-a' })).toBeNull()
  })
})
