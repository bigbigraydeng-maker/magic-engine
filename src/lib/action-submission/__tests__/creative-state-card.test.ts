/**
 * Creative-state cards write only after confirm, and only once.
 * No live Meta calls. Ids here are short fakes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import { pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import { CREATIVE_MOVE_WHAT, CREATIVE_PAUSE_WHAT, CREATIVE_PLAN_WHAT } from '@/lib/creative-state/copy'
import type { CreativeProposal } from '@/lib/creative-state/rules'
import {
  confirmCreativeStateCard,
  proposeCreativeStateCards,
  type ConfirmCreativeInput,
  type CreativeHold,
  type CreativePorts,
} from '../creative-state-card'

vi.mock('@/lib/confirmation-card', () => ({
  issueConfirmationCard: vi.fn(),
  decideConfirmationCard: vi.fn(),
}))

const CLIENT = 'client-1'
const NOW = new Date('2026-11-09T01:00:00.000Z')
const FP = 'b'.repeat(64)

function proposal(kind: CreativeProposal['kind']): CreativeProposal {
  const ad = {
    adId: kind === 'pause' ? 'ad-z' : 'ad-1', name: '春季', stage: 'test' as const, status: 'ACTIVE' as const,
    liveDays: 7, leads: kind === 'pause' ? 1 : 10, spend: 40, postId: 'post-1', pageId: 'page-1',
    adAccountId: 'act_1', adsetId: 'set-test',
  }
  if (kind === 'pause') return { kind, ad }
  if (kind === 'new_plan') return { kind, ad, scaleAdsetId: 'set-scale', raiseDaily: 2, nextDailyTotal: 12 }
  return { kind, ad, scaleAdsetId: 'set-scale' }
}

function hold(over: Partial<CreativeHold> = {}): CreativeHold {
  return {
    kind: 'move_to_scale', status: 'holding', cardRunId: 'run-1', subjectKey: 'cscale:abc', fingerprint: FP,
    proposedOn: '2026-11-09', adId: 'ad-1', name: '春季', adsetId: 'set-test', scaleAdsetId: 'set-scale',
    postId: 'post-1', pageId: 'page-1', adAccountId: 'act_1', writeAttempted: false, wroteMeta: false,
    readback: null, confirmedBy: null, ...over,
  }
}

function store(seed: CreativeHold[] = []) {
  const rows = seed.map((payload, index) => ({
    id: `row-${index + 1}`, client_id: CLIENT, action_type: 'ads.creative_state_proposal', payload,
  }))
  const client = {
    from() {
      const filters: Array<[string, string]> = []
      let patch: { payload?: CreativeHold } | null = null
      const api = {
        select: () => api,
        eq(col: string, val: string) { filters.push([col, val]); return api },
        insert(row: { payload: CreativeHold }) {
          rows.push({ id: `row-${rows.length + 1}`, client_id: CLIENT, action_type: 'ads.creative_state_proposal', payload: row.payload })
          return Promise.resolve({ error: null })
        },
        update(next: { payload: CreativeHold }) { patch = next; return api },
        maybeSingle: () => Promise.resolve(finish()),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(finish()).then(resolve),
      }
      function finish() {
        const matched = rows.filter((item) => filters.every(([col, val]) => matches(item, col, val)))
        if (!patch?.payload) return { data: matched.map((item) => ({ id: item.id, payload: item.payload })), error: null }
        const one = matched.length === 1 ? matched[0] : null
        if (!one) return { data: null, error: null }
        one.payload = patch.payload
        return { data: { id: one.id }, error: null }
      }
      return api
    },
  }
  return { rows, client: client as unknown as SupabaseClient }
}

function matches(row: { id: string; client_id: string; action_type: string; payload: CreativeHold }, col: string, val: string): boolean {
  if (col === 'id') return row.id === val
  if (col === 'client_id') return row.client_id === val
  if (col === 'action_type') return row.action_type === val
  if (col === 'payload->>status') return row.payload.status === val
  if (col === 'payload->>cardRunId') return row.payload.cardRunId === val
  return false
}

function kernel(sb: SupabaseClient): KernelDeps {
  return { supabase: sb, now: () => NOW } as KernelDeps
}

const view = {
  runId: 'run-1', expectedDecisionId: 'decision-1', fingerprint: FP, what: CREATIVE_MOVE_WHAT,
  account: '这位客户的广告账户', amount: '不改预算', date: '确认之后才建，先观察', scope: '不关正在测的那条，也不加预算',
  expiresLabel: '很快过期', status: 'confirmed' as const, statusLine: '记下了', confirmEnabled: false, declineEnabled: false,
  blockedReason: null,
}

function ports(over: Partial<CreativePorts> = {}): CreativePorts {
  return {
    decide: vi.fn(async () => view),
    recheck: vi.fn(async () => ({ proposals: [proposal('move_to_scale')], skipped: [] })),
    token: vi.fn(async () => 'token'),
    createPaused: vi.fn(async () => ({ adId: 'ad-new' })),
    readPlacement: vi.fn(async () => ({ status: 'PAUSED', adsetId: 'set-scale' })),
    pause: vi.fn(async () => ({ ok: true, wroteMeta: true, readback: 'PAUSED', reason: '已暂停，回读是暂停。' })),
    ...over,
  }
}

function input(over: Partial<ConfirmCreativeInput> = {}): ConfirmCreativeInput {
  return {
    clientId: CLIENT, runId: 'run-1', decisionId: 'decision-1', fingerprint: FP, choice: 'confirm',
    clicker: { kind: 'opc', email: 'person@example.com' },
    actor: { triggeredBy: 'human', triggeredByRef: 'session-user' }, ...over,
  }
}

describe('creative state cards', () => {
  beforeEach(() => {
    vi.mocked(issueConfirmationCard).mockReset().mockResolvedValue(view)
  })

  it('issues a card and does not ask for an ad write', async () => {
    const db = store()
    const used = ports()
    const out = await proposeCreativeStateCards(kernel(db.client), {
      clientId: CLIENT, clicker: { kind: 'agent', email: null }, decision: { proposals: [proposal('move_to_scale')], skipped: [] }, now: NOW,
    })
    expect(out.issued).toEqual([{ kind: 'move_to_scale', runId: 'run-1' }])
    expect(used.createPaused).not.toHaveBeenCalled()
    expect(db.rows[0]?.payload.wroteMeta).toBe(false)
  })

  it('allows only one promotion card for a client on the same day', async () => {
    const db = store([hold()])
    const out = await proposeCreativeStateCards(kernel(db.client), {
      clientId: CLIENT, clicker: { kind: 'agent', email: null },
      decision: { proposals: [proposal('new_plan'), proposal('pause')], skipped: [] }, now: NOW,
    })
    expect(out.issued.map((item) => item.kind)).toEqual(['pause'])
    expect(out.skipped).toContain('promotion_cap')
  })

  it('creates a paused scale ad once, and does not write again when the read-back disagrees', async () => {
    const db = store([hold()])
    const used = ports()
    const ok = await confirmCreativeStateCard(kernel(db.client), input(), used)
    expect(ok.wroteMeta).toBe(true)
    expect(used.createPaused).toHaveBeenCalledTimes(1)
    const again = store([hold()])
    const bad = ports({ readPlacement: vi.fn(async () => ({ status: 'ACTIVE', adsetId: 'set-scale' })) })
    const failed = await confirmCreativeStateCard(kernel(again.client), input(), bad)
    expect(failed.wroteMeta).toBe(true)
    expect(bad.createPaused).toHaveBeenCalledTimes(1)
    expect(again.rows[0]?.payload.status).toBe('failed')
  })

  it('records a new plan without a budget write, and pauses only through the pause port', async () => {
    const planDb = store([hold({ kind: 'new_plan' })])
    const planPorts = ports({ recheck: vi.fn(async () => ({ proposals: [proposal('new_plan')], skipped: [] })) })
    const plan = await confirmCreativeStateCard(kernel(planDb.client), input(), planPorts)
    expect(plan.wroteMeta).toBe(false)
    expect(plan.resultLine).toContain('没有改正在跑的预算')
    expect(planPorts.createPaused).not.toHaveBeenCalled()
    const pauseDb = store([hold({ kind: 'pause', adId: 'ad-z' })])
    const pausePorts = ports({ recheck: vi.fn(async () => ({ proposals: [proposal('pause')], skipped: [] })) })
    const paused = await confirmCreativeStateCard(kernel(pauseDb.client), input(), pausePorts)
    expect(paused.wroteMeta).toBe(true)
    expect(pausePorts.pause).toHaveBeenCalledTimes(1)
    expect(pausePorts.createPaused).not.toHaveBeenCalled()
  })

  it('does not write when the card is declined, expired, stale, or already half-written', async () => {
    const declined = store([hold()])
    const declinePorts = ports({ decide: vi.fn(async () => ({ ...view, status: 'declined' as const })) })
    await confirmCreativeStateCard(kernel(declined.client), input({ choice: 'decline' }), declinePorts)
    expect(declinePorts.createPaused).not.toHaveBeenCalled()
    const expired = store([hold()])
    const expiredPorts = ports({ decide: vi.fn(async () => ({ ...view, status: 'expired' as const })) })
    await confirmCreativeStateCard(kernel(expired.client), input(), expiredPorts)
    expect(expiredPorts.createPaused).not.toHaveBeenCalled()
    const stale = store([hold()])
    const stalePorts = ports({ recheck: vi.fn(async () => ({ proposals: [], skipped: ['stale_snapshot'] })) })
    await expect(confirmCreativeStateCard(kernel(stale.client), input(), stalePorts)).rejects.toThrow(/没有改/)
    expect(stalePorts.createPaused).not.toHaveBeenCalled()
    const stuck = store([hold({ status: 'writing', writeAttempted: true })])
    const stuckPorts = ports()
    const quiet = await confirmCreativeStateCard(kernel(stuck.client), input(), stuckPorts)
    expect(quiet.wroteMeta).toBe(false)
    expect(stuckPorts.createPaused).not.toHaveBeenCalled()
  })

  it('sends the three cards to the creative-state confirm route', () => {
    for (const what of [CREATIVE_MOVE_WHAT, CREATIVE_PLAN_WHAT, CREATIVE_PAUSE_WHAT]) {
      expect(pausedDraftClickUrl(CLIENT, 'run-1', what)).toBe('/api/clients/client-1/meta-ads/creative-state-cards/run-1')
    }
  })
})
