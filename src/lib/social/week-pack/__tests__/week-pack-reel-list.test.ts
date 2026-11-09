/**
 * Week card, scheduled mode: ticked reels are approved through the server-rebuilt week list (no preview tokens).
 * Non-scheduled mode keeps the per-reel preview path. The command parser checks the ticked list's shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WEEKLY_PACK_CADENCE } from '../cadence'
import { buildWeekPackFacts } from '../facts'
import { confirmWeekPack, type WeekPackPorts } from '../flow'
import { parseWeekPackCommand } from '../http'
import { reelListLines } from '../reel-list-lines'
import type { WeekPackManifest } from '../types'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'

const CLIENT = 'c0000000-0000-4000-8000-0000000000c1'
const WO = '33333333-3333-4333-8333-333333333333'
const OPC: CardClicker = { kind: 'opc', email: 'boss@example.com' }

function manifest(): WeekPackManifest {
  return {
    client_id: CLIENT, week_start: '2026-11-09', week_end: '2026-11-15', assembled_at: '2026-11-06T00:00:00.000Z',
    story: { read_state: 'ok', pack_id: null, title: null, state: null, content_hash: null, items: [] },
    posts: { connected: false, label: '尚未接入' },
    reels: { read_state: 'ok', truncated: false, items: [{ work_order_id: WO, title: '一条视频', fingerprint: null, scheduled_at_iso: '2026-11-10', video_state: 'DRAFT', date_state: 'in_week' }] },
  }
}

function card(fingerprint: string): ConfirmationCardView {
  return {
    runId: 'run-1', expectedDecisionId: 'dec-1', fingerprint, what: 'x', account: 'x', amount: 'x', date: 'x', scope: 'x',
    expiresLabel: 'x', status: 'confirmed', statusLine: 'x', confirmEnabled: false, declineEnabled: false, blockedReason: null,
  }
}

function setup(scheduled: boolean) {
  const m = manifest()
  const built = buildWeekPackFacts({ manifest: m, accountLabel: '示例客户', reelGoPublic: true, reelScheduled: scheduled })
  const promote = vi.fn(async () => ({ ok: true as const, code: 'reel_scheduled' as const, text: 'ok' }))
  const approveReels = vi.fn(async () => [{ kind: 'reel' as const, stable_id: WO, code: 'reel_scheduled', ok: true, text: '视频 2026-11-10 已批' }])
  const ports: WeekPackPorts = {
    loadManifest: async () => m,
    accountLabel: async () => '示例客户',
    cadence: () => DEFAULT_WEEKLY_PACK_CADENCE,
    reelGoPublic: true,
    reelScheduled: scheduled,
    issueCard: async () => card(built.fingerprint),
    decideCard: async (i) => card(i.fingerprint),
    authorizeStory: async () => ({ ok: true, code: 'story_authorized' }),
    revokeStory: async () => ({ ok: true, code: 'revoked', sent: 0, inFlight: 0, summaryAvailable: true }),
    promoteReel: promote,
    approveReels,
    recordUnpublished: async () => 'saved',
    voidPending: async () => 'voided',
  }
  return { ports, promote, approveReels, fingerprint: built.fingerprint }
}

const approval = { work_order_id: WO, fingerprint: 'fp-1', publish_on: '2026-11-10' }

describe('week card · reel list (scheduled mode)', () => {
  it('confirm sends the ticked reels to the list approval and never uses preview tokens', async () => {
    const s = setup(true)
    const r = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: s.fingerprint, tokens: new Map([[WO, 'token-token']]), reelApprovals: [approval], ports: s.ports,
    })
    expect(r.httpStatus).toBe(200)
    expect(s.approveReels).toHaveBeenCalledWith([approval])
    expect(s.promote).not.toHaveBeenCalled()
    expect(r.receipt?.lines.some((l) => l.text.includes('已批'))).toBe(true)
  })

  it('the week rolled over (or anything changed) between opening and clicking → refused before any reel is approved', async () => {
    const s = setup(true)
    const next = { ...manifest(), week_start: '2026-11-16', week_end: '2026-11-22' }
    const r = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: s.fingerprint, tokens: new Map(), reelApprovals: [approval], ports: { ...s.ports, loadManifest: async () => next },
    })
    expect(r.httpStatus).toBe(409)
    expect(s.approveReels).not.toHaveBeenCalled()
  })

  it('not scheduled: the old per-reel preview path is unchanged', async () => {
    const s = setup(false)
    await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: s.fingerprint, tokens: new Map([[WO, 'token-token']]), reelApprovals: [approval], ports: s.ports,
    })
    expect(s.approveReels).not.toHaveBeenCalled()
    expect(s.promote).toHaveBeenCalledWith(WO, 'token-token')
  })
})

describe('parseWeekPackCommand · reel_approvals', () => {
  const base = { action: 'confirm', run_id: 'r', fingerprint: 'f', expected_decision_id: 'd' }
  it('accepts a well-formed ticked list', () => {
    const c = parseWeekPackCommand({ ...base, reel_approvals: [approval] })
    expect('error' in c ? c.error : c.reelApprovals).toEqual([approval])
  })
  it('rejects a bad id, a bad day or too many items', () => {
    expect('error' in parseWeekPackCommand({ ...base, reel_approvals: [{ ...approval, work_order_id: 'x' }] })).toBe(true)
    expect('error' in parseWeekPackCommand({ ...base, reel_approvals: [{ ...approval, publish_on: '11/10' }] })).toBe(true)
    expect('error' in parseWeekPackCommand({ ...base, reel_approvals: Array.from({ length: 31 }, () => approval) })).toBe(true)
  })
})

describe('reelListLines', () => {
  it('approved → scheduled line with the day; refused → plain reason; unsaved receipt is said', () => {
    const lines = reelListLines({
      receipt_saved: false,
      items: [
        { work_order_id: WO, action: 'approve', outcome: 'armed', reason: null, fingerprint: 'f', publish_on: '2026-11-10' },
        { work_order_id: WO, action: 'approve', outcome: 'refused', reason: 'content_changed', fingerprint: null, publish_on: null },
      ],
    })
    expect(lines[0]).toMatchObject({ ok: true, code: 'reel_scheduled' })
    expect(lines[0].text).toContain('2026-11-10')
    expect(lines[1].text).toContain('内容跟你看到的不一样')
    expect(lines[2].text).toContain('记录没存上')
  })
})

describe('approveReelsFromWeekList · guards (no database reached)', async () => {
  vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
  const { approveReelsFromWeekList } = await import('../wire')
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient('http://localhost:1', 'test-key')
  const input = (email: string, allowedClientId: string | null) => ({ actor: { id: 'u', email, allowedClientId }, clientId: CLIENT, now: new Date('2026-11-06T00:00:00Z'), db })
  const admin = 'admin@example.com'
  beforeEach(() => { vi.stubEnv('ADMIN_EMAILS', admin) })
  afterEach(() => { vi.unstubAllEnvs() })
  it('switch off → nothing approved', async () => {
    expect((await approveReelsFromWeekList(input(admin, null), false, [approval]))[0].code).toBe('skipped_switch_off')
  })
  it('a client-scoped user or a non-admin email → refused', async () => {
    expect((await approveReelsFromWeekList(input(admin, CLIENT), true, [approval]))[0].code).toBe('reel_forbidden')
    expect((await approveReelsFromWeekList(input('someone@example.com', null), true, [approval]))[0].code).toBe('reel_forbidden')
  })
  it('admin with nothing ticked → says so, approves nothing', async () => {
    expect((await approveReelsFromWeekList(input(admin, null), true, []))[0].code).toBe('reel_none')
  })
})
