import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addProfileIdentity, loadProfile, parseProfileName, setProfileName } from '../profile'

type Row = Record<string, unknown>

/** 内存版数据库：按 eq / in / is(null) 过滤，支持 select / update / insert（identities 带唯一约束）。 */
function memoryDb(seed: Record<string, Row[]>): { db: SupabaseClient; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  const from = (table: string) => {
    const rows = (tables[table] ??= [])
    type Filter = (r: Row) => boolean
    const filters: Filter[] = []
    let mode: 'select' | 'update' = 'select'
    let patch: Row = {}
    const match = (): Row[] => rows.filter((r) => filters.every((f) => f(r)))
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), builder),
      is: (col: string, _v: null) => (filters.push((r) => r[col] === null || r[col] === undefined), builder),
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), builder),
      limit: () => builder,
      update: (p: Row) => ((mode = 'update'), (patch = p), builder),
      insert: (row: Row) => {
        if (table === 'contact_identities' && rows.some((r) => r.client_id === row.client_id && r.kind === row.kind && r.value === row.value)) {
          return Promise.resolve({ error: { code: '23505', message: 'dup' } })
        }
        rows.push({ ...row })
        return Promise.resolve({ error: null })
      },
      maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        const hit = match()
        if (mode === 'update') {
          for (const r of hit) Object.assign(r, patch)
          return resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
        }
        return resolve({ data: hit, error: null })
      },
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, tables }
}

const C = 'client-a'
const seed = () => ({
  contacts: [
    { id: 'p1', client_id: C, display_name: 'Brenda Girven', primary_email: 'brendam@hotmail.co.nz', primary_phone: null },
    { id: 'p2', client_id: C, display_name: 'Other Person', primary_email: 'other@x.com', primary_phone: '+6421111111' },
    { id: 'p3', client_id: C, display_name: null, primary_email: null, primary_phone: null },
    { id: 'x1', client_id: 'client-b', display_name: 'Foreign', primary_email: null, primary_phone: null },
  ],
  contact_identities: [
    { contact_id: 'p1', client_id: C, kind: 'email', value: 'brendam@hotmail.co.nz' },
    { contact_id: 'p1', client_id: C, kind: 'email', value: 'brenda.second@gmail.com' },
    { contact_id: 'p2', client_id: C, kind: 'email', value: 'other@x.com' },
    { contact_id: 'p2', client_id: C, kind: 'phone', value: '+6421111111' },
  ],
  conversations: [
    { contact_id: 'p1', client_id: C, channel: 'whatsapp', participant_name: 'Bren G' },
    { contact_id: 'p1', client_id: C, channel: 'email', participant_name: 'brendam@hotmail.co.nz' },
    { contact_id: 'p1', client_id: C, channel: 'messenger', participant_name: 'Brenda Girven' },
    { contact_id: 'p1', client_id: C, channel: 'messenger', participant_name: 'Facebook 用户' },
  ],
})

describe('parseProfileName', () => {
  it('真名通过；首尾空白去掉；空串 / null / undefined = 清空', () => {
    expect(parseProfileName('  Brenda Girven ')).toEqual({ ok: true, value: 'Brenda Girven' })
    expect(parseProfileName('')).toEqual({ ok: true, value: null })
    expect(parseProfileName(null)).toEqual({ ok: true, value: null })
    expect(parseProfileName(undefined)).toEqual({ ok: true, value: null })
  })
  it('邮箱 / 电话 / 占位词 / 系统账号名 → 拒绝并说明原因', () => {
    for (const bad of ['a@b.com', '+64 21 123 4567', 'Unknown', 'N/A', 'Facebook 用户', 'WhatsApp Business']) {
      const r = parseProfileName(bad)
      expect(r.ok, bad).toBe(false)
    }
  })
  it('换行 / 控制字符 / 零宽字符直接拒绝（不悄悄剥掉）；超长拒绝；非字符串拒绝', () => {
    expect(parseProfileName('Bob\nLee').ok).toBe(false)
    expect(parseProfileName('Bob​Lee').ok).toBe(false)
    expect(parseProfileName('Bob\u0007').ok).toBe(false)
    for (const c of ['\u2066', '\u2067', '\u2068', '\u2069', '\u00AD', '\u180E', '\uFE0F', '\uFFF9']) expect(parseProfileName(`Bob${c}Lee`).ok, c).toBe(false)
    expect(parseProfileName('x'.repeat(81)).ok).toBe(false)
    expect(parseProfileName('x'.repeat(80)).ok).toBe(true)
    expect(parseProfileName(5).ok).toBe(false)
  })
})

describe('loadProfile', () => {
  it('名字 / 邮箱（主邮箱标出）/ 电话；昵称去重、过清洗（邮箱、占位词、与名字相同的都不列）', async () => {
    const { db } = memoryDb(seed())
    const p = await loadProfile(db, C, 'p1')
    expect(p?.name).toBe('Brenda Girven')
    expect(p?.emails).toEqual([
      { value: 'brendam@hotmail.co.nz', primary: true },
      { value: 'brenda.second@gmail.com', primary: false },
    ])
    expect(p?.phones).toEqual([])
    expect(p?.nicknames).toEqual([{ channel: 'whatsapp', name: 'Bren G' }])
  })
  it('跨客户取不到（隔离）；不存在返回 null', async () => {
    const { db } = memoryDb(seed())
    expect(await loadProfile(db, C, 'x1')).toBeNull()
    expect(await loadProfile(db, C, 'nope')).toBeNull()
  })
})

describe('setProfileName', () => {
  it('改名只动这个客户的这个人；清空写 null', async () => {
    const { db, tables } = memoryDb(seed())
    expect(await setProfileName(db, C, 'p3', 'Chris Brown')).toBe('ok')
    expect(tables.contacts.find((r) => r.id === 'p3')?.display_name).toBe('Chris Brown')
    expect(await setProfileName(db, C, 'p3', null)).toBe('ok')
    expect(tables.contacts.find((r) => r.id === 'p3')?.display_name).toBeNull()
  })
  it('🔴 双保险：没过清洗的名字（邮箱 / 带空白）即使调用方漏了 parse 也写不进去', async () => {
    const { db, tables } = memoryDb(seed())
    expect(await setProfileName(db, C, 'p3', 'a@b.com')).toBe('error')
    expect(await setProfileName(db, C, 'p3', ' Bob ')).toBe('error')
    expect(tables.contacts.find((r) => r.id === 'p3')?.display_name).toBeNull()
  })

  it('别的客户的人 → not_found，且没改动', async () => {
    const { db, tables } = memoryDb(seed())
    expect(await setProfileName(db, C, 'x1', 'Hacked')).toBe('not_found')
    expect(tables.contacts.find((r) => r.id === 'x1')?.display_name).toBe('Foreign')
  })
})

describe('addProfileIdentity', () => {
  it('新邮箱：规范化后加入；他没有主邮箱时成为主邮箱', async () => {
    const { db, tables } = memoryDb(seed())
    const r = await addProfileIdentity(db, C, 'p3', 'email', '  Chris@Example.COM ')
    expect(r).toEqual({ ok: true, added: true })
    expect(tables.contact_identities.some((i) => i.contact_id === 'p3' && i.value === 'chris@example.com')).toBe(true)
    expect(tables.contacts.find((x) => x.id === 'p3')?.primary_email).toBe('chris@example.com')
  })
  it('他已有主邮箱时，新加的不抢主邮箱', async () => {
    const { db, tables } = memoryDb(seed())
    await addProfileIdentity(db, C, 'p1', 'email', 'new@x.com')
    expect(tables.contacts.find((x) => x.id === 'p1')?.primary_email).toBe('brendam@hotmail.co.nz')
  })
  it('电话：本地号码补国码后保存；认不出来 → 400', async () => {
    const { db, tables } = memoryDb(seed())
    expect(await addProfileIdentity(db, C, 'p3', 'phone', '021 363 598')).toEqual({ ok: true, added: true })
    expect(tables.contact_identities.some((i) => i.contact_id === 'p3' && i.value === '+6421363598')).toBe(true)
    const bad = await addProfileIdentity(db, C, 'p3', 'phone', '12')
    expect(bad).toMatchObject({ ok: false, status: 400 })
  })
  it('邮箱形状不对 → 400；不是字符串 → 400', async () => {
    const { db } = memoryDb(seed())
    expect(await addProfileIdentity(db, C, 'p3', 'email', 'not-an-email')).toMatchObject({ ok: false, status: 400 })
    expect(await addProfileIdentity(db, C, 'p3', 'email', 42)).toMatchObject({ ok: false, status: 400 })
  })
  it('已经是他自己的 → 成功且 added=false（幂等）', async () => {
    const { db } = memoryDb(seed())
    expect(await addProfileIdentity(db, C, 'p1', 'email', 'BRENDAM@hotmail.co.nz')).toEqual({ ok: true, added: false })
  })
  it('🔴 已经是别的客人的 → 409，指出是谁，且什么都不改（不自动合并）', async () => {
    const { db, tables } = memoryDb(seed())
    const r = await addProfileIdentity(db, C, 'p3', 'email', 'other@x.com')
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect((r as { error: string }).error).toContain('Other Person')
    expect(tables.contact_identities.filter((i) => i.value === 'other@x.com')).toHaveLength(1)
    expect(tables.contacts.find((x) => x.id === 'p3')?.primary_email).toBeNull()
  })
  it('别的客户的人 → 404', async () => {
    const { db } = memoryDb(seed())
    expect(await addProfileIdentity(db, C, 'x1', 'email', 'a@b.com')).toMatchObject({ ok: false, status: 404 })
  })
  it('🔴 身份表没有这一行、但别的客人的**主邮箱 / 主电话**就是它（脏数据）→ 同样 409，不会挂到两个人名下', async () => {
    const s = seed()
    s.contacts.push({ id: 'p9', client_id: C, display_name: 'Dirty Data', primary_email: 'dirty@x.com', primary_phone: '+6429999999' })
    const { db, tables } = memoryDb(s)
    const e = await addProfileIdentity(db, C, 'p3', 'email', 'dirty@x.com')
    expect(e).toMatchObject({ ok: false, status: 409 })
    expect((e as { error: string }).error).toContain('Dirty Data')
    const p = await addProfileIdentity(db, C, 'p3', 'phone', '+6429999999')
    expect(p).toMatchObject({ ok: false, status: 409 })
    expect(tables.contact_identities.filter((i) => i.value === 'dirty@x.com')).toHaveLength(0)
  })
  it('数据库唯一约束兜底：并发抢同一个邮箱（insert 撞 23505）→ 409', async () => {
    const { db } = memoryDb(seed())
    const racing = {
      from: (t: string) => {
        const b = (db as unknown as { from: (x: string) => Record<string, unknown> }).from(t)
        if (t !== 'contact_identities') return b
        return { ...b, insert: () => Promise.resolve({ error: { code: '23505', message: 'dup' } }) }
      },
    } as unknown as typeof db
    expect(await addProfileIdentity(racing, C, 'p3', 'email', 'race@x.com')).toMatchObject({ ok: false, status: 409 })
  })
})
