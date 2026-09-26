// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PostPublishWatchStartedSchema, PostPublishCheckDueSchema,
  buildCheckEvents, checkEventId, classifyReceipt, emptyMetrics,
  parsePageProbe, receiptRunId,
} from '../post-publish-monitor'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const launchedAt = '2026-09-17T00:00:00+12:00'
const watch = () => PostPublishWatchStartedSchema.parse({
  client_id: CLIENT,
  origin_url: 'https://www.ctstours.co.nz/',
  launched_at: launchedAt,
  no_publish: true,
  pages: [
    { url: 'https://www.ctstours.co.nz/guide', role: 'guide_hub' },
    { url: 'https://www.ctstours.co.nz/tailor-made/', role: 'conversion' },
  ],
})

describe('post-publish watch contract', () => {
  it('keeps the CTS bootstrap manifest inside the shared event contract', () => {
    const manifest = JSON.parse(readFileSync(resolve('config/clients/cts/post-publish-watch.json'), 'utf8'))
    const parsed = PostPublishWatchStartedSchema.parse(manifest)
    expect(parsed.pages).toHaveLength(14)
    expect(parsed.pages.every((page) => new URL(page.url).hostname === 'www.ctstours.co.nz')).toBe(true)
  })

  it('fans every page into independent T+72h and T+7d events', () => {
    const events = buildCheckEvents(watch())
    expect(events).toHaveLength(4)
    expect(events.map((event) => [event.data.page.url, event.data.checkpoint_hours])).toEqual([
      ['https://www.ctstours.co.nz/guide', 72],
      ['https://www.ctstours.co.nz/guide', 168],
      ['https://www.ctstours.co.nz/tailor-made', 72],
      ['https://www.ctstours.co.nz/tailor-made', 168],
    ])
    expect(new Set(events.map((event) => event.id)).size).toBe(4)
    for (const event of events) expect(PostPublishCheckDueSchema.safeParse(event.data).success).toBe(true)
  })

  it('keeps event and receipt identities stable across replay', () => {
    const due = buildCheckEvents(watch())[0].data
    expect(checkEventId(due)).toBe(checkEventId({ ...due }))
    expect(receiptRunId(due)).toBe(receiptRunId({ ...due }))
    expect(receiptRunId(due)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('rejects a cross-host page and a forged checkpoint time', () => {
    const crossHost = {
      ...watch(), pages: [{ url: 'https://example.com/guide', role: 'guide' }],
    }
    expect(PostPublishWatchStartedSchema.safeParse(crossHost).success).toBe(false)
    const due = buildCheckEvents(watch())[0].data
    expect(PostPublishCheckDueSchema.safeParse({ ...due, target_at: due.launched_at }).success).toBe(false)
  })
})

describe('page health and evidence classification', () => {
  const due = () => buildCheckEvents(watch())[0].data

  it('reads canonical and robots without depending on attribute order', () => {
    const probe = parsePageProbe({
      requestedUrl: 'https://www.ctstours.co.nz/guide', status: 200,
      finalUrl: 'https://www.ctstours.co.nz/guide',
      html: `<html><head><link href="/guide/" rel="canonical"><meta content="index, follow" name="robots"></head></html>`,
    })
    expect(probe).toMatchObject({ indexable: true, canonical_matches: true, canonical_url: 'https://www.ctstours.co.nz/guide/' })
  })

  it('marks noindex or canonical mismatch as technical attention', () => {
    const probe = parsePageProbe({
      requestedUrl: 'https://www.ctstours.co.nz/guide', status: 200,
      finalUrl: 'https://www.ctstours.co.nz/guide',
      html: `<link rel="canonical" href="/other"><meta name="robots" content="noindex,nofollow">`,
    })
    const receipt = classifyReceipt({ due: due(), observedAt: '2026-09-20T01:00:00Z', probe, metrics: emptyMetrics() })
    expect(receipt.status).toBe('needs_attention')
    expect(receipt.recommendation).toBe('fix_technical')
    expect(receipt.caveats).toEqual(expect.arrayContaining(['page_not_indexable', 'canonical_mismatch']))
  })

  it('honours X-Robots-Tag and treats a missing canonical as a technical issue', () => {
    const probe = parsePageProbe({
      requestedUrl: 'https://www.ctstours.co.nz/guide', status: 200,
      finalUrl: 'https://www.ctstours.co.nz/guide', html: '<html></html>', xRobotsTag: 'noindex',
    })
    const receipt = classifyReceipt({ due: due(), observedAt: '2026-09-20T01:00:00Z', probe, metrics: emptyMetrics() })
    expect(probe).toMatchObject({ indexable: false, canonical_matches: false, final_url_matches: true })
    expect(receipt.status).toBe('needs_attention')
  })

  it('does not invent a negative result when snapshots do not contain the page', () => {
    const probe = parsePageProbe({
      requestedUrl: 'https://www.ctstours.co.nz/guide', status: 200,
      finalUrl: 'https://www.ctstours.co.nz/guide',
      html: `<link rel="canonical" href="https://www.ctstours.co.nz/guide">`,
    })
    const receipt = classifyReceipt({ due: due(), observedAt: '2026-09-20T01:00:00Z', probe, metrics: emptyMetrics() })
    expect(receipt.status).toBe('insufficient_data')
    expect(receipt.recommendation).toBe('wait_for_data')
  })

  it('returns healthy only with a valid page and post-launch page evidence', () => {
    const probe = parsePageProbe({
      requestedUrl: 'https://www.ctstours.co.nz/guide', status: 200,
      finalUrl: 'https://www.ctstours.co.nz/guide',
      html: `<link rel="canonical" href="https://www.ctstours.co.nz/guide">`,
    })
    const metrics = emptyMetrics()
    metrics.ga4 = { synced_at: '2026-09-19T00:00:00Z', sessions: 12, pageviews: 20 }
    const receipt = classifyReceipt({ due: due(), observedAt: '2026-09-20T01:00:00Z', probe, metrics })
    expect(receipt.status).toBe('healthy')
    expect(receipt.recommendation).toBe('hold')
    expect(receipt.no_publish).toBe(true)
  })
})
