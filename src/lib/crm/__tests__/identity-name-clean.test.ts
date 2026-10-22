/**
 * resolveContact 入口的名字清洗（2026-10-22 PM：不能拿邮箱当名字）。
 *
 * 所有渠道建人都走 resolveContact，所以清洗放这一处就覆盖全部渠道。钉死：
 *  · 邮箱 / 电话形状的名字 → 新建的人 display_name 为 null（不存成名字）
 *  · 命中已有联系人时，传进来的是邮箱形状 → 不覆盖原名（不能用低质量名字冲掉真名）
 *  · 真名 → 照旧（新建写入 / 命中已有且允许覆盖时覆盖）
 *  · overwriteDisplayName=false → 命中已有时不动原名（邮件这一路用）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '../identity'

const EMAIL = { kind: 'email' as const, value: 'chris@example.com' }

let inserts: Record<string, unknown>[]
let updates: Record<string, unknown>[]

function mockDb(existing: boolean) {
  inserts = []
  updates = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contact_identities') {
      return {
        select: () => ({
          eq: () => ({ in: () => Promise.resolve({ data: existing ? [{ contact_id: 'person-1', kind: 'email', value: EMAIL.value }] : [] }) }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'contacts') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-person' }, error: null }) }) }
        },
        update: (row: Record<string, unknown>) => {
          updates.push(row)
          return { eq: () => Object.assign(Promise.resolve({ error: null }), { is: () => Promise.resolve({ error: null }) }) }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => vi.clearAllMocks())

describe('resolveContact 名字清洗', () => {
  it('新建：邮箱形状的名字不存成名字（display_name 为 null）', async () => {
    mockDb(false)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'hayleyhailstone@icloud.com', source: 'email' })
    expect(inserts[0].display_name).toBeNull()
  })

  it('新建：电话形状 / 占位词也不存成名字', async () => {
    mockDb(false)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: '+64 21 123 4567' })
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Facebook 用户' })
    expect(inserts.map((r) => r.display_name)).toEqual([null, null])
  })

  it('新建：真名照旧写入；带地址的名字只留名字部分', async () => {
    mockDb(false)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Chris Brown' })
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Bob Lee <bob@x.com>' })
    expect(inserts.map((r) => r.display_name)).toEqual(['Chris Brown', 'Bob Lee'])
  })

  it('命中已有联系人：传进来的是邮箱形状 → 不覆盖原名（更新里没有 display_name）', async () => {
    mockDb(true)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'chris@example.com' })
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.every((u) => !('display_name' in u))).toBe(true)
  })

  it('命中已有联系人：传进来的是真名且允许覆盖 → 覆盖；overwriteDisplayName=false → 不覆盖', async () => {
    mockDb(true)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Christine Brown' })
    expect(updates[0]).toMatchObject({ display_name: 'Christine Brown' })
    mockDb(true)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Christine Brown', overwriteDisplayName: false })
    // 主更新（带 last_seen_at 的那条）不带名字；名字只会走下面那条「仅原名为空才补」的条件更新
    expect(updates.find((u) => 'last_seen_at' in u)).not.toHaveProperty('display_name')
  })

  it('overwriteDisplayName=false 默认**不**补名字（公开端点不许改已有客户资料）；加 fillEmptyDisplayName 才在原名为空时补', async () => {
    mockDb(true)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Christine Brown', overwriteDisplayName: false })
    expect(updates.some((u) => u.display_name === 'Christine Brown')).toBe(false)
    mockDb(true)
    await resolveContact({ clientId: 'c', identities: [EMAIL], displayName: 'Christine Brown', overwriteDisplayName: false, fillEmptyDisplayName: true })
    expect(updates.some((u) => u.display_name === 'Christine Brown')).toBe(true)
  })
})
