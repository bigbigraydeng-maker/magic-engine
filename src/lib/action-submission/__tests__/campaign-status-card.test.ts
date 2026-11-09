/**
 * Campaign pause and resume ask first. The write follows confirmation.
 * No live Meta calls. Ids here are short fakes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { KernelDeps } from '@/lib/kernel/deps'
import { pausedDraftClickUrl, CAMPAIGN_PAUSE_WHAT, CAMPAIGN_RESUME_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import {
  confirmCampaignStatusCard,
  requestCampaignStatusCard,
  type CampaignDeps,
  type CampaignHold,
  type CampaignRequest,
} from '../campaign-status-card'

const FP = 'a'.repeat(64)
const CLIENT = 'client-1'
const CAMP = 'camp-1'

const access = {
  ok: true,
  user: { id: 'user-1', email: 'client@example.com' },
  role: 'client-viewer',
  tier: 'paid_client',
  allowedClientId: CLIENT,
} as CampaignRequest['access']

const confirmed = {
  runId: 'run-1',
  expectedDecisionId: '11111111-1111-4111-8111-111111111111',
  fingerprint: FP,
  what: CAMPAIGN_PAUSE_WHAT,
  account: '已登记的广告账户',
  amount: '不改预算',
  date: '确认之后才改',
  scope: '只暂停这一个广告系列',
  expiresLabel: '很快过期',
  status: 'confirmed' as const,
  statusLine: '记下了',
  confirmEnabled: false,
  declineEnabled: false,
  blockedReason: null,
}

function memory() {
  const rows: Array<{ id: string; client_id: string; action_type: string; flywheel: string; payload: CampaignHold }> = []
  let n = 0
  const order: string[] = []
  const client = {
    from() {
      const filters: Array<[string, string]> = []
      let patch: { payload?: CampaignHold; expected_metric?: string | null; executed_at?: string } | null = null
      let inserted: { client_id: string; action_type: string; flywheel: string; payload: CampaignHold } | null = null
      const api = {
        select: () => api,
        eq(col: string, val: string) { filters.push([col, val]); return api },
        insert(row: typeof inserted) { inserted = row; return api },
        update(row: NonNullable<typeof patch>) {
          patch = row
          if (row.payload?.authorization) order.push('receipt')
          return api
        },
        maybeSingle: () => Promise.resolve(apply()),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(apply()).then(resolve),
      }
      function apply() {
        if (inserted) {
          rows.push({ id: `row-${++n}`, ...inserted })
          return { data: { id: rows[rows.length - 1]?.id }, error: null }
        }
        const matched = rows.filter((row) => filters.every(([col, val]) => matches(row, col, val)))
        if (!patch) return { data: matched, error: null }
        const one = matched.length === 1 ? matched[0] : null
        if (!one || !patch.payload) return { data: null, error: null }
        one.payload = patch.payload
        return { data: { id: one.id }, error: null }
      }
      return api
    },
  }
  return { client: client as unknown as KernelDeps['supabase'], rows, order }
}

function matches(row: { id: string; client_id: string; action_type: string; flywheel: string; payload: CampaignHold }, col: string, val: string): boolean {
  if (col === 'id') return row.id === val
  if (col === 'client_id') return row.client_id === val
  if (col === 'flywheel') return row.flywheel === val
  if (col === 'action_type') return row.action_type === val
  if (col === 'payload->>campaign_id') return row.payload.campaign_id === val
  if (col === 'payload->>status') return row.payload.status === val
  if (col === 'payload->>cardRunId') return row.payload.cardRunId === val
  return false
}

function deps(over: Partial<CampaignDeps> = {}): { used: CampaignDeps; order: string[] } {
  const order: string[] = []
  const used: CampaignDeps = {
    issue: vi.fn(async () => confirmed),
    decide: vi.fn(async () => confirmed),
    live: vi.fn(async () => ({ status: 'ACTIVE', accountId: '11', name: '系列' })),
    write: vi.fn(async () => { order.push('write'); return true }),
    messenger: vi.fn(async () => 'ok' as const),
    resumeAuthority: vi.fn(async () => ({ ok: false as const, status: 403 as const, error: 'no', code: 'activation_requires_pm' as const })),
    ...over,
  }
  return { used, order }
}

function request(kind: 'pause' | 'resume', liveStatus: string): CampaignRequest {
  return {
    clientId: CLIENT,
    access,
    kind,
    campaignId: CAMP,
    adAccountId: 'act_11',
    name: '系列',
    liveStatus,
    dailyBudget: null,
    objective: null,
    executionItemId: null,
  }
}

const click = {
  clientId: CLIENT,
  runId: 'run-1',
  clicker: { kind: 'opc' as const, email: 'ray@example.com' },
  resolution: 'confirm' as const,
  expectedDecisionId: confirmed.expectedDecisionId,
  fingerprint: FP,
}

describe('campaign status card', () => {
  it('a paid client can ask for a pause card, and nothing is written', async () => {
    const store = memory()
    const { used } = deps()
    const result = await requestCampaignStatusCard(store.client, request('pause', 'ACTIVE'), used)
    expect(result.status).toBe(202)
    expect(result.body.status).toBe('awaiting_confirmation')
    expect(result.body.wroteMeta).toBe(false)
    expect(used.write).not.toHaveBeenCalled()
    expect(used.issue).toHaveBeenCalledWith(CLIENT, { kind: 'agent', email: 'client@example.com' }, expect.anything())
  })

  it('confirms a pause once, then reads the paused status back', async () => {
    const store = memory()
    const { used, order } = deps({
      live: vi.fn()
        .mockResolvedValueOnce({ status: 'ACTIVE', accountId: '11', name: '系列' })
        .mockResolvedValueOnce({ status: 'PAUSED', accountId: '11', name: '系列' }),
    })
    await requestCampaignStatusCard(store.client, request('pause', 'ACTIVE'), used)
    const result = await confirmCampaignStatusCard(store.client, click, used)
    expect(order).toEqual(['write'])
    expect(used.write).toHaveBeenCalledTimes(1)
    expect(result.wroteMeta).toBe(true)
    expect(result.reason).toContain('回读是暂停')
    expect(store.rows[0]?.payload.status).toBe('executed')
  })

  it('records an expired or void card and does not write', async () => {
    for (const status of ['expired', 'voided'] as const) {
      const store = memory()
      const { used } = deps({
        decide: vi.fn(async () => ({
          ...confirmed,
          status,
          statusLine: status === 'expired' ? '过了 30 分钟没人点，这张卡作废了。' : '要做的事变了，这张旧卡作废了。',
        })),
      })
      await requestCampaignStatusCard(store.client, request('pause', 'ACTIVE'), used)
      const result = await confirmCampaignStatusCard(store.client, click, used)
      expect(used.write).not.toHaveBeenCalled()
      expect(result.wroteMeta).toBe(false)
      expect(result.reason).toContain('作废')
      expect(store.rows[0]?.payload.status).toBe('failed')
    }
  })

  it('refuses a resume unless the spend approver confirms, and writes the receipt first', async () => {
    const denied = memory()
    const no = deps({ live: vi.fn(async () => ({ status: 'PAUSED', accountId: '11', name: '系列' })) })
    await requestCampaignStatusCard(denied.client, request('resume', 'PAUSED'), no.used)
    const blocked = await confirmCampaignStatusCard(denied.client, click, no.used)
    expect(blocked.statusCode).toBe(403)
    expect(no.used.decide).not.toHaveBeenCalled()
    expect(no.used.write).not.toHaveBeenCalled()

    const store = memory()
    const yes = deps({
      live: vi.fn()
        .mockResolvedValueOnce({ status: 'PAUSED', accountId: '11', name: '系列' })
        .mockResolvedValueOnce({ status: 'ACTIVE', accountId: '11', name: '系列' }),
      write: vi.fn(async () => { store.order.push('write'); return true }),
      resumeAuthority: vi.fn(async () => ({ ok: true as const, actorUserId: 'u-pm', actorEmail: 'pm@example.com', basis: 'global_admin' as const })),
    })
    await requestCampaignStatusCard(store.client, request('resume', 'PAUSED'), yes.used)
    const result = await confirmCampaignStatusCard(store.client, click, yes.used)
    expect(store.order.indexOf('receipt')).toBeGreaterThan(-1)
    expect(store.order.indexOf('receipt')).toBeLessThan(store.order.indexOf('write'))
    expect(result.wroteMeta).toBe(true)
    expect(store.rows[0]?.payload.authorization?.schema).toBe('ads.spend_activation_receipt.v1')
  })

  it('does not write when the live campaign no longer matches', async () => {
    const store = memory()
    const { used } = deps({ live: vi.fn(async () => ({ status: 'PAUSED', accountId: '11', name: '系列' })) })
    await requestCampaignStatusCard(store.client, request('pause', 'ACTIVE'), used)
    const result = await confirmCampaignStatusCard(store.client, click, used)
    expect(result.statusCode).toBe(409)
    expect(used.decide).not.toHaveBeenCalled()
    expect(used.write).not.toHaveBeenCalled()
  })

  it('does not write again when the read-back mismatches', async () => {
    const store = memory()
    const { used } = deps({
      live: vi.fn(async () => ({ status: 'ACTIVE', accountId: '11', name: '系列' })),
    })
    await requestCampaignStatusCard(store.client, request('pause', 'ACTIVE'), used)
    const result = await confirmCampaignStatusCard(store.client, click, used)
    expect(used.write).toHaveBeenCalledTimes(1)
    expect(result.wroteMeta).toBe(true)
    expect(result.reason).toContain('没有再写一次')
    expect(store.rows[0]?.payload.status).toBe('failed')
  })

  it('routes both campaign cards to the confirm route, and the old board no longer names the writer', () => {
    expect(pausedDraftClickUrl('c1', 'r1', CAMPAIGN_PAUSE_WHAT)).toBe('/api/clients/c1/meta-ads/campaign-status-card/r1')
    expect(pausedDraftClickUrl('c1', 'r1', CAMPAIGN_RESUME_WHAT)).toBe('/api/clients/c1/meta-ads/campaign-status-card/r1')
    const route = readFileSync(join(process.cwd(), 'src/app/api/clients/[id]/meta-ads/execute/route.ts'), 'utf8')
    expect(route).not.toContain('setCampaignStatus')
  })
})
