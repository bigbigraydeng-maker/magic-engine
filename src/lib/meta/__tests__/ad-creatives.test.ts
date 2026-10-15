import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdCreativeBinding, listAccountAdCreatives, setAdCreative } from '../ad-creatives'

/** 用真的 Response 构造回包，不做类型强转——被测代码读的就是 ok/status/json/text 这几样。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getAdCreativeBinding', () => {
  it('把嵌在 creative 里的素材编号和发布主页摊平出来', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: '777', account_id: '1234567890', effective_status: 'ACTIVE',
      creative: { id: '900', object_story_spec: { page_id: '161' } },
    })))
    await expect(getAdCreativeBinding('777', 't')).resolves.toEqual({
      id: '777', account_id: '1234567890', effective_status: 'ACTIVE', creative_id: '900', page_id: '161',
    })
  })

  it('Meta 没给 creative 时，素材编号与主页都是 null，不编一个出来', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: '777', account_id: '1234567890' })))
    const out = await getAdCreativeBinding('777', 't')
    expect(out).toMatchObject({ creative_id: null, page_id: null })
  })

  it('HTTP 不是 2xx 时返回 null（读不到，交给调用方按可重试处理）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'boom' } }, 400)))
    await expect(getAdCreativeBinding('777', 't')).resolves.toBeNull()
  })

  it('fetch 直接抛错时返回 null，不把异常漏出去', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    await expect(getAdCreativeBinding('777', 't')).resolves.toBeNull()
  })
})

describe('listAccountAdCreatives', () => {
  it('翻页收集，并把视频编号与主页从 object_story_spec 里取出来', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '1', name: 'a', object_story_spec: { page_id: '161', video_data: { video_id: '206' } } }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '2', name: 'b', object_story_spec: { page_id: '161' } }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAccountAdCreatives('act_1234567890', 't')).resolves.toEqual([
      { id: '1', name: 'a', video_id: '206', page_id: '161' },
      { id: '2', name: 'b', video_id: null, page_id: '161' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('账户编号带不带 act_ 前缀都拼成同一个路径', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await listAccountAdCreatives('1234567890', 't')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/act_1234567890/adcreatives')
  })

  it('第一页就读失败返回 null；读成功但没有素材返回空数组（两者不能混）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(listAccountAdCreatives('act_1', 't')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))
    await expect(listAccountAdCreatives('act_1', 't')).resolves.toEqual([])
  })

  it('翻到后面某页失败时，返回已经收到的部分而不是整批丢掉', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '1', object_story_spec: { page_id: '161', video_data: { video_id: '206' } } }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    const out = await listAccountAdCreatives('act_1', 't')
    expect(out).toHaveLength(1)
  })

  it('对方一直给 next 时最多翻 10 页就停，不会无限翻下去', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [{ id: 'x', object_story_spec: { page_id: '161' } }],
      paging: { next: 'https://graph.facebook.com/loop' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await listAccountAdCreatives('act_1', 't')
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })
})

describe('setAdCreative', () => {
  it('只有 Meta 明说 success 才算成功，并按 creative_id 的形状提交', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(setAdCreative('777', 't', '900')).resolves.toBe(true)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(decodeURIComponent(String(init?.body ?? ''))).toContain('creative={"creative_id":"900"}')
  })

  it('返回 200 但没有 success 时算失败，不当成改成了', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(setAdCreative('777', 't', '900')).resolves.toBe(false)
  })

  it('HTTP 失败或 fetch 抛错都算失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: {} }, 400)))
    await expect(setAdCreative('777', 't', '900')).resolves.toBe(false)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    await expect(setAdCreative('777', 't', '900')).resolves.toBe(false)
  })
})
