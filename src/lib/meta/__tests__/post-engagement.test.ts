/**
 * Meta 读取的三条纪律。
 *
 * 这个文件只守能造成真实错报的事：把「问不到」说成 0、把通用参数错说成「帖子被删」、
 * 把 shares 缺席当成零次分享。每一条错了，效果报告都会对客户说谎。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  classifyGraphError,
  fetchPostEngagement,
  readShareCount,
  readSummaryCount,
} from '../post-engagement'

const POST = '1616575215312482_1750182150247306'
const TOKEN = 'page-token'

describe('classifyGraphError', () => {
  it('令牌坏 / 权限不足 是永久的 —— 重试没有意义', () => {
    expect(classifyGraphError({ code: 190, message: 'expired' })).toMatchObject({
      kind: 'permanent',
      reason: 'token_invalid',
    })
    expect(classifyGraphError({ code: 200, message: 'no perm' })).toMatchObject({
      kind: 'permanent',
      reason: 'permission_denied',
    })
  })

  it('🔴 code=100 只有 subcode 33 / message 明说才算帖子没了', () => {
    expect(classifyGraphError({ code: 100, error_subcode: 33, message: 'x' })).toMatchObject({
      kind: 'permanent',
      reason: 'object_gone',
    })
    expect(classifyGraphError({ code: 100, message: 'Object does not exist' })).toMatchObject({
      kind: 'permanent',
      reason: 'object_gone',
    })
  })

  it('🔴 光有 code=100 不许谎称帖子被删 —— 归临时，别下永久结论', () => {
    const r = classifyGraphError({ code: 100, message: 'Tried accessing nonexisting field' })
    expect(r.kind).toBe('transient')
    expect(r.reason).not.toBe('object_gone')
  })

  it('未知错误码归临时 —— 多重试几次便宜，永久跳过一条本可测的帖子贵', () => {
    const r = classifyGraphError({ code: 99999, message: '???' })
    expect(r.kind).toBe('transient')
    expect(r.reason).toBe('graph_unknown')
  })
})

describe('字段读取：数字 / 读不到 / 缺席 三者严格分开', () => {
  it('summary.total_count 是数字才算数字', () => {
    expect(readSummaryCount({ summary: { total_count: 12 } })).toEqual({ kind: 'value', value: 12 })
    expect(readSummaryCount({ summary: { total_count: 0 } })).toEqual({ kind: 'value', value: 0 })
  })

  it('🔴 有对象但读不出 total_count → absent，绝不当 0', () => {
    expect(readSummaryCount({ summary: {} }).kind).toBe('absent')
    expect(readSummaryCount({}).kind).toBe('absent')
    expect(readSummaryCount(undefined).kind).toBe('absent')
  })

  it('🔴 shares 整个字段缺席 → omitted_unverified，不是 0 也不是 absent', () => {
    // Meta 似乎对没被分享的帖子省略这个字段，但我们没有实测证据。
    // 在拿到证据前，宁可少一个数字，也不要编一个 0。
    expect(readShareCount(undefined)).toEqual({ kind: 'omitted_unverified' })
    expect(readShareCount(null)).toEqual({ kind: 'omitted_unverified' })
  })

  it('shares 有 count 才算数字；有对象没 count 是 absent', () => {
    expect(readShareCount({ count: 3 })).toEqual({ kind: 'value', value: 3 })
    expect(readShareCount({}).kind).toBe('absent')
  })
})

function res(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as never
}

describe('fetchPostEngagement', () => {
  it('完整成功 → 三个字段都是数字', async () => {
    const r = await fetchPostEngagement(
      POST,
      TOKEN,
      res({
        reactions: { summary: { total_count: 10 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 1 },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.read.reactions).toEqual({ kind: 'value', value: 10 })
      expect(r.read.shares).toEqual({ kind: 'value', value: 1 })
    }
  })

  it('🔴 只读，不写 —— 请求必须是 GET（不带 method/body）', async () => {
    const f = res({ reactions: { summary: { total_count: 1 } } })
    await fetchPostEngagement(POST, TOKEN, f)
    const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[1]).toBeUndefined() // 没有 init → 没有 method、没有 body
    expect(String(call[0])).toContain('graph.facebook.com')
  })

  it('Graph 顶层错误按分类返回，不当成读到了', async () => {
    const r = await fetchPostEngagement(POST, TOKEN, res({ error: { code: 190, message: 'bad' } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toMatchObject({ kind: 'permanent', reason: 'token_invalid' })
  })

  it('🔴 HTTP 200 但不是 JSON（代理错误页）→ 临时，不猜', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    }) as never
    const r = await fetchPostEngagement(POST, TOKEN, f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('transient')
  })

  it('网络整个抛异常 → 临时', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as never
    const r = await fetchPostEngagement(POST, TOKEN, f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('transient')
  })
})
