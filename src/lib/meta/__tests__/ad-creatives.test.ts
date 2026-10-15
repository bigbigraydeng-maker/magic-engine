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
  it('把嵌在 creative 里的素材编号、主页、视频摊平出来，并原样留一份 raw', async () => {
    const creative = { id: '900', object_story_spec: { page_id: '161', video_data: { video_id: '206' } } }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: '777', account_id: '1234567890', effective_status: 'ACTIVE', issues_info: [], creative,
    })))
    await expect(getAdCreativeBinding('777', 't')).resolves.toEqual({
      id: '777', account_id: '1234567890', effective_status: 'ACTIVE', issues_info: [],
      creative_id: '900', page_id: '161', video_id: '206', creative_raw: creative,
    })
  })

  it('Meta 没给 issues_info 时记成 null，不当成「零个审核问题」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: '777', account_id: '1234567890' })))
    const out = await getAdCreativeBinding('777', 't')
    expect(out?.issues_info).toBeNull()
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
  it('翻页收集，取出视频编号与主页，并标明清单取全了', async () => {
    const row1 = { id: '1', name: 'a', status: 'ACTIVE', object_story_spec: { page_id: '161', video_data: { video_id: '206' } } }
    const row2 = { id: '2', name: 'b', status: 'ACTIVE', object_story_spec: { page_id: '161' } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [row1], paging: { next: 'https://graph.facebook.com/next-page' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [row2] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAccountAdCreatives('act_1234567890', 't')).resolves.toEqual({
      complete: true,
      truncated_reason: null,
      creatives: [
        { id: '1', name: 'a', video_id: '206', page_id: '161', status: 'ACTIVE', raw: row1 },
        { id: '2', name: 'b', video_id: null, page_id: '161', status: 'ACTIVE', raw: row2 },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('编号不是纯数字的行直接丢掉，不让它流到按编号排序的下游', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: [{ id: 'abc', object_story_spec: { page_id: '161' } }, { id: '7', object_story_spec: { page_id: '161' } }],
    })))
    const out = await listAccountAdCreatives('act_1', 't')
    expect(out?.creatives.map(c => c.id)).toEqual(['7'])
  })

  it('账户编号带不带 act_ 前缀都拼成同一个路径', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await listAccountAdCreatives('1234567890', 't')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/act_1234567890/adcreatives')
  })

  it('第一页就读失败返回 null；读成功但没有素材是「取全了的空清单」（两者不能混）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(listAccountAdCreatives('act_1', 't')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))
    await expect(listAccountAdCreatives('act_1', 't')).resolves.toEqual({
      creatives: [], complete: true, truncated_reason: null,
    })
  })

  it('翻到后面某页失败时，返回已收到的部分并标明不全、写清原因', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '1', object_story_spec: { page_id: '161', video_data: { video_id: '206' } } }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    const out = await listAccountAdCreatives('act_1', 't')
    expect(out?.creatives).toHaveLength(1)
    expect(out?.complete).toBe(false)
    expect(out?.truncated_reason).toContain('HTTP 500')
  })

  it('对方一直给 next 时最多翻 10 页就停，并标明不全', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [{ id: '9', object_story_spec: { page_id: '161' } }],
      paging: { next: 'https://graph.facebook.com/loop' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await listAccountAdCreatives('act_1', 't')
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(out?.complete).toBe(false)
    expect(out?.truncated_reason).toContain('上限')
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
