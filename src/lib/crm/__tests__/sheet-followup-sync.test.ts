/**
 * 表格「员工跟进记录」→ CRM 触点。
 *
 * 这条链的价值全在「别把已经打过电话的人当成没人管」，所以测试盯的是
 * 文件头那四条纪律：只认人不建人、按行幂等、不跟旧导入撞、时间必须标近似。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  pickSheetNotes,
  sheetNoteSourceRef,
  syncSheetFollowupNotes,
  SHEET_FOLLOWUP_SOURCE,
  CLIENT_FOLLOWUP_SHEETS,
} from '../sheet-followup-sync'
import { CTS_NOTE_COLUMN_SWITCH_ROW } from '@/lib/conversions/cts-crm-sheet-sync'
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT = 'client-1'
const LEAD_AT = '2026-09-20T02:39:49-05:00'

/** 造一行表格。`noteCol` 指定把记录写进 R(17) 还是 S(18)。 */
function row(over: { leadId?: string; email?: string; phone?: string; note?: string; noteCol?: 17 | 18; createdTime?: string | null } = {}): string[] {
  const cells = new Array(20).fill('')
  cells[0] = over.leadId ?? 'l:100'
  cells[1] = over.createdTime === undefined ? LEAD_AT : (over.createdTime ?? '')
  cells[13] = over.email ?? 'jane@example.com'
  cells[15] = over.phone ?? 'p:+6421363598'
  if (over.note !== undefined) cells[over.noteCol ?? 17] = over.note
  return cells
}

describe('pickSheetNotes —— 记录在 R 还是 S 列', () => {
  it('505 行及以前读 R 列', () => {
    const rows = new Array(CTS_NOTE_COLUMN_SWITCH_ROW - 3).fill(null).map(() => row())
    rows[0] = row({ note: 'voice message', noteCol: 17 })
    const got = pickSheetNotes(rows)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ sheetRow: 2, note: 'voice message' })
  })

  it('🔴 506 行起读 S 列，R 列那时候装的是 Facebook 链接', () => {
    const rows: string[][] = []
    for (let i = 0; i < CTS_NOTE_COLUMN_SWITCH_ROW; i++) rows.push(row())
    // 数组下标 i 对应表格第 i+2 行
    const idx = CTS_NOTE_COLUMN_SWITCH_ROW - 2
    rows[idx] = row({ note: 'wrong number', noteCol: 18 })
    rows[idx][17] = 'https://business.facebook.com/latest/28201068'
    const got = pickSheetNotes(rows)
    expect(got.map((n) => n.note)).toEqual(['wrong number'])
    expect(got[0].sheetRow).toBe(CTS_NOTE_COLUMN_SWITCH_ROW)
  })

  it('🔴 粘在记录列里的链接不是跟进记录，不算', () => {
    expect(pickSheetNotes([row({ note: 'https://business.facebook.com/x', noteCol: 17 })])).toEqual([])
  })

  it('空白行不算', () => {
    expect(pickSheetNotes([row(), row({ note: '   ', noteCol: 17 })])).toEqual([])
  })
})

describe('sheetNoteSourceRef —— 按行幂等，不按人', () => {
  it('用表格里的 lead id 当键', () => {
    expect(sheetNoteSourceRef({ sheetRow: 9, leadId: 'l:777', createdTime: LEAD_AT, email: 'a@b.com', phoneRaw: null, note: 'x' }))
      .toBe('l:777|note')
  })

  it('🔴 同一个人填过两次表 = 两个键，第二次的记录不会盖掉第一次', () => {
    const a = sheetNoteSourceRef({ sheetRow: 9, leadId: 'l:1', createdTime: LEAD_AT, email: 'a@b.com', phoneRaw: null, note: 'x' })
    const b = sheetNoteSourceRef({ sheetRow: 600, leadId: 'l:2', createdTime: LEAD_AT, email: 'a@b.com', phoneRaw: null, note: 'y' })
    expect(a).not.toBe(b)
  })

  it('没有 lead id 就退回「邮箱 + 行号」，仍然一行一个键', () => {
    expect(sheetNoteSourceRef({ sheetRow: 9, leadId: null, createdTime: LEAD_AT, email: 'A@B.com', phoneRaw: null, note: 'x' }))
      .toBe('a@b.com|row9|note')
  })

  it('电话邮箱都没有就认不出是谁', () => {
    expect(sheetNoteSourceRef({ sheetRow: 9, leadId: null, createdTime: LEAD_AT, email: null, phoneRaw: null, note: 'x' })).toBeNull()
  })
})

/** 假 supabase：身份表 + 已有触点表 + 记录写进去了什么。 */
function fakeDb(opts: {
  identities?: Array<{ contact_id: string; kind: string; value: string }>
  existing?: Array<{ contact_id: string; source_ref: string | null; raw: string | null }>
} = {}) {
  const written: Record<string, unknown>[] = []
  const supabase = {
    from: (table: string) => {
      const rows = table === 'contact_identities' ? (opts.identities ?? []) : (opts.existing ?? [])
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
        upsert: async (payload: Record<string, unknown>) => {
          written.push(payload)
          return { error: null }
        },
      }
      return api
    },
  } as unknown as SupabaseClient
  return { supabase, written }
}

const IDENT = [{ contact_id: 'p1', kind: 'phone', value: '+6421363598' }]

async function run(rows: string[][], db: ReturnType<typeof fakeDb>, dryRun = false) {
  return syncSheetFollowupNotes(db.supabase, {
    clientId: CLIENT,
    spreadsheetId: 'sheet-1',
    dryRun,
    readSheet: async () => rows,
  })
}

describe('syncSheetFollowupNotes', () => {
  it('把一条跟进记录写成电话触点，原话逐字保留', async () => {
    const db = fakeDb({ identities: IDENT })
    const s = await run([row({ note: 'voice message', noteCol: 17 })], db)
    expect(s.inserted).toBe(1)
    expect(db.written[0]).toMatchObject({
      client_id: CLIENT,
      contact_id: 'p1',
      channel: 'phone',
      direction: 'outbound',
      raw: 'voice message',
      source: SHEET_FOLLOWUP_SOURCE,
      source_ref: 'l:100|note',
    })
  })

  it('🔴 时间用进线时间，而且必须标成近似 —— 表格不记打电话的时刻，不许编一个', async () => {
    const db = fakeDb({ identities: IDENT })
    await run([row({ note: 'voice message', noteCol: 17 })], db)
    const meta = db.written[0].metadata as Record<string, unknown>
    expect(db.written[0].occurred_at).toBe(new Date(LEAD_AT).toISOString())
    expect(meta.time_is_approximate).toBe(true)
    expect(meta.timestamp_basis).toBe('lead_created_time')
  })

  it('连进线时间都没有就不写 —— 编一个会污染「他等了多久」', async () => {
    const db = fakeDb({ identities: IDENT })
    const s = await run([row({ note: 'voice message', noteCol: 17, createdTime: null })], db)
    expect(s.inserted).toBe(0)
    expect(db.written).toHaveLength(0)
  })

  it('原话里的结论进 metadata（复用 note-parser 的判据，不另写一套）', async () => {
    const db = fakeDb({ identities: IDENT })
    await run([row({ note: 'wrong number', noteCol: 17 })], db)
    expect((db.written[0].metadata as Record<string, unknown>).outcome).toBe('bad_number')
  })

  it('🔴 库里没这个人就跳过并计数 —— 只认人，绝不凭空建客户', async () => {
    const db = fakeDb({ identities: [] })
    const s = await run([row({ note: 'voice message', noteCol: 17 })], db)
    expect(s.skippedContactNotFound).toBe(1)
    expect(db.written).toHaveLength(0)
  })

  it('🔴 这个键已经写过了就跳过（幂等），不重复插', async () => {
    const db = fakeDb({ identities: IDENT, existing: [{ contact_id: 'p1', source_ref: 'l:100|note', raw: 'voice message' }] })
    const s = await run([row({ note: 'voice message', noteCol: 17 })], db)
    expect(s.skippedExisting).toBe(1)
    expect(db.written).toHaveLength(0)
  })

  it('🔴 2026-07 那次旧导入用的是别的键，但同一个人同一句话已经在库里 —— 也不重复插', async () => {
    const db = fakeDb({
      identities: IDENT,
      existing: [{ contact_id: 'p1', source_ref: 'jane@example.com|note', raw: 'voice message' }],
    })
    const s = await run([row({ note: 'voice message', noteCol: 17 })], db)
    expect(s.skippedAlreadyImported).toBe(1)
    expect(db.written).toHaveLength(0)
  })

  it('同一个人、不同的话，照样写进去', async () => {
    const db = fakeDb({
      identities: IDENT,
      existing: [{ contact_id: 'p1', source_ref: 'jane@example.com|note', raw: 'voice message' }],
    })
    const s = await run([row({ note: 'called back, wants Best of China', noteCol: 17 })], db)
    expect(s.inserted).toBe(1)
  })

  it('预演只算不写', async () => {
    const db = fakeDb({ identities: IDENT })
    const s = await run([row({ note: 'voice message', noteCol: 17 })], db, true)
    expect(s.inserted).toBe(1)
    expect(s.dryRun).toBe(true)
    expect(db.written).toHaveLength(0)
  })

  it('🔴 读表格失败时不抛异常，原因进 errors —— 不该把调用它的那趟带崩', async () => {
    const db = fakeDb({ identities: IDENT })
    const s = await syncSheetFollowupNotes(db.supabase, {
      clientId: CLIENT,
      spreadsheetId: 'sheet-1',
      readSheet: async () => { throw new Error('令牌过期') },
    })
    expect(s.errors[0]).toContain('令牌过期')
    expect(s.inserted).toBe(0)
  })
})

describe('配置', () => {
  it('这是 client-specific 配置，目前只有 CTS 一家', () => {
    expect(Object.keys(CLIENT_FOLLOWUP_SHEETS)).toEqual(['c0000000-0000-0000-0000-000000000000'])
  })
})
