import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  errorOnQuery: null as number | null, // 1-based; null = every query
  queries: [] as Array<Array<[string, ...unknown[]]>>,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const calls: Array<[string, ...unknown[]]> = []
      mocks.queries.push(calls)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq']) b[m] = (...a: unknown[]) => { calls.push([m, ...a]); return b }
      b.then = (resolve: (v: unknown) => unknown) => {
        const eqs = new Map(calls.filter(([m]) => m === 'eq').map(([, k, v]) => [String(k), v]))
        const excludesRevoked = calls.some(([m, k, v]) => m === 'neq' && k === 'status' && v === 'revoked')
        const failing = mocks.error && (mocks.errorOnQuery === null || mocks.errorOnQuery === mocks.queries.indexOf(calls) + 1)
        const data = mocks.rows.filter(r => (!excludesRevoked || r.status !== 'revoked')
          && (!eqs.has('provider') || r.provider === eqs.get('provider'))
          && (!eqs.has('account_id') || r.account_id === eqs.get('account_id'))
          && (!eqs.has('client_id') || r.client_id === eqs.get('client_id')))
        return Promise.resolve({ data: failing ? null : data, error: failing ? mocks.error : null }).then(resolve)
      }
      return b
    },
  },
}))

import { checkSocialAccountAvailable } from '../connection-guard'

const row = (client_id: string, account_id: string, status = 'active', provider = 'tiktok') => ({ client_id, account_id, status, provider })

beforeEach(() => { mocks.rows = []; mocks.error = null; mocks.errorOnQuery = null; mocks.queries = [] })

describe('checkSocialAccountAvailable', () => {
  it('这个客户还没有授权、账号也没被占用 → 放行', async () => {
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).toBe('ok')
  })

  it('同一客户重新授权同一个账号 → 放行(刷新授权)', async () => {
    mocks.rows = [row('c1', 'open-a')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).toBe('ok')
  })

  it('🔴 同一个账号已挂在另一个客户名下 → 拒绝', async () => {
    mocks.rows = [row('c2', 'open-a')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).toBe('account_in_use')
  })

  it('🔴 过期/出错但没撤销的授权也算占用(只有撤销才是释放)', async () => {
    for (const status of ['expired', 'error']) {
      mocks.rows = [row('c2', 'open-a', status)]
      expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a'), status).toBe('account_in_use')
    }
  })

  it('已撤销的占用不算(撤销能释放账号)', async () => {
    mocks.rows = [row('c2', 'open-a', 'revoked')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).toBe('ok')
  })

  it('🔴 这个客户已经有另一个账号的有效授权 → 拒绝(不新增第二条)', async () => {
    mocks.rows = [row('c1', 'open-old')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-new')).toBe('has_other_account')
  })

  it('已撤销的旧账号不挡新账号', async () => {
    mocks.rows = [row('c1', 'open-old', 'revoked')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-new')).toBe('ok')
  })

  it('同时满足两种情况时,先报「被别的客户占用」', async () => {
    mocks.rows = [row('c2', 'open-new'), row('c1', 'open-old')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-new')).toBe('account_in_use')
  })

  it('只看同一个平台:别的平台里同名账号不算占用', async () => {
    mocks.rows = [row('c2', 'open-a', 'active', 'google_youtube'), row('c1', 'open-b', 'active', 'google_youtube')]
    expect(await checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).toBe('ok')
  })

  it('🔴 查库出错 → 抛出(不能把「查不到」当成「可以放行」)', async () => {
    mocks.error = { message: 'db down' }
    await expect(checkSocialAccountAvailable('c1', 'tiktok', 'open-a')).rejects.toThrow(/授权占用检查失败/)
  })

  it('🔴 任意一次查询出错都抛出(第一次、第二次各自单独失败)', async () => {
    for (const n of [1, 2]) {
      mocks.queries = []; mocks.error = { message: 'db down' }; mocks.errorOnQuery = n
      await expect(checkSocialAccountAvailable('c1', 'tiktok', 'open-a'), `query ${n}`).rejects.toThrow(/授权占用检查失败/)
    }
  })

  it('🔴 空账号编号 → 抛出(空串会匹配所有空串行)', async () => {
    await expect(checkSocialAccountAvailable('c1', 'tiktok', '')).rejects.toThrow()
    await expect(checkSocialAccountAvailable('c1', 'tiktok', '   ')).rejects.toThrow()
  })

  it('查询只用参数化条件,账号编号不拼进过滤字符串', async () => {
    await checkSocialAccountAvailable('c1', 'tiktok', 'a,b)c.eq.x')
    const flat = mocks.queries.flat()
    expect(flat.some(([m]) => m === 'or')).toBe(false)
    expect(flat.some(([m, k, v]) => m === 'eq' && k === 'account_id' && v === 'a,b)c.eq.x')).toBe(true)
  })
})
