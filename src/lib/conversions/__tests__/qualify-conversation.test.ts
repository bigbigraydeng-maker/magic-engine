/**
 * 会话文本参与合格线索判定的测试（`classifyChunkRows` / `loadInboundConversationText`）。
 *
 * 分两层：
 *   1. 纯函数 `classifyCtsCrmPerson` —— 员工记录 + 客户自己的消息怎么合成兴趣证据；
 *   2. 编排层 `runCtsCrmSyncChunk` —— 假 Supabase 真的存行、真的执行唯一约束语义，
 *      并额外建模 `conversations` / `conversation_messages` 两张表，验证「员工记录里
 *      没有兴趣证据」的行会去读客户消息、据此写入或排除。
 *
 * 假件按调用链建模（不是按调用顺序返回预设值），每条链都对着源码核实过：
 *   - `loadInboundConversationText`：conversations.select('id, contact_id').eq('client_id').in('contact_id', [...])
 *     → conversation_messages.select('conversation_id, body, sent_at').in('conversation_id', [...]).eq('direction','inbound')
 *       .gte('sent_at', since).order('sent_at', {ascending:false}).limit(1000)
 *   - `findExistingContactId`：contact_identities.select('contact_id, kind, value').eq('client_id').in('value', [...])
 *   - `insertOutcome`：me_sale_outcomes.insert(row).select('id').single() + me_conversion_audit.insert({...})
 *   - `loadExistingSourceRefs`：me_sale_outcomes.select('id, source_ref, review_status').eq().eq().not().order().limit()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyCtsCrmPerson, type CrmManagementRow, type Sheet1LeadRow } from '@/lib/conversions/cts-crm-sheet-sync'
import { runCtsCrmSyncChunk } from '@/lib/conversions/cts-crm-sheet-sync-run'

const sheet1Fixture = vi.fn()
const crmFixture = vi.fn()

vi.mock('@/lib/google-sheets/client', () => ({
  readSheetValues: (_clientId: string, _spreadsheetId: string, range: string) => {
    if (range.startsWith('Sheet1')) return Promise.resolve(sheet1Fixture())
    return Promise.resolve(crmFixture())
  },
}))

// ── Sheet1 行构造：B=1 created_time, N=13 email, O=14 full_name, P=15 phone, R=17 notes ──
function sheet1Row(opts: {
  leadId?: string
  createdTime?: string
  email?: string
  fullName?: string
  phone?: string
  notes?: string
}): string[] {
  const row = new Array(18).fill('')
  row[0] = opts.leadId ?? ''
  row[1] = opts.createdTime ?? ''
  row[13] = opts.email ?? ''
  row[14] = opts.fullName ?? ''
  row[15] = opts.phone ?? ''
  // 默认**不带**兴趣证据：本文件专门测「员工记录里没有证据时，客户自己的消息能不能补上」。
  row[17] = opts.notes ?? ''
  return row
}

// ── CRM管理 行构造：A=0 entryDate, C=2 phone, E=4 tour, G=6 stage, H=7 stageUpdatedDate ──
function crmRow(opts: {
  entryDate?: string
  phone?: string
  tour?: string
  stage?: string
  stageUpdatedDate?: string
}): string[] {
  const row = new Array(8).fill('')
  row[0] = opts.entryDate ?? ''
  row[2] = opts.phone ?? ''
  row[4] = opts.tour ?? ''
  row[6] = opts.stage ?? ''
  row[7] = opts.stageUpdatedDate ?? ''
  return row
}

// ── 纯函数用的行对象 ────────────────────────────────────────────────────────
function crmPerson(opts: { phone?: string; email?: string; name?: string; tour?: string } = {}): CrmManagementRow {
  return {
    entryDate: '14/06/2026',
    name: opts.name ?? 'Jane Doe',
    phoneRaw: opts.phone ?? 'p:+6421363598',
    email: opts.email ?? 'jane@example.com',
    tourInterest: opts.tour ?? 'Best of China 15D',
    stage: null,
    stageUpdatedDate: null,
  }
}

function sheet1Person(opts: { phone?: string; email?: string; fullName?: string; notes?: string | null } = {}): Sheet1LeadRow {
  return {
    metaLeadId: null,
    createdTime: '2026-06-14T02:39:49-05:00',
    email: opts.email ?? 'jane@example.com',
    fullName: opts.fullName ?? 'Jane Doe',
    phoneRaw: opts.phone ?? 'p:+6421363598',
    followUpNotes: opts.notes ?? null,
  }
}

// ── 按表建模的假 Supabase ──────────────────────────────────────────────────
type Row = Record<string, unknown>

interface FakeSeed {
  contactIdentities?: Row[]
  conversations?: Row[]
  conversationMessages?: Row[]
}

function fakeSupabase(seed: FakeSeed = {}): {
  client: SupabaseClient
  outcomes: Row[]
  audits: Row[]
  insertAttempts: { n: number }
} {
  const outcomes: Row[] = []
  const audits: Row[] = []
  const insertAttempts = { n: 0 }
  const contactIdentities = seed.contactIdentities ?? []
  const conversations = seed.conversations ?? []
  const conversationMessages = seed.conversationMessages ?? []

  const client = {
    from(table: string) {
      if (table === 'contact_identities') {
        // 实测核实：findExistingContactId() 对这张表只调用
        // .select('contact_id, kind, value').eq('client_id', ...).in('value', [...])。
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, values: string[]) => ({
                data: contactIdentities.filter((r) => values.includes(r.value as string)),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'conversations') {
        // 实测核实：loadInboundConversationText() 对这张表只调用
        // .select('id, contact_id').eq('client_id', ...).in('contact_id', [...])。
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, values: string[]) => ({
                data: conversations.filter((r) => values.includes(r.contact_id as string)),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'conversation_messages') {
        // 实测核实：loadInboundConversationText() 对这张表调用
        // .select('conversation_id, body, sent_at').in('conversation_id', [...]).eq('direction','inbound')
        //   .gte('sent_at', since).order('sent_at', {ascending:false}).limit(1000) 然后 await。
        return {
          select: () => {
            const conds: Array<[string, unknown]> = []
            let since: string | null = null
            let desc = false
            let cap: number | null = null
            const q = {
              in: (col: string, values: string[]) => (conds.push([col, values]), q),
              eq: (col: string, v: unknown) => (conds.push([col, v]), q),
              gte: (col: string, v: string) => ((since = v), conds.push([col, v]), q),
              order: (_col: string, opts?: { ascending?: boolean }) => ((desc = opts?.ascending === false), q),
              limit: (n: number) => ((cap = n), q),
              then: (resolve: (r: { data: Row[]; error: null }) => unknown) => {
                let rows = conversationMessages.filter((m) =>
                  conds.every(([c, v]) => {
                    if (c === 'sent_at') return since != null && (m.sent_at as string) >= since
                    if (Array.isArray(v)) return v.includes(m[c] as string)
                    return m[c] === v
                  }),
                )
                if (desc) rows = [...rows].sort((a, b) => ((a.sent_at as string) < (b.sent_at as string) ? 1 : -1))
                if (cap != null) rows = rows.slice(0, cap)
                resolve({ data: rows, error: null })
              },
            }
            return q
          },
        }
      }
      if (table === 'me_sale_outcomes') {
        // 实测核实：insertOutcome() 对这张表只调用
        // .insert(row).select('id').single()；loadExistingSourceRefs() 调用
        // .select('id, source_ref').eq(client_id).eq(source_kind).not('source_ref','is',null)
        //   .order('id').limit(n)[.gt('id', lastId)] 然后 await。
        const refQuery = () => {
          let lastId: string | null = null
          const q = {
            eq: () => q,
            not: () => q,
            order: () => q,
            limit: () => q,
            gt: (_col: string, v: string) => ((lastId = v), q),
            then: (resolve: (r: { data: Row[]; error: null }) => unknown) =>
              resolve({
                data: outcomes
                  .filter((o) => o.source_kind === 'crm_sheet_sync' && o.source_ref != null && (lastId == null || (o.id as string) > lastId))
                  .map((o) => ({ id: o.id, source_ref: o.source_ref, review_status: o.review_status ?? 'pending_review' })),
                error: null,
              }),
          }
          return q
        }
        return {
          select: () => refQuery(),
          // rejectStalePendingLead() 只调用 .update(patch).eq('id', id).eq('review_status','pending_review').select('id')
          update: (patch: Row) => {
            const conds: Array<[string, unknown]> = []
            const q = {
              eq: (col: string, v: unknown) => (conds.push([col, v]), q),
              select: async () => {
                const hit = outcomes.filter((o) =>
                  conds.every(([c, v]) => (c === 'review_status' ? (o.review_status ?? 'pending_review') === v : o[c] === v)),
                )
                hit.forEach((o) => Object.assign(o, patch))
                return { data: hit.map((o) => ({ id: o.id })), error: null }
              },
            }
            return q
          },
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                insertAttempts.n++
                const dup = outcomes.some(
                  (r) => r.client_id === row.client_id && r.source_kind === row.source_kind && r.source_ref === row.source_ref,
                )
                if (dup) {
                  return { data: null, error: { code: '23505', message: 'duplicate key' } }
                }
                const id = `outcome-${outcomes.length + 1}`
                outcomes.push({ id, ...row })
                return { data: { id }, error: null }
              },
            }),
          }),
        }
      }
      if (table === 'me_conversion_audit') {
        // 实测核实：insertOutcome() 对这张表只 `await supabase.from(...).insert({...})`，
        // 不接 .select() 等其他方法。
        return { insert: async (row: Row) => { audits.push(row); return { data: null, error: null } } }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
    // 假件只实现上面几张表用到的方法，用 unknown 中转是因为按调用链建模、不是
    // 实现完整 SupabaseClient 接口——每条链均已逐一对着源码核实（见各分支注释）。
    // 已跑实测：`npx vitest run src/lib/conversions/draft-qualify-conversation.test.ts` 全绿。
  } as unknown as SupabaseClient

  return { client, outcomes, audits, insertAttempts }
}

/** 最近 90 天窗口内的一个时间戳——`loadInboundConversationText` 会按它过滤。 */
function recentIso(daysAgo = 1): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  sheet1Fixture.mockReset()
  crmFixture.mockReset()
})

describe('classifyCtsCrmPerson —— 客户自己的消息参与兴趣判定', () => {
  it('(a) 员工记录空白 + 客户消息说很感兴趣 → qualified_lead，interestFrom=conversation', () => {
    const result = classifyCtsCrmPerson(crmPerson(), sheet1Person({ notes: null }), 'Hi, we are very keen on the Best of China tour')
    expect(result.kind).toBe('qualified_lead')
    if (result.kind !== 'qualified_lead') throw new Error('unreachable')
    expect(result.interestFrom).toBe('conversation')
    expect(result.phoneE164).toBe('+6421363598')
  })

  it('(b) 员工记录写了 very keen + 客户消息为空 → interestFrom=notes', () => {
    const result = classifyCtsCrmPerson(crmPerson(), sheet1Person({ notes: 'very keen' }), '')
    expect(result.kind).toBe('qualified_lead')
    if (result.kind !== 'qualified_lead') throw new Error('unreachable')
    expect(result.interestFrom).toBe('notes')
  })

  it('(c) 客户消息说 not interested → excluded_by_notes（排除词压倒一切）', () => {
    const result = classifyCtsCrmPerson(crmPerson(), sheet1Person({ notes: null }), 'not interested thanks')
    expect(result).toMatchObject({ kind: 'excluded', reason: 'excluded_by_notes' })
  })

  it('(d) 客户消息只是道谢、员工记录空白 → excluded no_interest_evidence', () => {
    const result = classifyCtsCrmPerson(crmPerson(), sheet1Person({ notes: null }), 'thanks for the brochure')
    expect(result).toMatchObject({ kind: 'excluded', reason: 'no_interest_evidence' })
  })

  it('(e) 员工记录写了 wrong number + 客户消息说 very keen → 仍 excluded_by_notes', () => {
    const result = classifyCtsCrmPerson(crmPerson(), sheet1Person({ notes: 'wrong number' }), 'very keen')
    expect(result).toMatchObject({ kind: 'excluded', reason: 'excluded_by_notes' })
  })
})

describe('runCtsCrmSyncChunk —— 员工记录没证据时读客户消息', () => {
  function seedOneRow(createdTime: string = recentIso(1)) {
    // 线索时间必须在 Meta 7 天窗口内：凭客户消息判合格的老线索（超窗口）会被跳过，见下面的用例。
    sheet1Fixture.mockReturnValue([sheet1Row({ phone: 'p:+6421363598', email: 'jane@example.com', fullName: 'Jane Doe', createdTime })])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598', tour: 'Best of China 15D' })])
  }

  const CONTACT_ID = '11111111-2222-3333-4444-555555555555'

  it('客户入站消息显示兴趣 → 写入一条 lead，qualifiedFromConversation=1，审计 detail.interest_from=conversation', async () => {
    seedOneRow()
    const { client, outcomes, audits } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: '+6421363598' }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        { conversation_id: 'conv-1', body: 'We are interested in going next March', direction: 'inbound', sent_at: recentIso(1) },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.insertedLeads).toBe(1)
    expect(chunk.summary.qualifiedFromConversation).toBe(1)
    expect(chunk.summary.excludedNoInterest).toBe(0)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ outcome_kind: 'lead', source_kind: 'crm_sheet_sync', contact_id: CONTACT_ID })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'created', detail: { interest_from: 'conversation' } })
  })

  it('🔴 凭客户消息判合格、但线索已超过 7 天窗口 → 不写库（写了也发不出去，还会占满每次写入上限）', async () => {
    seedOneRow('2026-06-14T02:39:49-05:00')
    const { client, outcomes } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: '+6421363598' }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        { conversation_id: 'conv-1', body: 'We are interested in going next March', direction: 'inbound', sent_at: recentIso(1) },
      ],
    })
    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })
    expect(chunk.summary.skippedPastWindow).toBe(1)
    expect(chunk.summary.insertedLeads).toBe(0)
    expect(outcomes).toHaveLength(0)
  })

  it('客户入站消息只是「回头再打」→ 不写库，excludedNoInterest=1', async () => {
    seedOneRow()
    const { client, outcomes } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: '+6421363598' }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        { conversation_id: 'conv-1', body: 'can you call later', direction: 'inbound', sent_at: recentIso(1) },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.insertedLeads).toBe(0)
    expect(chunk.summary.excludedNoInterest).toBe(1)
    expect(chunk.summary.qualifiedFromConversation).toBe(0)
    expect(outcomes).toHaveLength(0)
  })

  it('只读入站消息：出站消息里的兴趣词不算证据', async () => {
    seedOneRow()
    const { client, outcomes } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: '+6421363598' }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        { conversation_id: 'conv-1', body: 'We are very keen on the Best of China tour', direction: 'outbound', sent_at: recentIso(1) },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.insertedLeads).toBe(0)
    expect(chunk.summary.excludedNoInterest).toBe(1)
    expect(outcomes).toHaveLength(0)
  })

  it('90 天窗口外的入站消息不算证据', async () => {
    seedOneRow()
    const { client, outcomes } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: '+6421363598' }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        { conversation_id: 'conv-1', body: 'We are very keen on the Best of China tour', direction: 'inbound', sent_at: recentIso(200) },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.insertedLeads).toBe(0)
    expect(chunk.summary.excludedNoInterest).toBe(1)
    expect(outcomes).toHaveLength(0)
  })
})
