import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManualItem } from '../manual-item-types'
import {
  buildPublishRequestItem,
  formatRequestTime,
  pushTourCatalogPublishRequestItems,
  tourCatalogHref,
} from '../tour-catalog-publish-request-items'

vi.mock('@/lib/tour-catalog/publish-request-feed', () => ({
  listOpenPublishRequests: vi.fn(),
}))

import { listOpenPublishRequests } from '@/lib/tour-catalog/publish-request-feed'

const feed = vi.mocked(listOpenPublishRequests)

afterEach(() => {
  vi.restoreAllMocks()
  feed.mockReset()
})

function request(over: Partial<Parameters<typeof buildPublishRequestItem>[0]> = {}) {
  return {
    id: 'r1',
    clientId: 'c1',
    requestedBy: 'staff@cts.example',
    note: ' 改了 3 个团的价格 ',
    createdAt: '2026-10-10T01:05:00Z',
    ...over,
  }
}

describe('formatRequestTime', () => {
  it('formats an ISO timestamp in Pacific/Auckland', () => {
    expect(formatRequestTime('2026-10-10T01:05:00Z')).toBe('10月10日 14:05')
  })

  it('returns empty string for an unparseable timestamp', () => {
    expect(formatRequestTime('not a date')).toBe('')
  })
})

describe('tourCatalogHref', () => {
  it('builds the catalog entry page', () => {
    expect(tourCatalogHref('abc')).toBe(
      'https://app.magicengine.com.au/dashboard/clients/abc/tour-catalog',
    )
  })
})

describe('buildPublishRequestItem', () => {
  it('builds the exact item for one request', () => {
    const item = buildPublishRequestItem(request(), 'CTS Tours')
    expect(item).toEqual({
      kind: 'tour_publish_requested',
      client_id: 'c1',
      client_name: 'CTS Tours',
      what:
        'CTS Tours 的员工 staff@cts.example 请你把团目录的修改上架（10月10日 14:05）：改了 3 个团的价格。' +
        '不上架，这些修改不会对外生效。',
      how: '打开团目录，点［查看并上架］核对后上架。',
      href: 'https://app.magicengine.com.au/dashboard/clients/c1/tour-catalog',
    })
  })

  it('always fills what, how and href with the impact sentence', () => {
    const item = buildPublishRequestItem(request(), 'CTS Tours')
    expect(item.what.length).toBeGreaterThan(0)
    expect(item.how.length).toBeGreaterThan(0)
    expect(item.href.length).toBeGreaterThan(0)
    expect(item.what).toContain('不上架，这些修改不会对外生效')
  })

  it('uses a placeholder for an empty note', () => {
    const item = buildPublishRequestItem(request({ note: '   ' }), 'CTS Tours')
    expect(item.what).toContain('（没有写备注）')
  })

  it('cuts a long note to 200 characters', () => {
    const item = buildPublishRequestItem(request({ note: 'x'.repeat(500) }), 'CTS Tours')
    expect(item.what.includes('x'.repeat(200))).toBe(true)
    expect(item.what.includes('x'.repeat(201))).toBe(false)
  })

  it('uses a placeholder for an unparseable timestamp', () => {
    const item = buildPublishRequestItem(request({ createdAt: 'not a date' }), 'CTS Tours')
    expect(item.what).toContain('时间未知')
  })
})

describe('pushTourCatalogPublishRequestItems', () => {
  it('pushes one item per request', async () => {
    feed.mockResolvedValue([request()])
    const items: ManualItem[] = []
    await pushTourCatalogPublishRequestItems({} as never, items, () => 'CTS Tours')
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tour_publish_requested')
  })

  it('keeps only the newest request per client, ordered by createdAt', async () => {
    feed.mockResolvedValue([
      request({ id: 'old', clientId: 'c1', createdAt: '2026-10-01T00:00:00Z', note: 'old' }),
      request({ id: 'new', clientId: 'c1', createdAt: '2026-10-05T00:00:00Z', note: 'new' }),
      request({ id: 'c2r', clientId: 'c2', createdAt: '2026-10-03T00:00:00Z', note: 'c2' }),
    ])
    const items: ManualItem[] = []
    await pushTourCatalogPublishRequestItems({} as never, items, (id) => `name-${id}`)
    expect(items).toHaveLength(2)
    expect(items[0].client_id).toBe('c2')
    expect(items[1].client_id).toBe('c1')
    expect(items[1].what).toContain('new')
  })

  it('warns and does not throw when the read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    feed.mockRejectedValue(new Error('relation does not exist'))
    const existing: ManualItem = {
      kind: 'tour_publish_requested',
      client_id: 'keep',
      client_name: 'Keep',
      what: 'w',
      how: 'h',
      href: 'x',
    }
    const items: ManualItem[] = [existing]
    await expect(
      pushTourCatalogPublishRequestItems({} as never, items, () => 'CTS Tours'),
    ).resolves.toBeUndefined()
    expect(items).toEqual([existing])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('pushes nothing and warns nothing for an empty list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    feed.mockResolvedValue([])
    const items: ManualItem[] = []
    await pushTourCatalogPublishRequestItems({} as never, items, () => 'CTS Tours')
    expect(items).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('boundary guard', () => {
  it('never writes the forbidden underscore table prefix', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/pm-todo/tour-catalog-publish-request-items.ts'),
      'utf8',
    )
    expect(source.includes(['tour', 'catalog', ''].join('_'))).toBe(false)
  })
})
