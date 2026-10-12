import { describe, expect, it, vi } from 'vitest'
import { buildFirstCommentMarker, composeFirstCommentBody, ensureFacebookFirstComment } from './first-comment'

const GRAPH = 'https://graph.facebook.com/v25.0'
const OBJECT_ID = 'video-1'
const MARKER = '⁣​‌'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('buildFirstCommentMarker', () => {
  it('同一 namespace+tag 永远得到同一个标记', () => {
    expect(buildFirstCommentMarker('daily-plan-first-comment', 'fbpost_a')).toBe(
      buildFirstCommentMarker('daily-plan-first-comment', 'fbpost_a'),
    )
  })

  it('不同 namespace → 不同标记', () => {
    expect(buildFirstCommentMarker('ns-a', 'tag')).not.toBe(buildFirstCommentMarker('ns-b', 'tag'))
  })

  it('不同 tag → 不同标记', () => {
    expect(buildFirstCommentMarker('ns', 'tag-a')).not.toBe(buildFirstCommentMarker('ns', 'tag-b'))
  })

  it('以 \\u2063 打头,其后每个字符都是 \\u200b 或 \\u200c,总长 1 + 32', () => {
    const marker = buildFirstCommentMarker('daily-plan-first-comment', 'fbpost_a')
    expect(marker[0]).toBe('\u2063')
    expect(marker.length).toBe(1 + 32)
    for (const ch of marker.slice(1)) {
      expect(ch === '\u200b' || ch === '\u200c').toBe(true)
    }
  })
})

describe('composeFirstCommentBody', () => {
  const WO = 'fa4fdd89-0000-4000-8000-000000000001'
  const message = 'Full itinerary: ' + 'https' + '://example.com/tour?utm_source=facebook&utm_content=' + WO

  it('正文以链接结尾时,链接里的 utm_content 仍是干净的工单编号', () => {
    const marker = buildFirstCommentMarker('reel-first-comment', 'wo-1')
    const body = composeFirstCommentBody(message, marker)
    const found = body.match(/https?:\/\/\S+/)?.[0]
    expect(found).toBeDefined()
    const utmContent = new URL(found as string).searchParams.get('utm_content')
    expect(utmContent).toBe(WO)
    expect(utmContent?.length).toBe(36)
  })

  it('标记仍在正文里(幂等扫描认得出)', () => {
    const marker = buildFirstCommentMarker('reel-first-comment', 'wo-1')
    const body = composeFirstCommentBody(message, marker)
    expect(body.includes(marker)).toBe(true)
    expect(body.endsWith(marker)).toBe(true)
  })

  it('旧写法会污染链接(回归对照)', () => {
    const marker = buildFirstCommentMarker('reel-first-comment', 'wo-1')
    const oldBody = `${message}${marker}`
    const found = oldBody.match(/https?:\/\/\S+/)?.[0]
    expect(found).toBeDefined()
    const utmContent = new URL(found as string).searchParams.get('utm_content')
    expect(utmContent).not.toBe(WO)
    expect(utmContent?.length).toBe(36 + 33)
  })
})

describe('ensureFacebookFirstComment', () => {
  it('第 1 页已有带标记的评论 → 返回其 id,只读一次,不发 POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: [{ id: 'comment-1', message: `Book now${MARKER}` }] }),
    )

    const id = await ensureFacebookFirstComment({
      graphBase: GRAPH,
      objectId: OBJECT_ID,
      accessToken: 'token',
      marker: MARKER,
      message: 'Book now',
      failureLabel: 'Reel',
      fetcher,
    })

    expect(id).toBe('comment-1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [, init] = fetcher.mock.calls[0]
    expect(init?.method).toBeUndefined()
  })

  it('第 1 页没有、第 2 页(经 paging.next)有 → 返回 id,不发 POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === 'https://graph.facebook.com/next-page') {
        return jsonResponse({ data: [{ id: 'comment-2', message: `CTA${MARKER}` }] })
      }
      return jsonResponse({ data: [{ id: 'comment-x', message: 'unrelated' }], paging: { next: 'https://graph.facebook.com/next-page' } })
    })

    const id = await ensureFacebookFirstComment({
      graphBase: GRAPH,
      objectId: OBJECT_ID,
      accessToken: 'token',
      marker: MARKER,
      message: 'CTA',
      failureLabel: 'Reel',
      fetcher,
    })

    expect(id).toBe('comment-2')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const postCalls = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('哪都没有标记、单页 → POST 一次,正文 = message + 换行 + marker,返回新建 id', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'comment-new' })
      return jsonResponse({ data: [] })
    })

    const id = await ensureFacebookFirstComment({
      graphBase: GRAPH,
      objectId: OBJECT_ID,
      accessToken: 'token',
      marker: MARKER,
      message: 'Book now',
      failureLabel: 'Reel',
      fetcher,
    })

    expect(id).toBe('comment-new')
    const postCall = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall).toBeDefined()
    const [url, init] = postCall as [string, RequestInit]
    expect(url).toBe(`${GRAPH}/${OBJECT_ID}/comments`)
    const body = new URLSearchParams(String(init.body))
    expect(body.get('message')).toBe(`Book now\n${MARKER}`)
  })

  it('读取非 ok → 抛「读取 Reel 首评失败 500」,绝不 POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'boom' }, 500))

    await expect(
      ensureFacebookFirstComment({
        graphBase: GRAPH,
        objectId: OBJECT_ID,
        accessToken: 'token',
        marker: MARKER,
        message: 'Book now',
        failureLabel: 'Reel',
        fetcher,
      }),
    ).rejects.toThrow('读取 Reel 首评失败 500')

    const postCalls = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('POST 非 ok → 抛以「发布 Reel 首评失败 400」开头的错误', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse({ error: 'bad' }, 400)
      return jsonResponse({ data: [] })
    })

    await expect(
      ensureFacebookFirstComment({
        graphBase: GRAPH,
        objectId: OBJECT_ID,
        accessToken: 'token',
        marker: MARKER,
        message: 'Book now',
        failureLabel: 'Reel',
        fetcher,
      }),
    ).rejects.toThrow(/^发布 Reel 首评失败 400/)
  })

  it('expectedPageId 不匹配 → 抛「首评目标不属于页面」,fetcher 一次都不调;匹配则放行', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ data: [{ id: 'comment-1', message: MARKER }] }))

    await expect(
      ensureFacebookFirstComment({
        graphBase: GRAPH,
        objectId: 'other-page_123',
        expectedPageId: 'page-1',
        accessToken: 'token',
        marker: MARKER,
        message: 'Book now',
        failureLabel: 'Reel',
        fetcher,
      }),
    ).rejects.toThrow('首评目标不属于页面')
    expect(fetcher).not.toHaveBeenCalled()

    const id = await ensureFacebookFirstComment({
      graphBase: GRAPH,
      objectId: 'page-1_123',
      expectedPageId: 'page-1',
      accessToken: 'token',
      marker: MARKER,
      message: 'Book now',
      failureLabel: 'Reel',
      fetcher,
    })
    expect(id).toBe('comment-1')
  })

  it('旧首评(标记紧贴正文、没有换行)仍被幂等扫描认出,不重复发', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: [{ id: 'comment-old', message: `Book now${MARKER}` }] }),
    )

    const id = await ensureFacebookFirstComment({
      graphBase: GRAPH,
      objectId: OBJECT_ID,
      accessToken: 'token',
      marker: MARKER,
      message: 'Book now',
      failureLabel: 'Reel',
      fetcher,
    })

    expect(id).toBe('comment-old')
    const postCalls = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('maxPages 生效:每页都有 paging.next、maxPages 2 → 恰好读 2 次,扫不完就抛错且绝不 POST', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'comment-new' })
      return jsonResponse({ data: [], paging: { next: 'https://graph.facebook.com/next-page' } })
    })

    await expect(
      ensureFacebookFirstComment({
        graphBase: GRAPH,
        objectId: OBJECT_ID,
        accessToken: 'token',
        marker: MARKER,
        message: 'Book now',
        failureLabel: 'Reel',
        fetcher,
        maxPages: 2,
      }),
    ).rejects.toThrow('首评幂等扫描未完成')

    const readCalls = fetcher.mock.calls.filter(([, init]) => init?.method !== 'POST')
    expect(readCalls).toHaveLength(2)
    const postCalls = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })
})
