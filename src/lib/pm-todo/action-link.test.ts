import { describe, it, expect, vi } from 'vitest'
import {
  isLoginRequiredHost,
  verifyActionLink,
  gscPropertyUrl,
  gscInspectSteps,
} from './action-link'

describe('isLoginRequiredHost', () => {
  it('谷歌与 Meta 后台一律算登录类', () => {
    for (const u of [
      'https://search.google.com/search-console?resource_id=x',
      'https://business.google.com/locations',
      'https://adsmanager.facebook.com/adsmanager',
      'https://www.facebook.com/page/insights',
    ]) {
      expect(isLoginRequiredHost(u), u).toBe(true)
    }
  })

  it('客户自己的网站是公开的，能实测', () => {
    expect(isLoginRequiredHost('https://www.ctstours.co.nz/blog/x')).toBe(false)
    expect(isLoginRequiredHost('https://github.com/org/repo/pull/1')).toBe(false)
  })

  it('不是合法网址就当公开处理，交给实测去发现问题', () => {
    expect(isLoginRequiredHost('随便一段文字')).toBe(false)
  })
})

describe('verifyActionLink', () => {
  it('🔴 登录类站点直接判「验不了」，**不去 curl**', async () => {
    // 实测过:GSC 的正确链接与错误链接对机器都返回 200(登录页外壳),
    // 404 是登录后前端画的。拿这个 200 当「验过了」比不验更危险。
    const spy = vi.fn()
    const v = await verifyActionLink('https://search.google.com/search-console/inspect?x=1', spy as never)
    expect(v.kind).toBe('unverifiable')
    expect(spy).not.toHaveBeenCalled()
  })

  it('公开网址通了就是 ok', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    expect((await verifyActionLink('https://example.com/a', f as never)).kind).toBe('ok')
  })

  it('公开网址 404 判 broken —— 这种绝不能下发', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const v = await verifyActionLink('https://example.com/gone', f as never)
    expect(v).toEqual({ kind: 'broken', status: 404 })
  })

  it('HEAD 不被接受时退一次 GET —— 有些站只认 GET', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    expect((await verifyActionLink('https://example.com/a', f as never)).kind).toBe('ok')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('网络异常判 broken，不当成通过', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    expect((await verifyActionLink('https://nope.invalid/a', f as never)))
      .toEqual({ kind: 'broken', status: null })
  })

  it(
    '🔴 2026-09-15 排查 /dashboard/today 卡死顺手补的隐患: 每次 fetch(HEAD 和退化的 GET)都必须带 ' +
    'AbortSignal 超时——否则一个响应慢/卡住的公开网址会让 dropBrokenLinks 的 Promise.all 永远不 ' +
    'resolve，整个今日待办接口跟着挂起且不报错，一直到平台自己的请求超时（如果有）才会结束',
    async () => {
      const f = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 405 }) // 逼出退化 GET 那一次调用
        .mockResolvedValueOnce({ ok: true, status: 200 })
      await verifyActionLink('https://example.com/a', f as never)
      expect(f).toHaveBeenCalledTimes(2)
      for (const call of f.mock.calls) {
        const [, options] = call
        expect(options?.signal).toBeInstanceOf(AbortSignal)
      }
    },
  )

  it('一个真的挂起不返回、直到被 abort 才拒绝的 fetch 最终会被判成 broken，不会让调用方无限期挂着', async () => {
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        // 不真的等 8 秒——直接模拟"信号已经 abort"这一刻的行为，验证的是
        // "abort 之后 fetch 会 reject、verifyActionLink 会把它接住判 broken"
        // 这条因果链，不是在测 AbortSignal.timeout 本身准不准时。
        if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'TimeoutError')))
        queueMicrotask(() => signal?.dispatchEvent(new Event('abort')))
      })
    const result = await verifyActionLink('https://slow.example.com/a', hangingFetch)
    expect(result).toEqual({ kind: 'broken', status: null })
  })
})

describe('GSC 入口与步骤', () => {
  it('给的是属性首页，不是会 404 的深链', () => {
    const u = gscPropertyUrl('sc-domain:ctstours.co.nz')
    expect(u).toContain('search.google.com/search-console?')
    expect(u).not.toContain('/inspect')
  })

  it('🔴 步骤文字必须自带网址 —— 链接万一没落到位，照着字也做得成', () => {
    const steps = gscInspectSteps('https://www.ctstours.co.nz/blog/x')
    expect(steps).toContain('https://www.ctstours.co.nz/blog/x')
    expect(steps).toContain('粘贴')
  })
})
