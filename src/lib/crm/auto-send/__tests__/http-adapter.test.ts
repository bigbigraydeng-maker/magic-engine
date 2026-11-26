import { describe, expect, it, vi } from 'vitest'
import { loadErrorText } from '../adapter'
import { createHttpAdapter, type FetchLike } from '../http-adapter'

const LIST_BODY = {
  generatedAt: '2026-11-10T09:00:00+13:00',
  nextBatch: null,
  depositLetters: [],
  scheduledLetters: [],
  pastLetters: [],
  tourGroups: [],
  totalDistinctLetters: 0,
  cadence: { firstMonth: 6 },
}

const DETAIL_BODY = {
  letter: {
    letterKey: 'plan:2026-12-02:t-1:2027-03-11:3',
    sendDate: '2026-12-02',
    audience: { tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: 3 },
    subject: null,
    status: 'draft',
    channel: 'me',
    counts: { recipients: 1, sent: null, blocked: null, failed: null, rehearsal: 0, opened: null },
    previewText: null,
    bodyText: null,
    sampleFirstName: 'Alex',
  },
  tiles: { recipients: 1, sent: null, blocked: null, failed: null, rehearsal: 0, opened: null },
  mailchimpSummary: null,
  recipients: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createHttpAdapter', () => {
  it('reads the list from the clients auto-letters path and maps it', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(LIST_BODY))
    const overview = await createHttpAdapter('client-1', fetchImpl).loadOverview()
    expect(fetchImpl).toHaveBeenCalledWith('/api/clients/client-1/crm/auto-letters')
    expect(overview).toEqual({ nextBatch: null, sections: [], groups: [] })
  })

  it('a list from a server that does not know history, groups or the rhythm yet is an error, never a half-empty page', async () => {
    const { pastLetters: _past, ...withoutPast } = LIST_BODY
    const { tourGroups: _groups, ...withoutGroups } = LIST_BODY
    const { cadence: _cadence, ...withoutCadence } = LIST_BODY
    void _past
    void _groups
    void _cadence
    for (const body of [withoutPast, withoutGroups, withoutCadence, { ...LIST_BODY, cadence: 'six' }]) {
      await expect(createHttpAdapter('c', async () => json(body)).loadOverview()).rejects.toThrow('读到的内容格式不对')
    }
  })

  it('no rhythm (cadence null) is a normal list', async () => {
    const overview = await createHttpAdapter('c', async () => json({ ...LIST_BODY, cadence: null })).loadOverview()
    expect(overview.groups).toEqual([])
  })

  it('a list without the rhythm number (an older server) or with a nonsense one is an error, never a half-empty page', async () => {
    const { cadence: _cadence, ...withoutCadence } = LIST_BODY
    void _cadence
    for (const body of [withoutCadence, { ...LIST_BODY, cadence: 'six' }]) {
      await expect(createHttpAdapter('c', async () => json(body)).loadOverview()).rejects.toThrow('读到的内容格式不对')
    }
  })

  it('reads one letter with the key URL-encoded (it contains colons)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(DETAIL_BODY))
    const detail = await createHttpAdapter('client-1', fetchImpl).loadLetterDetail('plan:2026-12-02:t-1:2027-03-11:3')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/clients/client-1/crm/auto-letters/plan%3A2026-12-02%3At-1%3A2027-03-11%3A3',
    )
    expect(detail.summary.status).toBe('planned')
    expect(detail.content).toBeNull()
  })

  it('only ever issues GET-style reads: the adapter exposes no write method', () => {
    const adapter = createHttpAdapter('c', vi.fn<FetchLike>())
    expect(Object.keys(adapter).sort()).toEqual(['loadLetterDetail', 'loadOverview'])
  })

  it('401 / 403 say the account has no access', async () => {
    for (const status of [401, 403]) {
      const adapter = createHttpAdapter('c', async () => json({ error: 'forbidden' }, status))
      await expect(adapter.loadOverview()).rejects.toThrow('你的账号没有查看这一页的权限。')
    }
  })

  it('404 says the letter was not found', async () => {
    const adapter = createHttpAdapter('c', async () => json({ error: 'nope' }, 404))
    await expect(adapter.loadLetterDetail('x')).rejects.toThrow('没有找到这封信')
  })

  it('a Chinese error from the server is shown as it is; an English one never is', async () => {
    const chinese = createHttpAdapter('c', async () => json({ error: '暂时读不到订单，请稍后再试' }, 503))
    await expect(chinese.loadOverview()).rejects.toThrow('暂时读不到订单，请稍后再试')

    const english = createHttpAdapter('c', async () => json({ error: 'Internal Server Error' }, 500))
    await expect(english.loadOverview()).rejects.toThrow('暂时读不到，请稍后再试。')

    const notJson = createHttpAdapter('c', async () => new Response('<html>oops</html>', { status: 502 }))
    await expect(notJson.loadOverview()).rejects.toThrow('暂时读不到，请稍后再试。')
  })

  it('a reply with the wrong shape is an error, never an empty list', async () => {
    const adapter = createHttpAdapter('c', async () => json({ hello: 'world' }))
    await expect(adapter.loadOverview()).rejects.toThrow('读到的内容格式不对')
    await expect(adapter.loadLetterDetail('x')).rejects.toThrow('读到的内容格式不对')
  })

  it('a network failure is passed on and shows as 网络出错', async () => {
    const adapter = createHttpAdapter('c', async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await adapter.loadOverview().catch((e: unknown) => e)
    expect(loadErrorText(err)).toBe('网络出错')
  })
})
