import { describe, it, expect } from 'vitest'
import {
  ownsHost,
  bareHost,
  findDomainMismatches,
  findSharedIdentifiers,
  auditCrossClientLeaks,
} from '../cross-client-audit'

const NAMES: Record<string, string> = { cts: 'CTS Tours NZ', oz: 'oztop', roman: 'Roman HU', kit: '30 Kiteroa' }
const DOMAINS: Record<string, string | null> = {
  cts: 'ctstours.co.nz',
  oz: 'oztopbuildingsupplies.com.au',
  roman: null,
  kit: null,
}
const nameOf = (id: string) => NAMES[id] ?? id
const domainOf = (id: string) => DOMAINS[id] ?? null

describe('bareHost / ownsHost', () => {
  it('剥掉协议、www、路径、端口、sc-domain 前缀', () => {
    expect(bareHost('https://WWW.Ctstours.co.nz/blog?x=1')).toBe('ctstours.co.nz')
    expect(bareHost('sc-domain:ctstours.co.nz')).toBe('ctstours.co.nz')
    expect(bareHost('http://ctstours.co.nz:8080')).toBe('ctstours.co.nz')
  })

  it('🔴 真实那条：CTS 名下存着 Oztop 的网站 → 不属于', () => {
    expect(ownsHost('https://oztopbuildingsupplies.com.au', 'ctstours.co.nz')).toBe(false)
  })

  it('子域名算自己家', () => {
    expect(ownsHost('https://shop.oztopbuildingsupplies.com.au', 'oztopbuildingsupplies.com.au')).toBe(true)
  })

  it('🔴 前缀像但不是同一个域，不许放过', () => {
    expect(ownsHost('https://ctstours.co.nz.evil.com', 'ctstours.co.nz')).toBe(false)
    expect(ownsHost('https://xctstours.co.nz', 'ctstours.co.nz')).toBe(false)
  })

  it('判断不了返回 null，不当成有问题', () => {
    expect(ownsHost(null, 'ctstours.co.nz')).toBeNull()
    expect(ownsHost('https://x.com', null)).toBeNull()
  })
})

describe('findDomainMismatches', () => {
  it('🔴 抓出 CTS 那条，并说清是谁的网站', () => {
    const f = findDomainMismatches(
      '发布通道',
      [
        { client_id: 'cts', value: 'https://oztopbuildingsupplies.com.au' },
        { client_id: 'oz', value: 'https://oztopbuildingsupplies.com.au' },
      ],
      domainOf,
      nameOf,
    )
    expect(f).toHaveLength(1)
    expect(f[0].clients).toEqual(['CTS Tours NZ'])
    expect(f[0].severity).toBe('critical')
    expect(f[0].what).toContain('不是该客户自己的网站')
  })

  it('没填域名的客户判断不了 → 不报（不能因为资料不全就天天喊狼来了）', () => {
    const f = findDomainMismatches('x', [{ client_id: 'roman', value: 'https://anything.com' }], domainOf, nameOf)
    expect(f).toEqual([])
  })

  it('同一条重复出现只报一次', () => {
    const rows = Array.from({ length: 5 }, () => ({ client_id: 'cts', value: 'https://oztopbuildingsupplies.com.au' }))
    expect(findDomainMismatches('x', rows, domainOf, nameOf)).toHaveLength(1)
  })
})

describe('findSharedIdentifiers', () => {
  it('🔴 同一个账号挂两家 → 报出来，并把两家都点名', () => {
    const f = findSharedIdentifiers(
      '广告账户',
      [
        { client_id: 'roman', value: 'act_1018365291238494' },
        { client_id: 'kit', value: 'act_1018365291238494' },
      ],
      nameOf,
    )
    expect(f).toHaveLength(1)
    expect(f[0].clients.sort()).toEqual(['30 Kiteroa', 'Roman HU'])
  })

  it('只挂一家的不报', () => {
    expect(findSharedIdentifiers('x', [{ client_id: 'cts', value: 'act_1' }], nameOf)).toEqual([])
  })

  it('🔴 我们自己的登录账号要排除 —— 一个人管几家的站长工具是正常的', () => {
    const rows = [
      { client_id: 'cts', value: 'bigbigraydeng@gmail.com' },
      { client_id: 'oz', value: 'bigbigraydeng@gmail.com' },
    ]
    expect(findSharedIdentifiers('x', rows, nameOf, { ignore: ['bigbigraydeng@gmail.com'] })).toEqual([])
    // 不排除时才报 —— 证明排除是真的在起作用，不是恰好没数据
    expect(findSharedIdentifiers('x', rows, nameOf)).toHaveLength(1)
  })

  it('大小写不同也算同一个账号', () => {
    const f = findSharedIdentifiers(
      'x',
      [{ client_id: 'cts', value: 'A@B.com' }, { client_id: 'oz', value: 'a@b.com' }],
      nameOf,
      { ignore: ['a@b.com'] },
    )
    expect(f).toEqual([])
  })
})

// 假 supabase 按表建模，认不出的表直接抛
function fakeSupabase(t: Record<string, { data?: unknown[]; error?: string }>) {
  return {
    from(table: string) {
      if (!(table in t)) throw new Error(`fake supabase: table '${table}' is not modelled`)
      const cfg = t[table]
      return {
        select: () =>
          Promise.resolve(
            cfg.error ? { data: null, error: { message: cfg.error } } : { data: cfg.data ?? [], error: null },
          ),
      }
    },
  } as never
}

const CLIENTS = [
  { id: 'cts', name: 'CTS Tours NZ', domain: 'ctstours.co.nz' },
  { id: 'oz', name: 'oztop', domain: 'oztopbuildingsupplies.com.au' },
]

describe('auditCrossClientLeaks', () => {
  it('🔴 假件护栏：没建模的表直接炸', () => {
    expect(() => (fakeSupabase({}) as unknown as { from: (t: string) => unknown }).from('clients')).toThrow(
      /not modelled/,
    )
  })

  it('🔴 把生产上真实那条查出来', async () => {
    const findings = await auditCrossClientLeaks(
      fakeSupabase({
        clients: { data: CLIENTS },
        cms_connections: {
          data: [
            { client_id: 'cts', site_url: 'https://oztopbuildingsupplies.com.au' },
            { client_id: 'oz', site_url: 'https://oztopbuildingsupplies.com.au' },
          ],
        },
        platform_oauth_connections: { data: [] },
        meta_ads_snapshots: { data: [] },
      }),
    )
    const critical = findings.filter((f) => f.severity === 'critical')
    expect(critical.length).toBeGreaterThanOrEqual(1)
    expect(critical.some((f) => f.what.includes('CTS Tours NZ'))).toBe(true)
  })

  it('🔴 任何一张表查不出来都要抛 ——「查不到」不能当成「没问题」', async () => {
    await expect(
      auditCrossClientLeaks(
        fakeSupabase({
          clients: { data: CLIENTS },
          cms_connections: { error: 'db down' },
          platform_oauth_connections: { data: [] },
          meta_ads_snapshots: { data: [] },
        }),
      ),
    ).rejects.toThrow(/db down/)
  })

  it('干净的库返回空 —— 没问题就该安静', async () => {
    const findings = await auditCrossClientLeaks(
      fakeSupabase({
        clients: { data: CLIENTS },
        cms_connections: { data: [{ client_id: 'oz', site_url: 'https://oztopbuildingsupplies.com.au' }] },
        platform_oauth_connections: { data: [] },
        meta_ads_snapshots: { data: [] },
      }),
    )
    expect(findings).toEqual([])
  })

  it('共用广告账户报成 warning，不当泄露拦 —— 楼盘模式下是设计如此', async () => {
    const findings = await auditCrossClientLeaks(
      fakeSupabase({
        clients: { data: [...CLIENTS, { id: 'roman', name: 'Roman HU', domain: null }, { id: 'kit', name: '30 Kiteroa', domain: null }] },
        cms_connections: { data: [] },
        platform_oauth_connections: { data: [] },
        meta_ads_snapshots: {
          data: [
            { client_id: 'roman', ad_account_id: 'act_1018365291238494' },
            { client_id: 'kit', ad_account_id: 'act_1018365291238494' },
          ],
        },
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].what).toContain('算进两个客户的成本')
  })
})
