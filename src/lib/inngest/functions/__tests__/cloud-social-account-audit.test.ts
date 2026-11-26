import { describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_AUDIT_CRON, ACCOUNT_AUDIT_EVENT, ACCOUNT_AUDIT_FUNCTION_ID, ACCOUNT_AUDIT_JOB, createAccountAuditFunction, type AccountAuditDeps,
} from '../cloud-social-account-audit'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import type { AuditReel } from '@/lib/social/account-audit/audit'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

type Fn = ReturnType<typeof createAccountAuditFunction>
const opts = (fn: Fn) => Reflect.get(fn, 'opts') as { id?: string; triggers?: { cron?: string; event?: string }[]; retries?: number; concurrency?: { limit?: number } }
const handler = (fn: Fn) => Reflect.get(fn, 'fn') as (a: { event: unknown; step: unknown }) => Promise<{ status: string; as_of: string; clients: Array<{ client_id: string; error: string | null; over: number; not_measured: number }>; failures: string[]; no_publish: boolean }>
const step = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

const reel = (id: string, day: string, over: Partial<AuditReel> = {}): AuditReel => ({
  id, createdOn: day, template: 'postcard', engine: 'remotion', music: 'a.mp3', scenes: 3, brandColor: '#B61E2E', variantOf: null, format: null, pillar: null, ...over,
})

function deps(over: Partial<AccountAuditDeps> = {}): AccountAuditDeps {
  return {
    now: () => new Date('2026-11-08T18:00:00Z'), // Monday 07:00 NZ
    listClients: vi.fn(async () => [{ id: 'c1', config: {} }, { id: 'c2', config: {} }]),
    loadReels: vi.fn(async () => [reel('r1', '2026-11-01'), reel('r2', '2026-11-02')]),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    ...over,
  }
}

describe('social account audit function', () => {
  it('is registered: weekly cron + event, never retries, one at a time, in the cron registry', () => {
    const o = opts(createAccountAuditFunction(deps()))
    expect(o.id).toBe(`${CLOUD_FN_PREFIX}social-account-audit`)
    expect(o.id).toBe(ACCOUNT_AUDIT_FUNCTION_ID)
    expect(o.triggers?.[0]?.cron).toBe(ACCOUNT_AUDIT_CRON)
    expect(ACCOUNT_AUDIT_CRON).toBe('TZ=Pacific/Auckland 0 6 * * 1')
    expect(o.triggers?.[1]?.event).toBe(ACCOUNT_AUDIT_EVENT)
    expect(o.retries).toBe(0)
    expect(o.concurrency?.limit).toBe(1)
    const entry = CRON_REGISTRY.find((e) => e.jobName === ACCOUNT_AUDIT_JOB)
    expect(entry).toMatchObject({ scheduler: 'inngest', logsRuns: true, schedule: '0 6 * * 1' })
  })

  it('cron audits every client in the loop, writes one receipt row, never publishes', async () => {
    const d = deps()
    const out = await handler(createAccountAuditFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out).toMatchObject({ status: 'done', as_of: '2026-11-09', no_publish: true, failures: [], trigger: 'cron' })
    expect(out.clients.map((c) => c.client_id)).toEqual(['c1', 'c2'])
    expect(d.finishRun).toHaveBeenCalledTimes(1)
    const fin = vi.mocked(d.finishRun).mock.calls[0][0]
    expect(fin).toMatchObject({ processed: 2, completed: 2, failed: 0 })
    expect(fin.summary).toMatchObject({ kind: 'tick', no_publish: true })
  })

  it('one client failing to read does not stop the others and is reported as a failure', async () => {
    const d = deps({ loadReels: vi.fn(async (id: string) => { if (id === 'c1') throw new Error('db down'); return [reel('r1', '2026-11-01')] }) })
    const out = await handler(createAccountAuditFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out.clients[0]).toMatchObject({ client_id: 'c1', error: 'db down' })
    expect(out.clients[1].error).toBeNull()
    expect(out.failures).toEqual(['c1:db down'])
    expect(vi.mocked(d.finishRun).mock.calls[0][0]).toMatchObject({ failed: 1, completed: 1 })
  })

  it('an unreadable client list is a failure, not a silent empty run', async () => {
    const d = deps({ listClients: vi.fn(async () => { throw new Error('clients down') }) })
    const out = await handler(createAccountAuditFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out.status).toBe('list_failed')
    expect(out.failures[0]).toContain('clients down')
  })

  it('a manual event audits just that client, with an optional date', async () => {
    const d = deps()
    const out = await handler(createAccountAuditFunction(d))({ event: { name: ACCOUNT_AUDIT_EVENT, data: { clientId: 'c9', asOf: '2026-11-05' } }, step: step() })
    expect(out).toMatchObject({ trigger: 'event' })
    expect(out.clients.map((c) => c.client_id)).toEqual(['c9'])
    expect(out.as_of).toBe('2026-11-05')
    expect(d.listClients).not.toHaveBeenCalled()
  })

  it('a manual event without a client is refused loudly; a malformed date falls back to today', async () => {
    const d = deps()
    const bad = await handler(createAccountAuditFunction(d))({ event: { name: ACCOUNT_AUDIT_EVENT, data: {} }, step: step() })
    expect(bad.failures).toEqual(['invalid_event: clientId missing'])
    const odd = await handler(createAccountAuditFunction(d))({ event: { name: ACCOUNT_AUDIT_EVENT, data: { clientId: 'c1', asOf: '11/05/2026' } }, step: step() })
    expect(odd.as_of).toBe('2026-11-09')
  })

  it('reads work orders from 60 days before the audit date', async () => {
    const d = deps()
    await handler(createAccountAuditFunction(d))({ event: { name: ACCOUNT_AUDIT_EVENT, data: { clientId: 'c1', asOf: '2026-11-05' } }, step: step() })
    expect(d.loadReels).toHaveBeenCalledWith('c1', '2026-09-06T00:00:00.000Z')
  })
})
