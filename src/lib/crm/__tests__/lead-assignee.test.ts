import { describe, it, expect, vi } from 'vitest'
import { pickAssignee } from '../lead-assignee'

/**
 * 轻量 supabase 桩：模拟 .from(table).select(...).eq(...).eq(...).order(...)
 * 以及 .from(table).select(...).eq(...).in(...) 两条链。
 */
function makeSupabase(rows: {
  assignees: Array<{ email: string }>
  contacts: Array<{ assigned_to: string | null }>
}) {
  const assigneesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows.assignees, error: null }),
  }
  const contactsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: rows.contacts, error: null }),
  }
  return {
    from: vi.fn((table: string) =>
      table === 'client_portal_users' ? assigneesChain : contactsChain,
    ),
  } as any
}

describe('pickAssignee', () => {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  it('空名单返回 null', async () => {
    const sup = makeSupabase({ assignees: [], contacts: [] })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBeNull()
  })

  it('N=1 时直接返回那个人（不查 contacts）', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'lisa@example.com' }],
      contacts: [],
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('lisa@example.com')
  })

  it('两人都持 0 单时按字典序取第一个', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [],
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('baker@example.com')
  })

  it('选持有数最少的人', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [
        { assigned_to: 'baker@example.com' },
        { assigned_to: 'baker@example.com' },
        { assigned_to: 'lisa@example.com' },
      ],
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('lisa@example.com')
  })

  it('null assigned_to 不计数', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [
        { assigned_to: null },
        { assigned_to: null },
        { assigned_to: 'baker@example.com' },
      ],
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('lisa@example.com')
  })

  it('并列最少时字典序取第一个', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [
        { assigned_to: 'baker@example.com' },
        { assigned_to: 'lisa@example.com' },
      ],
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('baker@example.com')
  })
})
