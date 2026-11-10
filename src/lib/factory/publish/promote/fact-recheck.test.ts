import { describe, expect, it } from 'vitest'
import type { SocialFactSource } from '@/lib/social/weekly-loop/fact-aliases'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import {
  recheckReelFacts,
  type FactSourceLoader,
} from './fact-recheck'

const TOUR: PublishedTourFact = {
  id: 't1',
  slug: 'grand-tour',
  name: 'China Signature — China Panorama',
  destination: 'china',
  tier: 'signature',
  title: null,
  durationText: '27 Days',
  displayPriceText: 'NZD $9,999',
  highlights: [],
  inclusions: [],
  exclusions: [],
  singleSupplement: null,
  soldOut: false,
  managesDepartures: true,
  isActive: true,
  departures: [],
}

const OK_SOURCE: SocialFactSource = {
  ok: true,
  tours: [TOUR],
  aliasesByTourId: {},
  catalogVersion: 7,
}

const ENDCARD_URL =
  'https://www.ctstours.co.nz/tours/china/signature/grand-tour'

function briefWith(caption: string): unknown {
  return {
    copy: {
      caption,
      endcard: { url: ENDCARD_URL },
    },
  }
}

function outputWith(caption: string | null): unknown {
  return caption === null ? {} : { caption }
}

function loaderReturning(source: SocialFactSource): FactSourceLoader {
  return async () => source
}

const NOW = new Date('2026-11-04T12:00:00Z')

const ORDER = {
  id: 'order-1',
  client_id: 'client-1',
  brief: briefWith('27 days'),
  output: outputWith('27 DAYS'),
}

describe('recheckReelFacts', () => {
  it('blocks with 503 when the loader throws', async () => {
    const loadFactSource: FactSourceLoader = async () => {
      throw new Error('boom')
    }
    const res = await recheckReelFacts({
      loadFactSource,
      order: ORDER,
      now: NOW,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(503)
    expect(res.error).toContain('读不到团目录')
  })

  it('passes through as not_applicable when the client has no published catalog', async () => {
    const res = await recheckReelFacts({
      loadFactSource: loaderReturning({
        ok: false,
        reason: 'catalog_not_published',
      }),
      order: ORDER,
      now: NOW,
    })
    expect(res.ok).toBe(true)
    expect(res.summary.verdict).toBe('not_applicable')
    expect(res.summary.catalog_version).toBeNull()
  })

  it('blocks with 503 when the catalog load fails', async () => {
    const res = await recheckReelFacts({
      loadFactSource: loaderReturning({ ok: false, reason: 'load_failed' }),
      order: ORDER,
      now: NOW,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(503)
    expect(res.error).toContain('读不到团目录')
  })

  it('passes a reel whose caption matches the catalog', async () => {
    const res = await recheckReelFacts({
      loadFactSource: loaderReturning(OK_SOURCE),
      order: ORDER,
      now: NOW,
    })
    expect(res.ok).toBe(true)
    expect(res.summary.verdict).toBe('pass')
    expect(res.summary.catalog_version).toBe(7)
  })

  it('fails with 422 when the caption duration is wrong', async () => {
    const res = await recheckReelFacts({
      loadFactSource: loaderReturning(OK_SOURCE),
      order: {
        ...ORDER,
        brief: briefWith('16 days'),
        output: outputWith('16 DAYS'),
      },
      now: NOW,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(422)
    expect(res.error).toContain('天数')
    expect(res.error.endsWith('后重新预览')).toBe(true)
    expect(res.error).not.toContain('(')
  })

  it('notes a missing overlay, and clears the note for first_comment only', async () => {
    const noOverlay = await recheckReelFacts({
      loadFactSource: loaderReturning(OK_SOURCE),
      order: { ...ORDER, output: outputWith(null) },
      now: NOW,
    })
    expect(noOverlay.summary.note).toBe('画面字幕没有文本，未核')

    const commentOnly = await recheckReelFacts({
      loadFactSource: loaderReturning(OK_SOURCE),
      order: { ...ORDER, output: outputWith(null) },
      now: NOW,
      only: 'first_comment',
    })
    expect(commentOnly.summary.note).toBeNull()
  })

  it('passes the NZ calendar date to the loader', async () => {
    let seenToday: string | null = null
    const loadFactSource: FactSourceLoader = async (_clientId, today) => {
      seenToday = today
      return OK_SOURCE
    }
    await recheckReelFacts({
      loadFactSource,
      order: ORDER,
      now: new Date('2026-11-04T12:00:00Z'),
    })
    expect(seenToday).toBe('2026-11-05')
  })

  it('blocks with 409 when the facts need a person (general link plus a number claim)', async () => {
    const res = await recheckReelFacts({
      loadFactSource: loaderReturning(OK_SOURCE),
      order: { ...ORDER, brief: { copy: { caption: '10 days of wonders', endcard: { url: 'https://www.ctstours.co.nz/tours/china' } } }, output: {} },
      now: NOW,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(409)
      expect(res.summary.verdict).toBe('needs_human')
      expect(res.error).toContain('要人核对')
    }
  })
})
