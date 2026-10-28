import { describe, expect, it } from 'vitest'
import {
  findReceiptByRequest,
  findSentTemplateReceiptsSince,
  insertReceipt,
  listRecentReceipts,
  mapReceiptRow,
  summariseReceiptsSince,
  validateReceipt,
} from '@/lib/crm/email-templates/receipt-store'
import type { SendReceipt } from '@/lib/crm/email-templates/types'
import { createFakeDb } from '@/lib/crm/email-templates/__tests__/fake-db'

const TABLE = 'crm_email_send_receipts'

const CLIENT_ID = 'client-abc'
const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_CONTACT_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'

function makeDb(options: { failTable?: string } = {}) {
  return createFakeDb({
    unique: { [TABLE]: [['client_id', 'contact_id', 'request_id', 'outcome', 'block_reason']] },
    coalesceNull: { [TABLE]: ['block_reason'] },
    ...options,
  })
}

function baseReceipt(overrides: Partial<SendReceipt> = {}): SendReceipt {
  return {
    clientId: CLIENT_ID,
    contactId: CONTACT_ID,
    requestId: REQUEST_ID,
    actorEmail: 'staff@example.com',
    templateKey: 'welcome-tour',
    templateVersion: 1,
    catalogVersion: 1,
    callBasis: 'staff_attested',
    outcome: 'sent',
    blockReason: null,
    blockDetail: null,
    mailbox: 'sales@example.com',
    conversationId: null,
    providerMessageId: 'prov-1',
    editedAfterRender: false,
    warnings: [],
    renderedSha256: null,
    finalSha256: null,
    ...overrides,
  }
}

describe('insertReceipt', () => {
  it('inserts a sent receipt and stores no email/body columns', async () => {
    const { db, tables } = makeDb()
    const result = await insertReceipt(db, baseReceipt())
    expect(result).toEqual({ ok: true, duplicate: false })
    const rows = tables[TABLE] ?? []
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.client_id).toBe(CLIENT_ID)
    for (const forbidden of ['email', 'to', 'recipient', 'body', 'subject']) {
      expect(Object.prototype.hasOwnProperty.call(row, forbidden)).toBe(false)
    }
  })

  it('returns duplicate on the second identical insert and stores one row', async () => {
    const { db, tables } = makeDb()
    const first = await insertReceipt(db, baseReceipt())
    const second = await insertReceipt(db, baseReceipt())
    expect(first).toEqual({ ok: true, duplicate: false })
    expect(second).toEqual({ ok: true, duplicate: true })
    expect(tables[TABLE] ?? []).toHaveLength(1)
  })

  it('allows different block reasons but rejects the same reason twice', async () => {
    const { db, tables } = makeDb()
    const blockedA = baseReceipt({ outcome: 'blocked', blockReason: 'reason-a' })
    const blockedB = baseReceipt({ outcome: 'blocked', blockReason: 'reason-b' })
    expect(await insertReceipt(db, blockedA)).toEqual({ ok: true, duplicate: false })
    expect(await insertReceipt(db, blockedB)).toEqual({ ok: true, duplicate: false })
    expect(await insertReceipt(db, blockedA)).toEqual({ ok: true, duplicate: true })
    expect(tables[TABLE] ?? []).toHaveLength(2)
  })

  it('treats null block_reason as empty for sent duplicates', async () => {
    const { db, tables } = makeDb()
    expect(await insertReceipt(db, baseReceipt())).toEqual({ ok: true, duplicate: false })
    expect(await insertReceipt(db, baseReceipt())).toEqual({ ok: true, duplicate: true })
    expect(tables[TABLE] ?? []).toHaveLength(1)
  })

  it('rejects invalid receipts without touching the database', async () => {
    const { db, calls } = makeDb()
    const cases: SendReceipt[] = [
      baseReceipt({ outcome: 'blocked', blockReason: null }),
      baseReceipt({ outcome: 'sent', blockReason: 'should-not-be-here' }),
      baseReceipt({ renderedSha256: 'xyz' }),
      baseReceipt({ actorEmail: 'x' }),
      baseReceipt({ templateVersion: 0 }),
      baseReceipt({ warnings: ['a'.repeat(61)] }),
    ]
    for (const receipt of cases) {
      const result = await insertReceipt(db, receipt)
      expect(result.ok).toBe(false)
    }
    expect(calls).toHaveLength(0)
  })

  it('returns ok:false when the database fails', async () => {
    const { db } = makeDb({ failTable: TABLE })
    const result = await insertReceipt(db, baseReceipt())
    expect(result.ok).toBe(false)
  })
})

describe('listRecentReceipts', () => {
  it('returns newest first, honours the limit and clamps it', async () => {
    const { db, tables } = makeDb()
    tables[TABLE] = [
      { ...rowFor('r1', '2024-01-01T00:00:00.000Z') },
      { ...rowFor('r2', '2024-01-03T00:00:00.000Z') },
      { ...rowFor('r3', '2024-01-02T00:00:00.000Z') },
    ]
    const all = await listRecentReceipts(db, CLIENT_ID)
    expect(all.map((r) => r.requestId)).toEqual(['r2', 'r3', 'r1'])
    const limited = await listRecentReceipts(db, CLIENT_ID, 2)
    expect(limited.map((r) => r.requestId)).toEqual(['r2', 'r3'])
    const zero = await listRecentReceipts(db, CLIENT_ID, 0)
    expect(zero).toHaveLength(1)
    const huge = await listRecentReceipts(db, CLIENT_ID, 1000)
    expect(huge).toHaveLength(3)
  })
})

describe('findSentTemplateReceiptsSince', () => {
  it('returns only sent template receipts for the contact since the cut-off', async () => {
    const { db, tables } = makeDb()
    tables[TABLE] = [
      rowFor('r1', '2024-02-01T00:00:00.000Z'),
      rowFor('r2', '2024-02-02T00:00:00.000Z', { template_key: null }),
      rowFor('r3', '2024-02-03T00:00:00.000Z', { outcome: 'blocked', block_reason: 'x' }),
      rowFor('r4', '2024-02-04T00:00:00.000Z', { contact_id: OTHER_CONTACT_ID }),
      rowFor('r5', '2024-02-05T00:00:00.000Z', { client_id: 'other-client' }),
      rowFor('r6', '2023-12-01T00:00:00.000Z'),
    ]
    const result = await findSentTemplateReceiptsSince(
      db,
      CLIENT_ID,
      CONTACT_ID,
      '2024-01-01T00:00:00.000Z',
    )
    expect(result.map((r) => r.requestId)).toEqual(['r1'])
  })
})

describe('findReceiptByRequest', () => {
  it('finds the receipt of exactly this client / contact / request / outcome', async () => {
    const { db, tables } = makeDb()
    tables[TABLE] = [
      rowFor('r1', '2024-02-01T00:00:00.000Z', { outcome: 'unknown', block_reason: 'send_unknown' }),
      rowFor('r1', '2024-02-02T00:00:00.000Z', { outcome: 'sent' }),
      rowFor('r1', '2024-02-03T00:00:00.000Z', { outcome: 'unknown', contact_id: OTHER_CONTACT_ID }),
      rowFor('r1', '2024-02-04T00:00:00.000Z', { outcome: 'unknown', client_id: 'other-client' }),
      rowFor('r2', '2024-02-05T00:00:00.000Z', { outcome: 'unknown' }),
    ]
    const found = await findReceiptByRequest(db, CLIENT_ID, CONTACT_ID, 'r1', 'unknown')
    expect(found?.createdAt).toBe('2024-02-01T00:00:00.000Z')
    expect(found?.outcome).toBe('unknown')
  })

  it('is null when there is no such receipt', async () => {
    const { db, tables } = makeDb()
    tables[TABLE] = [rowFor('r1', '2024-02-01T00:00:00.000Z', { outcome: 'sent' })]
    expect(await findReceiptByRequest(db, CLIENT_ID, CONTACT_ID, 'r1', 'unknown')).toBeNull()
  })

  it('throws when the table cannot be read (never answers "not found")', async () => {
    const { db } = makeDb({ failTable: TABLE })
    await expect(findReceiptByRequest(db, CLIENT_ID, CONTACT_ID, 'r1', 'unknown')).rejects.toThrow(TABLE)
  })
})

describe('summariseReceiptsSince', () => {
  it('counts per template key including null and ignores older rows', async () => {
    const { db, tables } = makeDb()
    tables[TABLE] = [
      rowFor('r1', '2024-02-01T00:00:00.000Z', { template_key: 'welcome-tour' }),
      rowFor('r2', '2024-02-02T00:00:00.000Z', { template_key: 'welcome-tour' }),
      rowFor('r3', '2024-02-03T00:00:00.000Z', {
        template_key: 'welcome-tour',
        outcome: 'blocked',
        block_reason: 'x',
      }),
      rowFor('r4', '2024-02-04T00:00:00.000Z', { template_key: null }),
      rowFor('r5', '2023-12-01T00:00:00.000Z', { template_key: 'welcome-tour' }),
    ]
    const summary = await summariseReceiptsSince(db, CLIENT_ID, '2024-01-01T00:00:00.000Z')
    expect(summary).toEqual([
      { templateKey: 'welcome-tour', sent: 2, blocked: 1, failed: 0, unknown: 0 },
      { templateKey: null, sent: 1, blocked: 0, failed: 0, unknown: 0 },
    ])
  })
})

describe('client scoping', () => {
  it('every select call filters on client_id', async () => {
    const { db, calls } = makeDb()
    await listRecentReceipts(db, CLIENT_ID)
    await findSentTemplateReceiptsSince(db, CLIENT_ID, CONTACT_ID, '2024-01-01T00:00:00.000Z')
    await summariseReceiptsSince(db, CLIENT_ID, '2024-01-01T00:00:00.000Z')
    const selects = calls.filter((c) => c.op === 'select')
    expect(selects.length).toBeGreaterThan(0)
    for (const call of selects) {
      const hasClientFilter = call.filters.some(
        (f) => f.kind === 'eq' && f.col === 'client_id' && f.value === CLIENT_ID,
      )
      expect(hasClientFilter).toBe(true)
    }
  })
})

describe('mapReceiptRow', () => {
  it('returns null for a row missing outcome', () => {
    const row = rowFor('r1', '2024-01-01T00:00:00.000Z')
    delete (row as Record<string, unknown>).outcome
    expect(mapReceiptRow(row)).toBeNull()
  })

  it('listRecentReceipts rejects with unreadable row when a bad row is stored', async () => {
    const { db, tables } = makeDb()
    const bad = rowFor('r1', '2024-01-01T00:00:00.000Z')
    delete (bad as Record<string, unknown>).outcome
    tables[TABLE] = [bad]
    await expect(listRecentReceipts(db, CLIENT_ID)).rejects.toThrow('unreadable row')
  })
})

function rowFor(
  requestId: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `id-${requestId}`,
    client_id: CLIENT_ID,
    contact_id: CONTACT_ID,
    request_id: requestId,
    actor_email: 'staff@example.com',
    template_key: 'welcome-tour',
    template_version: 1,
    catalog_version: 1,
    call_basis: 'staff_attested',
    outcome: 'sent',
    block_reason: null,
    block_detail: null,
    mailbox: 'sales@example.com',
    conversation_id: null,
    provider_message_id: 'prov-1',
    edited_after_render: false,
    warnings: [],
    rendered_sha256: null,
    final_sha256: null,
    auth_basis: 'human_click',
    created_at: createdAt,
    ...overrides,
  }
}
