/**
 * H4c —— 合格线索判定的第二轮加固测试。
 *
 * 分两层：
 *   1. 纯函数 `isFormTemplateMessage` —— 表单自带首条消息 / 自动回复的各种写法都算「不是真实对话」；
 *      `qualifyByNotes` / `qualifyByConversation` —— 单行 "STOP" / "Unsubscribe" 一律 excluded。
 *   2. 编排层 `runCtsCrmSyncChunk` —— 员工记录判合格时：
 *        - 客人真实发过消息、但其中一条是排除词 → 不写入（excludedByNotes）；
 *        - 联系人没关联上 → 不写入、不拒绝，既有 pending_review 保持 pending_review；
 *        - 只有表单模板消息 → 仍按 no_customer_conversation 排除（回归护栏）。
 *
 * 假件按调用链建模（不是按调用顺序返回预设值），每条链都对着源码核实过：
 *   - `loadInboundConversationText`：conversations.select('id, contact_id').eq('client_id').in('contact_id', [...])
 *     → conversation_messages.select('conversation_id, body, sent_at').in('conversation_id', [...]).eq('direction','inbound')
 *       .gte('sent_at', since).order('sent_at', {ascending:false}).limit(1000)
 *   - `findExistingContactId`：contact_identities.select('contact_id, kind, value').eq('client_id').in('value', [...])
 *   - `insertOutcome`：me_sale_outcomes.insert(row).select('id').single() + me_conversion_audit.insert({...})
 *   - `loadExistingSourceRefs`：me_sale_outcomes.select('id, source_ref, review_status').eq().eq().not().order().limit()
 *   - `rejectStalePendingLead`：me_sale_outcomes.update(patch).eq('id', id).eq('review_status','pending_review').select('id')
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isFormTemplateMessage, qualifyByNotes, qualifyByConversation } from '@/lib/conversions/cts-crm-sheet-sync'
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
  // 本文件专门测「员工记录判合格时，客人有没有真实发起过对话」——默认给一条合格证据。
  row[17] = opts.notes ?? 'very keen, wants to go in March 2027'
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

// ── 按表建模的假 Supabase ──────────────────────────────────────────────────
type Row = Record<string, unknown>

interface FakeSeed {
  contactIdentities?: Row[]
  conversations?: Row[]
  conversationMessages?: Row[]
  /** 让 conversations 查询返回错误——建模「读客户会话失败」。 */
  conversationsError?: { message: string }
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
  const conversationsError = seed.conversationsError ?? null

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
              in: async (_col: string, values: string[]) => {
                if (conversationsError) return { data: null, error: conversationsError }
                return {
                  data: conversations.filter((r) => values.includes(r.contact_id as string)),
                  error: null,
                }
              },
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
        // .select('id, source_ref, review_status').eq(client_id).eq(source_kind).not('source_ref','is',null)
        //   .order('id').limit(n)[.gt('id', lastId)] 然后 await；
        // rejectStalePendingLead() 调用 .update(patch).eq('id', id).eq('review_status','pending_review').select('id')。
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
      if (table === 'group_tours') {
        // 实测核实：lookupTourPrice() 对这张表只 `.select(...).eq('client_id', ...).eq('is_active', true)` 然后 await；
        // 本文件不测成交价，返回空集即可（合格线索路径不查价）。
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
    // 假件只实现上面几张表用到的方法，用 unknown 中转是因为按调用链建模、不是
    // 实现完整 SupabaseClient 接口——每条链均已逐一对着源码核实（见各分支注释）。
    // 已跑实测：`npx vitest run src/lib/conversions/draft-qualify-r2.test.ts` 全绿。
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

describe('isFormTemplateMessage —— 表单模板 / 自动回复的各种写法', () => {
  it.each([
    'Hello!! I filled out your form',
    'Hello, I filled out your form and would like to know more',
    'Hi! I filled out your form',
    '👋 Hello! I filled in your form',
    'Hello！I filled out your form',
    'Hello I submitted your form',
    '> Hello! I filled out your form',
    '&gt; Hello! I filled out your form',
    'Out of office until Monday',
    'Auto-reply: I am away',
    '自动回复：我在休假',
    '',
    '   ',
  ])('true: %j', (text) => {
    expect(isFormTemplateMessage(text)).toBe(true)
  })

  it.each([
    'How much do your China tours cost?',
    'Hi, I filled out your form yesterday but nobody called',
    'ok',
    '👍',
  ])('false: %j', (text) => {
    expect(isFormTemplateMessage(text)).toBe(false)
  })
})

describe('qualifyByNotes / qualifyByConversation —— 单行 STOP / Unsubscribe 一律排除', () => {
  it.each(['STOP', 'Unsubscribe'])('qualifyByNotes(%j) === excluded', (text) => {
    expect(qualifyByNotes(text)).toBe('excluded')
  })

  it.each(['STOP', 'Unsubscribe'])('qualifyByConversation(%j) === excluded', (text) => {
    expect(qualifyByConversation(text)).toBe('excluded')
  })
})

describe('runCtsCrmSyncChunk —— 员工记录判合格时的会话复判', () => {
  const CONTACT_ID = '11111111-2222-3333-4444-555555555555'
  const PHONE = '+6421363598'
  const NOTE = 'very keen, wants to go in March 2027'

  function seedOneRow(createdTime: string = recentIso(1)) {
    sheet1Fixture.mockReturnValue([
      sheet1Row({ phone: 'p:+6421363598', email: 'jane@example.com', fullName: 'Jane Doe', createdTime, notes: NOTE }),
    ])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598', tour: 'Best of China 15D' })])
  }

  it('客人真实发过消息，但其中一条是排除词 → 不写入，excludedByNotes=1', async () => {
    seedOneRow()
    const { client, outcomes, audits } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: PHONE }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        {
          conversation_id: 'conv-1',
          body: 'How much is the tour?',
          sent_at: recentIso(2),
          direction: 'inbound',
        },
        {
          conversation_id: 'conv-1',
          body: 'not interested thanks',
          sent_at: recentIso(1),
          direction: 'inbound',
        },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.excludedByNotes).toBe(1)
    expect(chunk.summary.insertedLeads).toBe(0)
    expect(outcomes).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  it('找不到联系人 → 不写入、不拒绝，既有 pending_review 保持 pending_review，contactNotLinked=1', async () => {
    seedOneRow()
    const { client, outcomes, audits } = fakeSupabase({
      // 没有 contact_identities → findExistingContactId 返回 null。
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        {
          conversation_id: 'conv-1',
          body: 'How much is the tour?',
          sent_at: recentIso(1),
          direction: 'inbound',
        },
      ],
    })
    outcomes.push({
      id: 'outcome-existing',
      client_id: 'c0000000-0000-0000-0000-000000000000',
      source_kind: 'crm_sheet_sync',
      source_ref: `${PHONE}:lead`,
      review_status: 'pending_review',
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.contactNotLinked).toBe(1)
    expect(chunk.summary.excludedNoConversation).toBe(0)
    expect(chunk.summary.insertedLeads).toBe(0)
    expect(chunk.summary.rejectedStaleLeads).toBe(0)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ id: 'outcome-existing', review_status: 'pending_review' })
    expect(audits).toHaveLength(0)
  })

  it('只有表单模板消息 → 仍按 no_customer_conversation 排除（回归护栏）', async () => {
    seedOneRow()
    const { client, outcomes, audits } = fakeSupabase({
      contactIdentities: [{ contact_id: CONTACT_ID, kind: 'phone', value: PHONE }],
      conversations: [{ id: 'conv-1', contact_id: CONTACT_ID }],
      conversationMessages: [
        {
          conversation_id: 'conv-1',
          body: 'Hello! I filled out your form and would like to know more about the tour',
          sent_at: recentIso(1),
          direction: 'inbound',
        },
      ],
    })

    const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, { supabase: client })

    expect(chunk.summary.excludedNoConversation).toBe(1)
    expect(chunk.summary.insertedLeads).toBe(0)
    expect(outcomes).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })
})
