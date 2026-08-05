import { describe, it, expect, vi } from 'vitest'
import {
  pickConnectionsToRetest,
  classifyFailure,
  retestBrokenConnections,
  RETEST_MIN_HOURS,
} from '../retest'
import type { RetestCandidateRow } from '../retest'

const NOW = new Date('2026-08-05T06:00:00Z')

function row(over: Partial<RetestCandidateRow> = {}): RetestCandidateRow {
  return {
    client_id: 'oztop',
    provider: 'wordpress',
    status: 'error',
    last_tested_at: '2026-06-19T00:00:00Z',
    ...over,
  }
}

describe('pickConnectionsToRetest', () => {
  it('🔴 只测坏了的 —— 正常连接一律不碰（把好连接测翻正是这次事故的成因）', () => {
    const picked = pickConnectionsToRetest(
      [row({ status: 'connected' }), row({ status: 'error' })],
      NOW,
    )
    expect(picked).toHaveLength(1)
    expect(picked[0].status).toBe('error')
  })

  it('🔴 Oztop 那条躺了 47 天的，必须被选中', () => {
    expect(pickConnectionsToRetest([row()], NOW)).toHaveLength(1)
  })

  it('🔴 刚测过的不重复测 —— 太密等于替客户防火墙加深敌意', () => {
    const justTested = row({ last_tested_at: '2026-08-05T05:00:00Z' })
    expect(pickConnectionsToRetest([justTested], NOW)).toEqual([])
  })

  it('从没测过的坏连接要给一次机会', () => {
    expect(pickConnectionsToRetest([row({ last_tested_at: null })], NOW)).toHaveLength(1)
  })

  it(`间隔正好是 ${RETEST_MIN_HOURS} 小时的边界：到点就测`, () => {
    const exactly = new Date(NOW.getTime() - RETEST_MIN_HOURS * 3_600_000).toISOString()
    expect(pickConnectionsToRetest([row({ last_tested_at: exactly })], NOW)).toHaveLength(1)
    const oneMinuteShy = new Date(NOW.getTime() - RETEST_MIN_HOURS * 3_600_000 + 60_000).toISOString()
    expect(pickConnectionsToRetest([row({ last_tested_at: oneMinuteShy })], NOW)).toEqual([])
  })
})

describe('classifyFailure —— 说人话，别只说「坏了」', () => {
  it('🔴 被安全防护拦住 ≠ 密码错了。说错了人会去改密码，白折腾', () => {
    const real =
      'WordPress testConnection: response is not JSON — the site may be blocking REST API access (security plugin…) /.well-known/sgcaptcha/'
    expect(classifyFailure(real)).toContain('安全防护')
    expect(classifyFailure(real)).toContain('不是密码问题')
  })

  it('401/403 才说密码失效', () => {
    expect(classifyFailure('GitHub 401: Bad credentials')).toContain('重新授权')
  })

  it('没有发布权限单独说', () => {
    expect(classifyFailure('User "x" has no publish role (roles: subscriber)')).toContain('没有发布权限')
  })

  it('连不上跟被拦住是两回事', () => {
    expect(classifyFailure('fetch failed: ENOTFOUND')).toContain('连不上')
  })

  it('认不出的原因也给一句能读的话，不返回空', () => {
    expect(classifyFailure(null)).toBeTruthy()
    expect(classifyFailure('something weird')).toBeTruthy()
  })
})

// 假 supabase 按表建模；认不出的表直接抛。
function fakeSupabase(opts: { rows?: RetestCandidateRow[]; error?: string }) {
  return {
    from(table: string) {
      if (table !== 'cms_connections') {
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () =>
        Promise.resolve(
          opts.error
            ? { data: null, error: { message: opts.error } }
            : { data: opts.rows ?? [], error: null },
        )
      return chain
    },
  } as never
}

describe('retestBrokenConnections', () => {
  it('🔴 假件护栏：问一张没建模的表要直接炸', () => {
    expect(() => (fakeSupabase({}) as unknown as { from: (t: string) => unknown }).from('blog_posts')).toThrow(
      /not modelled/,
    )
  })

  it('🔴 修好了要写回 connected —— 这就是「自己好」的那一步', async () => {
    const marked: Array<[string, string, boolean]> = []
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [row()] }),
      {
        testConnection: async () => ({ ok: true }),
        markTested: async (c, p, ok) => {
          marked.push([c, p, ok])
        },
      },
      NOW,
    )
    expect(res.recovered).toBe(1)
    expect(res.stillBroken).toBe(0)
    expect(marked).toEqual([['oztop', 'wordpress', true]])
  })

  it('🔴 还是坏的要把原因带回来，不能只说「失败」', async () => {
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [row()] }),
      {
        testConnection: async () => ({ ok: false, error: 'blocking REST API access sgcaptcha' }),
        markTested: async () => {},
      },
      NOW,
    )
    expect(res.stillBroken).toBe(1)
    expect(res.outcomes[0].error).toContain('sgcaptcha')
  })

  it('🔴 一条炸了不能连累其他条', async () => {
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [row({ client_id: 'a' }), row({ client_id: 'b' })] }),
      {
        testConnection: async (id) => {
          if (id === 'a') throw new Error('网站超时')
          return { ok: true }
        },
        markTested: async () => {},
      },
      NOW,
    )
    expect(res.checked).toBe(2)
    expect(res.recovered).toBe(1)
    expect(res.outcomes.find((o) => o.client_id === 'a')?.error).toContain('网站超时')
  })

  it('🔴 查询失败要抛，不能装成「没有坏连接」跑完', async () => {
    await expect(
      retestBrokenConnections(
        fakeSupabase({ error: 'db down' }),
        { testConnection: async () => ({ ok: true }), markTested: async () => {} },
        NOW,
      ),
    ).rejects.toThrow(/db down/)
  })

  it('没有坏连接时安静返回零，不去测任何东西', async () => {
    const test = vi.fn()
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [] }),
      { testConnection: test as never, markTested: async () => {} },
      NOW,
    )
    expect(res.checked).toBe(0)
    expect(test).not.toHaveBeenCalled()
  })
})
