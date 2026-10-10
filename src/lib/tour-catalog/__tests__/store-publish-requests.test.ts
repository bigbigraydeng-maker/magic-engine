import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store-access', () => ({ markPublishRequestsHandled: vi.fn() }))

import { markPublishRequestsHandled } from '../store-access'
import { buildPublishPreview, publishDraft } from '../store-publish'
import {
  CLIENT_ID,
  TODAY,
  asDb,
  departureRow,
  makeFakeDb,
  stateRow,
  tourRow,
  validReq,
} from './store-publish.fixtures'

const markHandled = vi.mocked(markPublishRequestsHandled)

function firstPublishDb() {
  return makeFakeDb({ state: stateRow(1, 0), tours: [tourRow()], departures: [departureRow()], published: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  markHandled.mockResolvedValue(undefined)
})

describe('publishDraft closes open "please publish" requests (design §6.10.1 item 4)', () => {
  it('marks the client\'s open requests handled with the new version after a successful publish', async () => {
    const db = firstPublishDb()
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)

    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)

    expect(result).toEqual({ ok: true, version: 99 })
    expect(markHandled).toHaveBeenCalledTimes(1)
    expect(markHandled).toHaveBeenCalledWith(asDb(db), CLIENT_ID, 99)
  })

  it('closes requests only after the publish itself went through', async () => {
    const order: string[] = []
    const db = firstPublishDb()
    db.rpc.mockImplementation((fn: string) => {
      order.push(`rpc:${fn}`)
      return { data: { version: 7 }, error: null }
    })
    markHandled.mockImplementation(async () => {
      order.push('close')
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)

    await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)

    expect(order).toEqual(['rpc:tour_catalog_publish', 'close'])
    expect(markHandled).toHaveBeenCalledWith(asDb(db), CLIENT_ID, 7)
  })

  it('a failure to close the requests is logged and does not change the publish result', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    markHandled.mockRejectedValue(new Error('relation does not exist'))
    const db = firstPublishDb()
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)

    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)

    expect(result).toEqual({ ok: true, version: 99 })
    expect(spy).toHaveBeenCalledWith('tour_catalog_publish_request_close_failed', 'relation does not exist')
    spy.mockRestore()
  })

  it('does not close anything when the publish is refused before the database call', async () => {
    const db = firstPublishDb()
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)

    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview, { diffHash: 'stale' }), 'pm@x', TODAY)

    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(markHandled).not.toHaveBeenCalled()
  })

  it('does not close anything when the database refuses the publish', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = firstPublishDb()
    db.rpc.mockImplementation(() => ({ data: null, error: { message: 'conflict:stale' } }))
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)

    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)

    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(markHandled).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
