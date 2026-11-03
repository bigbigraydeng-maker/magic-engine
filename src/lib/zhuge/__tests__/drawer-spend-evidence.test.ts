import { describe, expect, it } from 'vitest'
import type { CardClicker } from '@/lib/confirmation-card'
import { loadSpendEvidence, type SpendEvidenceDb } from '../drawer-spend-evidence'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const NOW = new Date('2026-10-27T01:00:00.000Z')

function db(cap: unknown, logs: unknown): SpendEvidenceDb {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: cap, error: null }),
                order() {
                  return { limit: async () => ({ data: logs, error: null }) }
                },
              }
            },
          }
        },
      } as ReturnType<SpendEvidenceDb['from']>
    },
  }
}

function receipt(status: 'green' | 'red' | 'gray') {
  return [{
    status: 'completed',
    started_at: '2026-10-27T00:30:00.000Z',
    summary: {
      request_id: 'run-1',
      checked_at: '2026-10-27T00:30:00.000Z',
      status: 'ok',
      error: null,
      no_publish: true,
      trigger: 'cron',
      clients: [{
        client_id: CLIENT,
        checked_at: '2026-10-27T00:30:00.000Z',
        phase: 'preflight',
        gates: [{
          key: 'tracking.lead_reaches_crm',
          status,
          hard: true,
          reason: status === 'red' ? '客人填了表但库里没有' : '对得上',
          how: '去核对',
        }],
        items: [],
        read_errors: [],
      }],
    },
  }]
}

describe('drawer spend evidence', () => {
  it('reads a stored cap and a fresh CRM light, and leaves the rest unread', async () => {
    const evidence = await loadSpendEvidence(
      db({ daily_budget_cap_cents: 15000 }, receipt('green')),
      CLIENT,
      OPC,
      NOW,
    )
    expect(evidence.dailyCap).toEqual({ cents: 15000 })
    expect(evidence.amountVerdict).toBe('unknown')
    expect(evidence.leadCrm).toBe('green')
    expect(evidence.creative).toBe('unread')
    expect(evidence.ownership).toBe('unread')
  })

  it('keeps a red CRM light and does not turn a missing cap into zero', async () => {
    const evidence = await loadSpendEvidence(db(null, receipt('red')), CLIENT, OPC, NOW)
    expect(evidence.dailyCap).toBe('missing')
    expect(evidence.leadCrm).toBe('red')
    expect(evidence.leadCrmReason).toContain('库里没有')
  })

  it('returns unread when the read throws', async () => {
    const broken = { from() { throw new Error('down') } } as SpendEvidenceDb
    const evidence = await loadSpendEvidence(broken, CLIENT, OPC, NOW)
    expect(evidence.dailyCap).toBe('unread')
    expect(evidence.leadCrm).toBe('unread')
  })
})
