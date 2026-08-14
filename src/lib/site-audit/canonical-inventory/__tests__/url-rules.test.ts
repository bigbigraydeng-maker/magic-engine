/**
 * URL 归一与主机边界（Issue #930）。
 *
 * 🔴 主机判定的用例分两组：
 *    - 通用组用 example.com，证明这一层不是给某个客户写的；
 *    - **现场组**用 #930 授权原文点名的那两个主机（裸域 vs www），
 *      因为授权要求的证明就是这一条。生产代码里没有任何客户字面量，
 *      架构守卫盯着这件事（见 architecture.test.ts）。
 */

import { describe, expect, it } from 'vitest'
import {
  InventoryHostBoundaryError,
  canonicaliseUrl,
  isApprovedHost,
  deriveCanonicalUrl,
  normaliseApprovedHosts,
} from '../url-rules'

const BOUNDARY = { approvedHosts: ['example.com'] }

function canonical(url: string, hosts: readonly string[] = ['example.com']): string | null {
  const r = canonicaliseUrl(url, { approvedHosts: hosts })
  return r.ok ? r.canonicalUrl : null
}

function reasons(url: string, hosts: readonly string[] = ['example.com']): readonly string[] {
  const r = canonicaliseUrl(url, { approvedHosts: hosts })
  return r.ok ? [] : r.reasonCodes
}

describe('批准主机清单本身的校验', () => {
  it('空清单直接抛 —— 没有边界就不许生成计划', () => {
    expect(() => normaliseApprovedHosts([])).toThrow(InventoryHostBoundaryError)
  })

  it.each([
    ['https://example.com', '带 scheme'],
    ['example.com/path', '带路径'],
    ['example.com:8443', '带端口'],
    ['*.example.com', '通配符'],
    ['.example.com', '前导点'],
    ['user@example.com', '带 @'],
    ['   ', '空白'],
  ])('%s（%s）一律拒，不做善意修补', (host) => {
    expect(() => normaliseApprovedHosts([host])).toThrow(InventoryHostBoundaryError)
  })

  it('大小写归一 + 去重，但不新增任何主机', () => {
    expect(normaliseApprovedHosts(['Example.COM', 'example.com', 'shop.example.com'])).toEqual([
      'example.com',
      'shop.example.com',
    ])
  })

  it('🔴 绝不自动补 www —— 批准裸域不等于批准 www', () => {
    expect(normaliseApprovedHosts(['example.com'])).toEqual(['example.com'])
    expect(isApprovedHost('www.example.com', ['example.com'])).toBe(false)
  })
})

describe('主机边界（精确比较，不是前缀比较）', () => {
  it('裸域被接受、www 未列入即被拒 —— #930 授权点名的那条证明', () => {
    const hosts = ['romanhu.com']
    expect(canonical('https://romanhu.com/about', hosts)).toBe('https://romanhu.com/about')
    expect(reasons('https://www.romanhu.com/about', hosts)).toEqual(['host_not_approved'])
  })

  it('显式列入 www 之后它才被接受', () => {
    expect(canonical('https://www.romanhu.com/about', ['romanhu.com', 'www.romanhu.com'])).toBe(
      'https://www.romanhu.com/about',
    )
  })

  it.each([
    'https://example.com.evil.com/x',
    'https://example.comevil.com/x',
    'https://notexample.com/x',
    'https://sub.example.com/x',
    'https://example.com./x',
  ])('前缀 / 后缀 / 子域混淆一律拒：%s', (url) => {
    expect(reasons(url)).toEqual(['host_not_approved'])
  })

  it('crawler 的老做法（剥 www + startsWith）会放行的串，这里拒掉', () => {
    // https://example.com.evil.com 以 "https://example.com" 开头 —— 老判据判同源。
    const legacyWouldAccept = 'https://example.com.evil.com/pricing'
    expect(legacyWouldAccept.startsWith('https://example.com')).toBe(true)
    expect(canonical(legacyWouldAccept)).toBeNull()
  })
})

describe('scheme / 凭据 / 端口', () => {
  it('http 被拒（不替对方假设「反正会跳 https」）', () => {
    expect(reasons('http://example.com/a')).toEqual(['insecure_scheme'])
  })

  it.each(['ftp://example.com/a', 'mailto:hi@example.com', 'javascript:alert(1)'])(
    '非 http(s) 协议被拒：%s',
    (url) => {
      expect(reasons(url)).toEqual(['unsupported_scheme'])
    },
  )

  it('带用户名 / 密码被拒', () => {
    expect(reasons('https://user:pass@example.com/a')).toEqual(['credentials_present'])
    expect(reasons('https://user@example.com/a')).toEqual(['credentials_present'])
  })

  it('畸形 URL 被拒（相对路径也算 —— 台账只收绝对 URL）', () => {
    expect(reasons('not a url')).toEqual(['malformed_url'])
    expect(reasons('/about')).toEqual(['malformed_url'])
    expect(reasons('')).toEqual(['malformed_url'])
  })

  it('非默认端口被拒；:443 去掉并留痕', () => {
    expect(reasons('https://example.com:8443/a')).toEqual(['non_default_port'])
    const r = canonicaliseUrl('https://example.com:443/a', BOUNDARY)
    expect(r.ok && r.canonicalUrl).toBe('https://example.com/a')
    expect(r.notes).toContain('default_port_removed')
  })
})

describe('语法归一', () => {
  it('大小写：scheme 与主机小写，路径大小写**不动**（路径是区分大小写的）', () => {
    const r = canonicaliseUrl('HTTPS://Example.COM/About', BOUNDARY)
    expect(r.ok && r.canonicalUrl).toBe('https://example.com/About')
    expect(r.notes).toEqual(expect.arrayContaining(['scheme_lowercased', 'host_lowercased']))
  })

  it('片段去掉', () => {
    const r = canonicaliseUrl('https://example.com/a#team', BOUNDARY)
    expect(r.ok && r.canonicalUrl).toBe('https://example.com/a')
    expect(r.notes).toContain('fragment_removed')
  })

  it('尾斜杠去掉，但根路径保留 `/`', () => {
    expect(canonical('https://example.com/a/')).toBe('https://example.com/a')
    expect(canonical('https://example.com/')).toBe('https://example.com/')
    expect(canonical('https://example.com')).toBe('https://example.com/')
  })

  it('已知跟踪参数删掉，其余保留并排序 + 留 query_retained 标记', () => {
    const r = canonicaliseUrl('https://example.com/a?utm_source=fb&b=2&gclid=x&a=1', BOUNDARY)
    expect(r.ok && r.canonicalUrl).toBe('https://example.com/a?a=1&b=2')
    expect(r.notes).toEqual(expect.arrayContaining(['tracking_query_removed', 'query_retained']))
  })

  it('🔴 有意义的查询参数不许删 —— 删了会把两个真实页面合并成一条', () => {
    expect(canonical('https://example.com/l?id=1')).toBe('https://example.com/l?id=1')
    expect(canonical('https://example.com/l?id=2')).toBe('https://example.com/l?id=2')
  })

  it('🔴 百分号转义的大小写统一 —— /a%2Fb 与 /a%2fb 是同一个资源', () => {
    // 十六进制本身不区分大小写，但 WHATWG URL 会原样保留两种写法。
    // 不统一就会给同一个页面生成两个 canonical，撞车检测也看不见它们。
    expect(canonical('https://example.com/a%2fb')).toBe('https://example.com/a%2Fb')
    expect(canonical('https://example.com/a%2Fb')).toBe(canonical('https://example.com/a%2fb'))
  })

  it('参数顺序不同的同一页面收敛成同一个 canonical', () => {
    expect(canonical('https://example.com/a?b=2&a=1')).toBe(canonical('https://example.com/a?a=1&b=2'))
  })

  it('🔴 同名重复参数保持原始先后 —— 顺序可能就是页面身份的一部分', () => {
    // ?sort=price&sort=date 与 ?sort=date&sort=price 可能是两个不同的页面。
    // 按值排会把它们合并成一条、另一条被标撞车，复核的人从此没机会分别接受它们。
    const a = canonical('https://example.com/l?sort=price&sort=date')
    const b = canonical('https://example.com/l?sort=date&sort=price')
    expect(a).toBe('https://example.com/l?sort=price&sort=date')
    expect(b).toBe('https://example.com/l?sort=date&sort=price')
    expect(a).not.toBe(b)
  })

  it('不同 key 照样排序，同名之间仍保持原始先后', () => {
    expect(canonical('https://example.com/l?z=1&sort=price&sort=date&a=0')).toBe(
      'https://example.com/l?a=0&sort=price&sort=date&z=1',
    )
  })
})

describe('幂等性（canonical 再跑一次还是自己）', () => {
  it.each([
    'https://example.com',
    'https://example.com/',
    'https://EXAMPLE.com/A/',
    'https://example.com/a?b=2&a=1#x',
    'https://example.com:443/a/?utm_medium=x&z=9',
    'https://example.com/a%20b',
  ])('%s', (url) => {
    const once = canonical(url)
    expect(once).not.toBeNull()
    expect(canonical(once as string)).toBe(once)
    expect(deriveCanonicalUrl(once as string, BOUNDARY)).toBe(once)
  })

  it('推导：能推就给 canonical，推不出来给 null（不给「差不多」的串）', () => {
    expect(deriveCanonicalUrl('https://example.com/a/', BOUNDARY)).toBe('https://example.com/a')
    expect(deriveCanonicalUrl('https://example.com/a#x', BOUNDARY)).toBe('https://example.com/a')
    expect(deriveCanonicalUrl('http://example.com/a', BOUNDARY)).toBeNull()
    expect(deriveCanonicalUrl('https://www.example.com/a', BOUNDARY)).toBeNull()
  })

  it('🔴 推导认的是「这一条原始 URL 变出来的东西」，不是「这个串规不规范」', () => {
    // /hacked 自己完全规范，但它不是 /a 推出来的 —— 只验规范性拦不住换页面。
    expect(deriveCanonicalUrl('https://example.com/a', BOUNDARY)).not.toBe('https://example.com/hacked')
    expect(canonical('https://example.com/hacked')).toBe('https://example.com/hacked')
  })
})
