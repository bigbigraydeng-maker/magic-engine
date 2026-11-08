import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('../../client', () => ({ inngest: { createFunction: vi.fn(() => ({})) }, CLOUD_FN_PREFIX: 'cloud-' }))

import { CRM_DNC_REENGAGE_CRON, sweepOneClient, writeClientsFromEnv, type ReengageSweepDeps } from '../crm-dnc-reengage-sweep'
import type { ReengageCandidate } from '@/lib/crm/dnc-reengage-store'

const CLIENT = 'C0000000-0000-0000-0000-000000000000'

// Verdict 2026-10-01, customer fills a form a day later → the pure rule says clear.
const comesBack: ReengageCandidate = {
  contactId: 'contact-1',
  input: {
    asOf: '2026-11-08T00:00:00.000Z',
    contactFlag: true,
    reason: null,
    touches: [
      { id: 'v1', source: 'me_manual', channel: 'phone', direction: 'outbound', occurredAt: '2026-10-01T00:00:00.000Z', outcome: 'do_not_contact' },
      { id: 'f1', source: 'meta_lead_form', channel: 'meta_lead_form', direction: 'inbound', occurredAt: '2026-10-02T00:00:00.000Z' },
    ],
    inboundMessages: [],
  },
}

type Spied = ReengageSweepDeps & {
  applyClear: ReturnType<typeof vi.fn>
  sendCleared: ReturnType<typeof vi.fn>
  repairMirror: ReturnType<typeof vi.fn>
}

function deps(writeClients: string | undefined, candidates: ReengageCandidate[] = [comesBack]): Spied {
  return {
    startRun: vi.fn(async () => undefined),
    finishRun: vi.fn(async () => undefined),
    listClients: vi.fn(async () => [CLIENT]),
    loadCandidates: vi.fn(async () => candidates),
    applyClear: vi.fn(async () => ({ written: true, touchpointId: 'tp-1' })),
    repairMirror: vi.fn(async () => undefined),
    sendCleared: vi.fn(async () => undefined),
    writeClients: () => writeClientsFromEnv(writeClients),
    now: () => new Date('2026-11-08T00:00:00.000Z'),
  }
}

describe('sweepOneClient', () => {
  it('rehearsal (env unset) never writes or sends, but reports who would be cleared', async () => {
    const d = deps(undefined)
    const r = await sweepOneClient(CLIENT, d)
    expect(r.rehearsal).toBe(true)
    expect(r.wouldClear).toBe(1)
    expect(r.cleared).toBe(0)
    expect(r.clears).toEqual([expect.objectContaining({ contactId: 'contact-1', written: false })])
    expect(d.applyClear).not.toHaveBeenCalled()
    expect(d.sendCleared).not.toHaveBeenCalled()
  })

  it('a different client in the env list keeps this client in rehearsal', async () => {
    const d = deps('d5c98811-1c1d-4ded-bdf0-4cefec6afb84')
    const r = await sweepOneClient(CLIENT, d)
    expect(r.rehearsal).toBe(true)
    expect(d.applyClear).not.toHaveBeenCalled()
  })

  it('listed client (case-insensitive) writes and sends one event with a stable id', async () => {
    const d = deps(` ${CLIENT.toLowerCase()} `)
    const r = await sweepOneClient(CLIENT, d)
    expect(r.rehearsal).toBe(false)
    expect(r.cleared).toBe(1)
    expect(d.applyClear).toHaveBeenCalledTimes(1)
    expect(d.sendCleared).toHaveBeenCalledWith(expect.objectContaining({ id: 'dnc-reengage:contact-1:f1' }))
  })

  it('DM-only comeback is listed for review and never written, even for a listed client', async () => {
    const dmOnly: ReengageCandidate = {
      contactId: 'contact-2',
      input: {
        ...comesBack.input,
        touches: [comesBack.input.touches[0]],
        inboundMessages: [{ id: 'm1', channel: 'messenger', sentAt: '2026-10-05T00:00:00.000Z', body: 'Is May still open?' }],
      },
    }
    const d = deps(CLIENT, [dmOnly])
    const r = await sweepOneClient(CLIENT, d)
    expect(r.reviews).toEqual([expect.objectContaining({ contactId: 'contact-2', triggerKind: 'message' })])
    expect(r.cleared).toBe(0)
    expect(d.applyClear).not.toHaveBeenCalled()
  })

  it('a fresh re-read that disagrees skips the write and sends nothing', async () => {
    const d = deps(CLIENT)
    d.applyClear.mockResolvedValueOnce({ written: false, touchpointId: null })
    const r = await sweepOneClient(CLIENT, d)
    expect(r.skippedOnReread).toBe(1)
    expect(r.cleared).toBe(0)
    expect(d.sendCleared).not.toHaveBeenCalled()
  })

  it('stale mirror (column true, judge says cleared) is repaired only outside rehearsal', async () => {
    const stale: ReengageCandidate = {
      contactId: 'contact-3',
      input: {
        ...comesBack.input,
        touches: [
          ...comesBack.input.touches,
          { id: 'c1', source: 'me_system', channel: 'phone', direction: 'outbound', occurredAt: '2026-10-02T00:00:00.000Z', outcome: 'dnc_cleared' },
        ],
      },
    }
    const rehearsal = deps(undefined, [stale])
    await sweepOneClient(CLIENT, rehearsal)
    expect(rehearsal.repairMirror).not.toHaveBeenCalled()

    const live = deps(CLIENT, [stale])
    const r = await sweepOneClient(CLIENT, live)
    expect(live.repairMirror).toHaveBeenCalledWith(CLIENT, 'contact-3')
    expect(r.mirrorRepaired).toBe(1)
  })
})

describe('cron registry entry', () => {
  it('watches the schedule the code defines (no hand-copied schedule)', async () => {
    const { CRON_REGISTRY } = await import('@/lib/cron/registry')
    const entry = CRON_REGISTRY.find((e) => e.service === 'inngest:cloud-crm-dnc-reengage-sweep')
    expect(entry).toBeDefined()
    expect(entry?.schedule).toBe(CRM_DNC_REENGAGE_CRON.replace(/^TZ=\S+\s+/, ''))
    expect(entry?.scheduler).toBe('inngest')
    expect(entry?.logsRuns).toBe(true)
  })
})
