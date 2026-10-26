/**
 * 新客人自动分给跟进人（resolveContact 的 autoAssign 开关）。
 *
 * 各渠道（Meta 表单 / 官网表单 / 邮件 / WhatsApp）建人都走 resolveContact，分配放在这一处：
 *   · 只对**新建**生效，命中已有客人不动他原来的跟进人
 *   · 默认不分（手工录入、外呼这类员工自己发起的不开）
 *   · 分配出任何问题都不能挡住建人（入库优先）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '../identity'

const EMAIL = { kind: 'email' as const, value: 'new-customer@example.com' }

let updates: Record<string, unknown>[]
let assignFilters: Array<{ id: string; clientId: string; nullGuard: boolean }>

function mockDb(opts: {
  existing: boolean
  assignees?: string[]
  held?: Record<string, number>
  assignUpdateError?: boolean
  assigneeLookupError?: boolean
}) {
  updates = []
  assignFilters = []
  const assignees = opts.assignees ?? []
  const held = opts.held ?? {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contact_identities') {
      return {
        select: () => ({
          eq: () => ({
            in: () =>
              Promise.resolve({
                data: opts.existing ? [{ contact_id: 'person-1', kind: 'email', value: EMAIL.value }] : [],
              }),
          }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'client_portal_users') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve(
                  opts.assigneeLookupError
                    ? { data: null, error: { message: '查名单故意失败' } }
                    : { data: assignees.map((email) => ({ email })), error: null },
                ),
            }),
          }),
        }),
      }
    }
    if (table === 'contacts') {
      return {
        // 建人
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-person' }, error: null }) }) }),
        // 数每个人手上有几位（countHeldLeads：每人单独 count，不拉整行）
        select: () => ({
          eq: () => ({
            gte: () => ({
              eq: (_col: string, email: string) => Promise.resolve({ count: held[email] ?? 0, error: null }),
            }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updates.push(row)
          const isAssign = 'assigned_to' in row
          const chain = {
            eq: (col: string, val: string) => {
              if (isAssign) {
                if (col === 'id') assignFilters.push({ id: val, clientId: '', nullGuard: false })
                if (col === 'client_id') assignFilters[assignFilters.length - 1].clientId = val
              }
              return chain
            },
            is: (col: string, val: null) => {
              if (isAssign && col === 'assigned_to' && val === null) assignFilters[assignFilters.length - 1].nullGuard = true
              return Promise.resolve({ error: opts.assignUpdateError ? { message: '写入故意失败' } : null })
            },
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }
          return chain
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const assignedTo = () => updates.filter((u) => 'assigned_to' in u).map((u) => u.assigned_to)

beforeEach(() => vi.clearAllMocks())

describe('resolveContact autoAssign', () => {
  it('新建 + 打开开关 + 有人接线索 → 分给他，且只补空、限定本客户', async () => {
    mockDb({ existing: false, assignees: ['lisa@example.com'] })
    const r = await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'email', autoAssign: true })
    expect(r).toMatchObject({ contactId: 'new-person', created: true })
    expect(assignedTo()).toEqual(['lisa@example.com'])
    expect(assignFilters).toEqual([{ id: 'new-person', clientId: 'cts', nullGuard: true }])
  })

  it('🔴 没传开关（默认）→ 新建了也不分（手工录入 / 外呼不该被轮流分走）', async () => {
    mockDb({ existing: false, assignees: ['lisa@example.com'] })
    await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'manual' })
    expect(assignedTo()).toEqual([])
  })

  it('🔴 命中已有客人 → 不动他原来的跟进人', async () => {
    mockDb({ existing: true, assignees: ['lisa@example.com'] })
    const r = await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'email', autoAssign: true })
    expect(r.created).toBe(false)
    expect(assignedTo()).toEqual([])
  })

  it('这个客户没人开「接新线索」→ 不分，客人照样建出来（留在未分配）', async () => {
    mockDb({ existing: false, assignees: [] })
    const r = await resolveContact({ clientId: 'other', identities: [EMAIL], source: 'email', autoAssign: true })
    expect(r).toMatchObject({ contactId: 'new-person', created: true })
    expect(assignedTo()).toEqual([])
  })

  it('两个人轮流：手上线索少的先拿', async () => {
    mockDb({ existing: false, assignees: ['baker@example.com', 'lisa@example.com'], held: { 'baker@example.com': 3, 'lisa@example.com': 1 } })
    await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'whatsapp', autoAssign: true })
    expect(assignedTo()).toEqual(['lisa@example.com'])
  })

  it('🔴 写分配时数据库报错 → 建人照样成功，不抛', async () => {
    mockDb({ existing: false, assignees: ['lisa@example.com'], assignUpdateError: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'email', autoAssign: true })
    expect(r).toMatchObject({ contactId: 'new-person', created: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('🔴 查接线索名单报错 → 建人照样成功，不抛', async () => {
    mockDb({ existing: false, assigneeLookupError: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await resolveContact({ clientId: 'cts', identities: [EMAIL], source: 'email', autoAssign: true })
    expect(r).toMatchObject({ contactId: 'new-person', created: true })
    expect(assignedTo()).toEqual([])
    warn.mockRestore()
  })
})
