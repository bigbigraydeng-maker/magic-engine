/**
 * 🔴 钉的是「凭据确实没交出去」，不是「比较器返回 false」。
 *
 * 狄仁杰 2026-08-05 攻击验证指出：先前的测试全在测纯比较器，
 * **没有一条断言接线是通的** —— 而真出事的正是接线那一层
 * （某个调用方一个 `.catch(() => null)` 就把红线错误吞成了「这个客户还没配」）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows: Record<string, unknown> = {}

vi.mock('../crypto', () => ({
  encryptToken: (s: string) => `enc.${s}`,
  decryptToken: (s: string) => s.replace(/^enc\./, ''),
  tokenLastFour: (s: string) => s.slice(-4),
}))

vi.mock('../../supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === 'cms_connections') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = () => Promise.resolve({ data: rows.connection ?? null, error: null })
        return chain
      }
      if (table === 'clients') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = () =>
          Promise.resolve(
            rows.clientError
              ? { data: null, error: { message: rows.clientError } }
              : { data: rows.client ?? null, error: null },
          )
        return chain
      }
      throw new Error(`fake supabase: table '${table}' is not modelled`)
    },
  },
}))

import { getWordpressConnection, CrossClientTargetError } from '../connection-store'

function setup(siteUrl: string | null, clientDomain: string | null | undefined) {
  rows.connection = {
    id: 'x',
    client_id: 'cts',
    provider: 'wordpress',
    site_url: siteUrl,
    username: 'u',
    encrypted_token: 'enc.SECRET-PASSWORD',
    token_last_four: 'WORD',
    status: 'error',
    content_paths: [],
    content_targets: [],
  }
  rows.client = clientDomain === undefined ? null : { domain: clientDomain }
  rows.clientError = undefined
}

describe('getWordpressConnection —— 凭据发放这一层的隔离闸', () => {
  beforeEach(() => {
    for (const k of Object.keys(rows)) delete rows[k]
  })

  it('🔴 真实那条：CTS 的通道指向 Oztop 的网站 → 拒绝交出密码', async () => {
    setup('https://oztopbuildingsupplies.com.au', 'ctstours.co.nz')
    await expect(getWordpressConnection('cts')).rejects.toThrow(CrossClientTargetError)
  })

  it('🔴 报错里不许带出密码', async () => {
    setup('https://oztopbuildingsupplies.com.au', 'ctstours.co.nz')
    const err = await getWordpressConnection('cts').catch((e: Error) => e)
    expect(String(err)).not.toContain('SECRET-PASSWORD')
  })

  it('🔴 专用错误类型 —— 上层不能用宽泛 catch 把它当成「没配」吞掉', async () => {
    setup('https://oztopbuildingsupplies.com.au', 'ctstours.co.nz')
    const err = (await getWordpressConnection('cts').catch((e: unknown) => e)) as CrossClientTargetError
    expect(err).toBeInstanceOf(CrossClientTargetError)
    expect(err.code).toBe('CROSS_CLIENT_TARGET')
  })

  it('指向自己的网站 → 正常交出', async () => {
    setup('https://oztopbuildingsupplies.com.au', 'oztopbuildingsupplies.com.au')
    const conn = await getWordpressConnection('oz')
    expect(conn?.plainAppPassword).toBe('SECRET-PASSWORD')
  })

  it('子域名也算自己家', async () => {
    setup('https://shop.ctstours.co.nz', 'ctstours.co.nz')
    await expect(getWordpressConnection('cts')).resolves.toBeTruthy()
  })

  it('🔴 客户查不到 → 不交出（宁可发不出去，也不能发错人）', async () => {
    setup('https://anything.com', undefined)
    await expect(getWordpressConnection('ghost')).rejects.toThrow(/不存在/)
  })

  it('🔴 客户表查询出错 → 也不交出', async () => {
    setup('https://anything.com', 'ctstours.co.nz')
    rows.clientError = 'db down'
    await expect(getWordpressConnection('cts')).rejects.toThrow(/无法核对客户域名/)
  })

  it('没有连接记录时返回 null（这是「真没配」，跟串台要分开）', async () => {
    rows.connection = null
    await expect(getWordpressConnection('nobody')).resolves.toBeNull()
  })

  it('🔴 客户没填域名时不拦 —— 但这件事由每日排查报出来，不在这里静默', async () => {
    setup('https://anything.com', null)
    await expect(getWordpressConnection('roman')).resolves.toBeTruthy()
  })
})
