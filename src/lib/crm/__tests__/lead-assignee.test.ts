import { describe, it, expect, vi } from 'vitest'
import { pickAssignee } from '../lead-assignee'

/**
 * 轻量 supabase 桩：模拟 .from('client_portal_users').select().eq().eq().order()，
 * 以及 .from('contacts').select('id', { count, head }).eq('client_id').eq('assigned_to')
 * ——每个候选人单独数一次，不拉整行（整行会被 Supabase 的 1000 行上限截断）。
 */
function makeSupabase(rows: {
  assignees: Array<{ email: string }>
  contacts: Array<{ assigned_to: string | null }>
  /** 直接指定某人手上有几位（用来模拟远超 1000 的量，不必造上千行）。 */
  counts?: Record<string, number>
}) {
  const countSelectArgs: unknown[][] = []
  const assigneesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows.assignees, error: null }),
  }
  const contactsFrom = () => {
    const chain: any = {
      select: vi.fn((...args: unknown[]) => {
        countSelectArgs.push(args)
        return chain
      }),
      eq: vi.fn((col: string, val: string) =>
        col === 'assigned_to'
          ? Promise.resolve({
              count: rows.counts?.[val] ?? rows.contacts.filter((r) => r.assigned_to === val).length,
              error: null,
            })
          : chain,
      ),
    }
    return chain
  }
  const sup = {
    from: vi.fn((table: string) => (table === 'client_portal_users' ? assigneesChain : contactsFrom())),
  } as any
  sup.countSelectArgs = countSelectArgs
  return sup
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
  it('🔴 持有数远超 1000 也数得对（不拉整行，不被 1000 行上限截断）', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [],
      counts: { 'baker@example.com': 1500, 'lisa@example.com': 300 },
    })
    const picked = await pickAssignee({ clientId, supabase: sup })
    expect(picked).toBe('lisa@example.com')
  })

  it('🔴 数持有数用「只回计数不回行」的写法（count exact + head）', async () => {
    const sup = makeSupabase({
      assignees: [{ email: 'baker@example.com' }, { email: 'lisa@example.com' }],
      contacts: [],
      counts: { 'baker@example.com': 5, 'lisa@example.com': 7 },
    })
    await pickAssignee({ clientId, supabase: sup })
    expect(sup.countSelectArgs.length).toBe(2) // 每个候选人一次
    for (const args of sup.countSelectArgs) {
      expect(args[1]).toEqual({ count: 'exact', head: true })
    }
  })
})
