/**
 * AD-SEC-3 绑定三道闸里的纯函数 + Graph 核实。
 * 路由级的端到端行为见 app/api/clients/[id]/meta-ad-account/route.test.ts。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseAdAccountInput, canonicalAccountDigits, registeredValueMatches, verifyAdAccountAccessible } from '../ad-account-binding'

afterEach(() => vi.unstubAllGlobals())

describe('parseAdAccountInput', () => {
  it.each([
    ['act_2775766642787274', 'act_2775766642787274'],
    ['ACT_2775766642787274', 'act_2775766642787274'],
    ['  2775766642787274 ', 'act_2775766642787274'],
  ])('%j → %j', (raw, expected) => {
    expect(parseAdAccountInput(raw)).toBe(expected)
  })

  it.each([null, undefined, '', '   '])('%j → null（清空）', raw => {
    expect(parseAdAccountInput(raw)).toBeNull()
  })

  it.each(['act_0', 'act_123', 'act_02775766642787274', '02775766642787274', 'act_１２３４５６７８９０', `act_${'9'.repeat(26)}`, 'act_27757666 42787274'])(
    '%j → 抛错',
    raw => {
      expect(() => parseAdAccountInput(raw)).toThrow()
    },
  )

  it('非字符串 → 抛错', () => {
    expect(() => parseAdAccountInput(123)).toThrow()
  })
})

describe('canonicalAccountDigits — 比对规范形', () => {
  it('大小写 / act_ 前缀 / 空白 / 前导零都归一', () => {
    const forms = ['act_2222222222', 'ACT_2222222222', ' act_ 2222222222 ', '2222222222', '002222222222', 'act_002222222222']
    expect(new Set(forms.map(canonicalAccountDigits))).toEqual(new Set(['2222222222']))
  })
})

describe('registeredValueMatches — 登记表里手工填的脏值也要认得出（重复检查不许 fail-open）', () => {
  it.each([
    'act_2222222222', 'ACT_2222222222', ' act_2222222222 ', '2222222222', '002222222222',
    'act_2222\u200B222222', '\uFEFFact_2222222222', 'act_２２２２２２２２２２', 'act-2222222222',
    'act 2222222222', 'act__2222222222', 'act_1111111111,act_2222222222', 'act_2222222222\u00A0',
  ])('%j → 命中', stored => {
    expect(registeredValueMatches(stored, '2222222222')).toBe(true)
  })

  it.each(['act_22222222229', 'act_1111111111', '', 'act_'])('%j → 不命中', stored => {
    expect(registeredValueMatches(stored, '2222222222')).toBe(false)
  })
})

function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: string | URL) => handler(new URL(String(input))))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('verifyAdAccountAccessible', () => {
  it('必需字段读到 + business 读到 → ok，id 用 Meta 返回的规范形', async () => {
    stubFetch(url =>
      url.searchParams.get('fields')?.startsWith('business')
        ? Response.json({ business: { id: 'b1', name: 'Biz' } })
        : Response.json({ id: 'act_2222222222', account_id: '2222222222', name: 'Acc', account_status: 1 }),
    )
    const r = await verifyAdAccountAccessible('act_2222222222', 'tok')
    expect(r).toEqual({
      ok: true,
      account: { id: 'act_2222222222', name: 'Acc', account_status: 1, business_id: 'b1', business_name: 'Biz' },
    })
  })

  it('business 读不到（个人账户 / 缺权限）→ 仍然 ok，只是商户为空', async () => {
    stubFetch(url =>
      url.searchParams.get('fields')?.startsWith('business')
        ? new Response('{}', { status: 403 })
        : Response.json({ account_id: '2222222222', name: 'Acc' }),
    )
    const r = await verifyAdAccountAccessible('act_2222222222', 'tok')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.account.business_name).toBeNull()
  })

  it('HTTP 4xx → not_accessible', async () => {
    stubFetch(() => new Response('{}', { status: 400 }))
    expect(await verifyAdAccountAccessible('act_2222222222', 'tok')).toMatchObject({ ok: false, kind: 'not_accessible' })
  })

  it('HTTP 5xx / 网络错误 → graph_unavailable', async () => {
    stubFetch(() => new Response('{}', { status: 503 }))
    expect(await verifyAdAccountAccessible('act_2222222222', 'tok')).toMatchObject({ ok: false, kind: 'graph_unavailable' })
    stubFetch(() => { throw new Error('ECONNRESET') })
    expect(await verifyAdAccountAccessible('act_2222222222', 'tok')).toMatchObject({ ok: false, kind: 'graph_unavailable' })
  })

  it('Meta 返回的账户号跟请求不一致 / 没返回账户号 → id_mismatch', async () => {
    stubFetch(() => Response.json({ account_id: '9999999999' }))
    expect(await verifyAdAccountAccessible('act_2222222222', 'tok')).toMatchObject({ ok: false, kind: 'id_mismatch' })
    stubFetch(() => Response.json({ name: 'no id' }))
    expect(await verifyAdAccountAccessible('act_2222222222', 'tok')).toMatchObject({ ok: false, kind: 'id_mismatch' })
  })
})
