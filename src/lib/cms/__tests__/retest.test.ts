import { describe, it, expect, vi } from 'vitest'
import {
  pickConnectionsToRetest,
  classifyFailure,
  retestBrokenConnections,
  RETEST_MIN_HOURS,
  targetBelongsToClient,
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

// ---------------------------------------------------------------------------
// 🔴 通道指向核对 —— 2026-08-05 实测真事故：
//    CTS（ctstours.co.nz）的 WordPress 通道指向 oztopbuildingsupplies.com.au。
//    它一直是 error 所以从没发出去过东西，但**自动重测会把它激活**：
//    Oztop 网站一旦不再拦我们，这条也会被判成连通，CTS 的文章就发到 Oztop 站上。
// ---------------------------------------------------------------------------

describe('targetBelongsToClient', () => {
  it('🔴 CTS 的通道指向 Oztop 的网站 → 判为不属于（真实数据）', () => {
    expect(targetBelongsToClient('https://oztopbuildingsupplies.com.au', 'ctstours.co.nz')).toBe(false)
  })

  it('Oztop 自己那条是对的', () => {
    expect(targetBelongsToClient('https://oztopbuildingsupplies.com.au', 'oztopbuildingsupplies.com.au')).toBe(true)
  })

  it('www / 协议 / 结尾斜杠 / 大小写都不算差异', () => {
    expect(targetBelongsToClient('https://WWW.Ctstours.co.nz/', 'ctstours.co.nz')).toBe(true)
    expect(targetBelongsToClient('http://ctstours.co.nz', 'www.ctstours.co.nz')).toBe(true)
  })

  it('子域名算自己家', () => {
    expect(targetBelongsToClient('https://blog.ctstours.co.nz', 'ctstours.co.nz')).toBe(true)
  })

  it('🔴 前缀像但不是同一个域，不许放过', () => {
    expect(targetBelongsToClient('https://ctstours.co.nz.evil.com', 'ctstours.co.nz')).toBe(false)
    expect(targetBelongsToClient('https://notctstours.co.nz', 'ctstours.co.nz')).toBe(false)
  })

  it('判断不了就返回 null（GitHub 通道指向仓库，本来就不是域名）', () => {
    expect(targetBelongsToClient(null, 'ctstours.co.nz')).toBeNull()
    expect(targetBelongsToClient('https://x.com', null)).toBeNull()
  })
})

describe('retestBrokenConnections —— 指错客户的通道', () => {
  function mismatched(): RetestCandidateRow {
    return {
      client_id: 'cts',
      provider: 'wordpress',
      status: 'error',
      last_tested_at: '2026-05-25T00:00:00Z',
      site_url: 'https://oztopbuildingsupplies.com.au',
      client_domain: 'ctstours.co.nz',
    }
  }

  it('🔴 指错客户的连接**连测都不测** —— 测通了就会被标成连通', async () => {
    const test = vi.fn()
    const mark = vi.fn()
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [mismatched()] }),
      { testConnection: test as never, markTested: mark as never },
      NOW,
    )
    expect(test).not.toHaveBeenCalled()
    expect(mark).not.toHaveBeenCalled()
    expect(res.recovered).toBe(0)
    expect(res.outcomes[0].mismatched).toBe(true)
  })

  it('🔴 原因要说清是「配错了客户」，不是「连不上」—— 两者的处置完全不同', async () => {
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [mismatched()] }),
      { testConnection: async () => ({ ok: true }), markTested: async () => {} },
      NOW,
    )
    expect(classifyFailure(res.outcomes[0].error)).toContain('别的客户的网站')
  })

  it('指对了的照常测，不受影响', async () => {
    const ok = { ...mismatched(), client_id: 'oztop', client_domain: 'oztopbuildingsupplies.com.au' }
    const res = await retestBrokenConnections(
      fakeSupabase({ rows: [ok] }),
      { testConnection: async () => ({ ok: true }), markTested: async () => {} },
      NOW,
    )
    expect(res.recovered).toBe(1)
  })
})
