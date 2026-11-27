import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildRevocationItem,
  classifyLedgerRow,
  countLedgerProblems,
  countPhrase,
  defaultTriggeredSendDeps,
  pushTriggeredSendItems,
  READ_LIMIT,
  systemRevocations,
  type LedgerRow,
  type RevokedAuthRow,
  type TriggeredSendDeps,
} from '../triggered-send-items'
import type { ManualItem } from '../manual-item-types'
import { LANE_OF_KIND } from '../five-kinds'

const NOW = new Date('2026-11-27T09:00:00.000Z')
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const dayAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function asSupabase(stub: object): SupabaseClient {
  return stub as SupabaseClient
}

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  clientId: 'c1',
  triggerKey: 'welcome',
  dedupeScope: 'lifetime',
  status: 'sent',
  reasonCode: null,
  bounceKind: null,
  sentAt: minAgo(10),
  lastEventType: null,
  updatedAt: minAgo(10),
  ...over,
})

describe('classifyLedgerRow', () => {
  it('🔴 rehearsal (shadow) rows never count, whatever their status', () => {
    expect(classifyLedgerRow(row({ dedupeScope: 'shadow', status: 'unknown_outcome' }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ dedupeScope: 'shadow', status: 'complained' }), NOW)).toBeNull()
  })

  it('unknown_outcome counts at any age; once a person resolves it (status moves on) it does not', () => {
    expect(classifyLedgerRow(row({ status: 'unknown_outcome', updatedAt: dayAgo(40) }), NOW)).toBe('unknown')
    expect(classifyLedgerRow(row({ status: 'sent', reasonCode: 'sent_confirmed', sentAt: null }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ status: 'failed', reasonCode: 'not_sent_confirmed' }), NOW)).toBeNull()
  })

  it('hard bounce within 7 days only; soft bounce and older ones do not count', () => {
    expect(classifyLedgerRow(row({ status: 'bounced', bounceKind: 'permanent', updatedAt: dayAgo(6) }), NOW)).toBe('hardBounced')
    expect(classifyLedgerRow(row({ status: 'bounced', bounceKind: 'transient', updatedAt: dayAgo(1) }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ status: 'bounced', bounceKind: 'permanent', updatedAt: dayAgo(8) }), NOW)).toBeNull()
  })

  it('any complaint within 7 days counts', () => {
    expect(classifyLedgerRow(row({ status: 'complained', updatedAt: dayAgo(3) }), NOW)).toBe('complained')
    expect(classifyLedgerRow(row({ status: 'complained', updatedAt: dayAgo(8) }), NOW)).toBeNull()
  })

  it('sent with no receipt: only after 30 minutes; any receipt or a person-confirmed send clears it', () => {
    expect(classifyLedgerRow(row({ sentAt: minAgo(31) }), NOW)).toBe('receiptsMissing')
    expect(classifyLedgerRow(row({ sentAt: minAgo(29) }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ sentAt: minAgo(90), lastEventType: 'email.sent' }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ sentAt: minAgo(90), reasonCode: 'sent_confirmed' }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ sentAt: null }), NOW)).toBeNull()
  })

  it('key errors (provider_account_error) in the last 2 days only; other failures do not count', () => {
    expect(classifyLedgerRow(row({ status: 'failed', reasonCode: 'provider_account_error', updatedAt: dayAgo(1) }), NOW)).toBe('accountError')
    expect(classifyLedgerRow(row({ status: 'failed', reasonCode: 'provider_account_error', updatedAt: dayAgo(3) }), NOW)).toBeNull()
    expect(classifyLedgerRow(row({ status: 'failed', reasonCode: 'provider_rejected', updatedAt: dayAgo(1) }), NOW)).toBeNull()
  })
})

describe('countLedgerProblems / countPhrase', () => {
  it('counts per client, per kind of letter; truncated categories say "at least"', () => {
    const counts = countLedgerProblems(
      [
        row({ status: 'unknown_outcome' }),
        row({ status: 'unknown_outcome', triggerKey: 'crm_ai_followup', dedupeScope: 'letter:day2' }),
        row({ status: 'unknown_outcome', clientId: 'c2' }),
      ],
      NOW,
      new Set(['unknown']),
    )
    const c1 = counts.get('c1')?.unknown
    expect(c1).toEqual({ total: 2, byTrigger: { welcome: 1, crm_ai_followup: 1 }, atLeast: true })
    expect(c1 && countPhrase(c1)).toBe('至少 2 封自动发的信（欢迎信 1 封、AI 跟进信 1 封）')
    expect(countPhrase({ total: 3, byTrigger: { welcome: 3 }, atLeast: false })).toBe('3 封欢迎信')
  })
})

describe('systemRevocations', () => {
  const rev = (over: Partial<RevokedAuthRow> = {}): RevokedAuthRow => ({ clientId: 'c1', triggerKey: 'welcome', revokedBy: 'system:TEMPLATE_CHANGED', revokedAt: dayAgo(1), ...over })

  it('🔴 SUPERSEDED (a new proposal replaced it) and revocations by a person are not decision cards', () => {
    expect(systemRevocations([rev({ revokedBy: 'system:SUPERSEDED' }), rev({ revokedBy: 'pm@example.com' })], NOW)).toEqual([])
  })

  it('only the last 7 days; codes merged per client and kind of letter', () => {
    const out = systemRevocations(
      [rev(), rev({ revokedBy: 'system:HEALTH_BREAKER', revokedAt: dayAgo(2) }), rev({ revokedAt: dayAgo(9) }), rev({ triggerKey: 'crm_ai_followup', revokedBy: 'system:PROVIDER_FAILURE' })],
      NOW,
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ clientId: 'c1', triggerKey: 'welcome', codes: ['TEMPLATE_CHANGED', 'HEALTH_BREAKER'] })
    expect(out[1]).toMatchObject({ triggerKey: 'crm_ai_followup', codes: ['PROVIDER_FAILURE'] })
  })

  it('the decision card names the reason in plain words and links the welcome-letter page', () => {
    const item = buildRevocationItem({ clientId: 'c1', triggerKey: 'welcome', codes: ['HEALTH_BREAKER'], latestAt: dayAgo(1) }, 'Acme')
    expect(item.kind).toBe('triggered_send_system_revoked')
    expect(item.what).toContain('系统自动停了 Acme 的欢迎信自动发送（原因：最近 30 天退信太多或有客人投诉')
    expect(item.what).toContain('要你决定要不要重新授权')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/crm/welcome-letter')
    expect(LANE_OF_KIND[item.kind]).toBe('decide')
  })
})

// ── push：注入假的取数 ────────────────────────────────────────────────────

const fakeDb = asSupabase({})
const names: Record<string, string> = { c1: 'Acme', c2: 'Beta' }
const nameOf = (id: string) => names[id] ?? '未知客户'

function depsWith(ledger: LedgerRow[], revoked: RevokedAuthRow[] = []): TriggeredSendDeps {
  return { load: async () => ({ ledger, truncated: new Set(), revoked }) }
}

describe('pushTriggeredSendItems', () => {
  it('one item per client per category, counts only — never a guest name or address', async () => {
    const items: ManualItem[] = []
    const ledger = [
      row({ status: 'unknown_outcome' }),
      row({ status: 'unknown_outcome' }),
      row({ status: 'bounced', bounceKind: 'permanent', updatedAt: dayAgo(1) }),
      row({ status: 'complained', updatedAt: dayAgo(1) }),
      row({ sentAt: minAgo(45) }),
      row({ status: 'failed', reasonCode: 'provider_account_error', updatedAt: dayAgo(1), clientId: 'c2' }),
    ]
    const revoked = [{ clientId: 'c2', triggerKey: 'welcome', revokedBy: 'system:GATE_CHANGED', revokedAt: dayAgo(1) }]
    await pushTriggeredSendItems(fakeDb, items, ['c1', 'c2'], NOW, nameOf, depsWith(ledger, revoked))
    expect(items.map((i) => [i.client_id, i.kind])).toEqual([
      ['c1', 'triggered_send_unknown_outcome'],
      ['c1', 'triggered_send_hard_bounced'],
      ['c1', 'triggered_send_complained'],
      ['c1', 'triggered_send_receipts_missing'],
      ['c2', 'triggered_send_system_revoked'],
      ['c2', 'triggered_send_account_error'],
    ])
    expect(items[0]?.what).toBe('Acme 有 2 封欢迎信不知道发没发出去，要人核对。发信服务那一下没给准话，信可能已经到了客人手里，系统不会自己重发')
    expect(items[0]?.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/crm/welcome-letter')
    for (const i of items) {
      expect(i.what).not.toMatch(/@/)
      expect(i.how.length).toBeGreaterThan(20)
      expect(i.href.startsWith('https://')).toBe(true)
      expect(LANE_OF_KIND[i.kind]).toBeDefined()
    }
  })

  it('AI follow-up letters link the read-only auto-letters page and say they cannot be marked there yet', async () => {
    const items: ManualItem[] = []
    await pushTriggeredSendItems(fakeDb, items, ['c1'], NOW, nameOf, depsWith([row({ status: 'unknown_outcome', triggerKey: 'crm_ai_followup', dedupeScope: 'letter:day2' })]))
    expect(items[0]?.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/crm/auto-letters')
    expect(items[0]?.how).toContain('AI 跟进信页面上还标不了')
  })

  it('clients outside the roster produce nothing; nothing wrong → no item', async () => {
    const items: ManualItem[] = []
    await pushTriggeredSendItems(fakeDb, items, ['c1'], NOW, nameOf, depsWith([row({ status: 'unknown_outcome', clientId: 'zz' }), row({ status: 'delivered' })]))
    expect(items).toEqual([])
  })

  it('🔴 a read failure is an honest "could not count" item for developers, never a silent zero', async () => {
    const items: ManualItem[] = []
    const deps: TriggeredSendDeps = {
      load: async () => {
        throw new Error('permission denied for table triggered_sends')
      },
    }
    await pushTriggeredSendItems(fakeDb, items, ['c1', 'c2'], NOW, nameOf, deps)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('triggered_send_check_failed')
    expect(items[0]?.what).toContain('今天没算出来（permission denied for table triggered_sends）')
    expect(items[0]?.what).toContain('不等于没有')
    expect(LANE_OF_KIND.triggered_send_check_failed).toBe('dev')
  })
})

// ── 默认取数：假的查询链（列名对着 triggered-send-items.ts 的 select） ──────────

interface Call {
  table: string
  ops: Array<[string, unknown[]]>
}

type Answer = { data: unknown[] | null; error: { message: string } | null }

function fakeSupabase(answer: (c: Call) => Answer): { db: SupabaseClient; calls: Call[] } {
  const calls: Call[] = []
  const stub = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'in', 'neq', 'eq', 'gte', 'lte', 'is', 'like']) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, args])
          return chain
        }
      }
      chain.limit = async (...args: unknown[]) => {
        call.ops.push(['limit', args])
        return answer(call)
      }
      return chain
    },
  }
  return { db: asSupabase(stub), calls }
}

const has = (c: Call, op: string, ...args: unknown[]) => c.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args))

describe('defaultTriggeredSendDeps.load', () => {
  it('reads only real rows of the roster clients, never an address column, and the system revocations minus SUPERSEDED', async () => {
    const { db, calls } = fakeSupabase(() => ({ data: [], error: null }))
    await defaultTriggeredSendDeps.load(db, ['c1'], NOW)
    const ledger = calls.filter((c) => c.table === 'triggered_sends')
    expect(ledger).toHaveLength(5)
    for (const c of ledger) {
      expect(has(c, 'in', 'client_id', ['c1'])).toBe(true)
      expect(has(c, 'neq', 'dedupe_scope', 'shadow')).toBe(true)
      expect(JSON.stringify(c.ops[0])).not.toMatch(/address|email/)
    }
    const auth = calls.find((c) => c.table === 'triggered_send_authorizations')
    expect(auth && has(auth, 'like', 'revoked_by', 'system:%')).toBe(true)
    expect(auth && has(auth, 'neq', 'revoked_by', 'system:SUPERSEDED')).toBe(true)
  })

  it('a full read is flagged as "at least"; the same row read twice is counted once', async () => {
    const full = Array.from({ length: READ_LIMIT }, (_, i) => ({ id: `r${i}`, client_id: 'c1', trigger_key: 'welcome', dedupe_scope: 'lifetime', status: 'unknown_outcome', updated_at: dayAgo(1) }))
    const { db } = fakeSupabase((c) => (c.table === 'triggered_sends' && has(c, 'eq', 'status', 'unknown_outcome') ? { data: [...full, full[0]], error: null } : { data: [], error: null }))
    const snap = await defaultTriggeredSendDeps.load(db, ['c1'], NOW)
    expect(snap.ledger).toHaveLength(READ_LIMIT)
    expect([...snap.truncated]).toEqual(['unknown'])
  })

  it('🔴 any query error throws (so the caller writes the "could not count" item)', async () => {
    const { db } = fakeSupabase((c) => (c.table === 'triggered_send_authorizations' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }))
    await expect(defaultTriggeredSendDeps.load(db, ['c1'], NOW)).rejects.toThrow('授权表：boom')
  })

  it('no clients → no query at all', async () => {
    const { db, calls } = fakeSupabase(() => ({ data: [], error: null }))
    expect(await defaultTriggeredSendDeps.load(db, [], NOW)).toEqual({ ledger: [], truncated: new Set(), revoked: [] })
    expect(calls).toHaveLength(0)
  })
})
