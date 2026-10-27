import { describe, expect, it } from 'vitest'
import {
  collectFactClaims,
  decideAssetDualReview,
  quoteOnPage,
  UNREADABLE,
  UNVERIFIED,
  withDualReview,
} from './asset-dual-review'
import { htmlToText, readOfficialPage } from './asset-dual-review-page'
import { poolAfterPass } from './asset-dual-review-pool'
import type { RemotionMusicClearance } from './remotion-music-options.mjs'

const PASS_MUSIC: RemotionMusicClearance = {
  verdict: 'pass',
  reason: '配乐已核无人声',
  track_id: 'track-1',
  clean_until_sec: 30,
}

const CLAIM = {
  text: 'Walk the waterfront',
  sourceUrl: 'https://example.com/tours',
  sourceQuote: 'Walk the waterfront at dawn',
}

function input(patch: Partial<Parameters<typeof decideAssetDualReview>[0]> = {}) {
  return {
    assetOnly: true,
    maliangStatus: 'pass',
    machineReviewed: true,
    maliangReasons: [],
    claims: [CLAIM],
    officialHosts: ['example.com'],
    pages: { [CLAIM.sourceUrl]: '<p>Walk the waterfront at dawn</p>' },
    music: PASS_MUSIC,
    ...patch,
  }
}

describe('asset dual review decision', () => {
  it('passes only when all three checks pass on a material-only order', () => {
    const decision = decideAssetDualReview(input())
    expect(decision.applicable).toBe(true)
    expect(decision.passed).toBe(true)
  })

  it('does not pass a normal deliverable even when every check is green', () => {
    const decision = decideAssetDualReview(input({ assetOnly: false }))
    expect(decision.applicable).toBe(false)
    expect(decision.passed).toBe(false)
  })

  it('treats a missing or unfinished picture check as unreadable', () => {
    expect(decideAssetDualReview(input({ maliangStatus: null })).maliang).toMatchObject({ verdict: 'unreadable', reason: UNREADABLE })
    expect(decideAssetDualReview(input({ maliangStatus: 'unverifiable' })).passed).toBe(false)
    expect(decideAssetDualReview(input({ machineReviewed: false })).passed).toBe(false)
  })

  it('keeps a picture failure and does not pass', () => {
    const decision = decideAssetDualReview(input({ maliangStatus: 'fail', maliangReasons: ['第 2 镜文字：错字'] }))
    expect(decision.passed).toBe(false)
    expect(decision.maliang.reason).toContain('错字')
  })

  it('fails closed when the official page, the quote, or the site cannot be read', () => {
    expect(decideAssetDualReview(input({ officialHosts: null })).sudongpo.reason).toBe(UNREADABLE)
    expect(decideAssetDualReview(input({ claims: [] })).passed).toBe(false)
    expect(decideAssetDualReview(input({ pages: {} })).sudongpo.reason).toBe(UNREADABLE)
    expect(decideAssetDualReview(input({ pages: { [CLAIM.sourceUrl]: 'a different sentence' } })).sudongpo.reason).toBe('官网原文对不上')
  })

  it('rejects a source that is not on the official site', () => {
    const decision = decideAssetDualReview(input({
      claims: [{ ...CLAIM, sourceUrl: 'https://other.example/tours' }],
      pages: { 'https://other.example/tours': CLAIM.sourceQuote },
    }))
    expect(decision.sudongpo.reason).toBe('出处不是这个客户的官网')
    expect(decision.passed).toBe(false)
  })

  it('does not pass when the music check fails', () => {
    const decision = decideAssetDualReview(input({
      music: { verdict: 'fail', reason: '配乐没有人声核验', track_id: 'track-1', clean_until_sec: null },
    }))
    expect(decision.passed).toBe(false)
  })

  it('does not pass when an on-screen line has no source', () => {
    const page = 'Walk beside the old waterfront in Shanghai. Shanghai waterfront. Follow the lake into the hills. Hangzhou lake.'
    const one = 'https://example.com/one'
    const two = 'https://example.com/two'
    const brief = {
      remotion: {
        template: 'postcard',
        props: {
          hook: { lines: ['99 day tour'] },
          scenes: [
            { place: 'Shanghai', line: 'Walk beside the old waterfront.', sourceUrl: one, sourceQuote: 'Walk beside the old waterfront in Shanghai.', placeSourceQuote: 'Shanghai waterfront.' },
            { place: 'Hangzhou', line: 'Follow the lake into the hills.', sourceUrl: two, sourceQuote: 'Follow the lake into the hills.', placeSourceQuote: 'Hangzhou lake.' },
          ],
          price: { fromLabel: 'FROM', currencyPrefix: '$', amount: 4999, qualifier: 'PER PERSON', footnote: 'EXAMPLE' },
          end: { title: 'Explore China' },
        },
      },
    }
    const claims = collectFactClaims(brief)
    expect(claims.find((claim) => claim.text === '99 day tour')).toMatchObject({ sourceUrl: '', sourceQuote: '' })
    expect(claims.some((claim) => claim.text.includes('4999') && claim.sourceUrl === '')).toBe(true)
    expect(claims.find((claim) => claim.text === 'Explore China')).toMatchObject({ sourceUrl: '', sourceQuote: '' })
    const decision = decideAssetDualReview(input({
      claims,
      pages: { [one]: page, [two]: page },
    }))
    expect(decision.sudongpo).toMatchObject({ verdict: 'unreadable', reason: UNVERIFIED })
    expect(decision.passed).toBe(false)
  })

  it('does not treat a partial word match as support when the number changes', () => {
    const decision = decideAssetDualReview(input({
      claims: [{
        text: 'Walk 999 days.',
        sourceUrl: CLAIM.sourceUrl,
        sourceQuote: 'Walk beside the old waterfront in Shanghai.',
      }],
      pages: { [CLAIM.sourceUrl]: 'Walk beside the old waterfront in Shanghai.' },
    }))
    expect(decision.sudongpo).toMatchObject({ verdict: 'unreadable', reason: UNVERIFIED })
    expect(decision.passed).toBe(false)
  })

  it('passes a line whose words and numbers all sit inside the official quote', () => {
    const decision = decideAssetDualReview(input({
      claims: [{
        text: '3 day tour',
        sourceUrl: CLAIM.sourceUrl,
        sourceQuote: 'Join this 3 day tour of the harbour.',
      }],
      pages: { [CLAIM.sourceUrl]: 'Join this 3 day tour of the harbour.' },
    }))
    expect(decision.sudongpo.verdict).toBe('pass')
    expect(decision.passed).toBe(true)
  })

  it('collects line and place quotes from the brief', () => {
    const claims = collectFactClaims({
      remotion: {
        props: {
          scenes: [{
            place: 'Harbour',
            line: 'Walk the waterfront',
            sourceUrl: CLAIM.sourceUrl,
            sourceQuote: CLAIM.sourceQuote,
            placeSourceQuote: 'Harbour walk',
          }],
        },
      },
    })
    expect(claims).toEqual([
      { text: 'Walk the waterfront', sourceUrl: CLAIM.sourceUrl, sourceQuote: CLAIM.sourceQuote },
      { text: 'Harbour', sourceUrl: CLAIM.sourceUrl, sourceQuote: 'Harbour walk' },
    ])
  })

  it('matches a quote after tags and extra spaces are removed', () => {
    expect(quoteOnPage('Walk the waterfront at dawn', htmlToText('<p>Walk   the waterfront at dawn</p>'))).toBe(true)
  })

  it('records the three verdicts without dropping earlier review fields', () => {
    const decision = decideAssetDualReview(input())
    const ref = withDualReview({ kept: true }, decision, '2026-10-27T00:00:00.000Z', 'entered')
    expect(ref.kept).toBe(true)
    expect(ref.asset_accepted_by).toBe('ai-dual-review')
    expect(ref.dual_review).toMatchObject({ passed: true, pool: 'entered', music: { track_id: 'track-1' } })
  })
})

const allowHost = async () => true

describe('official page read', () => {
  it('does not fetch a page that is not on the official site', async () => {
    const fetcher = (() => {
      throw new Error('should not fetch')
    }) as unknown as typeof fetch
    await expect(readOfficialPage('https://other.example/tours', ['example.com'], fetcher, allowHost)).resolves.toBeNull()
  })

  it('returns the page text from the official site', async () => {
    const fetcher = (async () => new Response('<p>Walk the waterfront at dawn</p>', { status: 200 })) as unknown as typeof fetch
    await expect(readOfficialPage('https://example.com/tours', ['example.com'], fetcher, allowHost)).resolves.toBe('Walk the waterfront at dawn')
  })

  it('does not fetch when the host guard refuses', async () => {
    const fetcher = (() => {
      throw new Error('should not fetch')
    }) as unknown as typeof fetch
    await expect(readOfficialPage('https://example.com/tours', ['example.com'], fetcher, async () => false)).resolves.toBeNull()
  })

  it('stops when a redirect leaves the official site', async () => {
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: 'https://other.example/away' } })) as unknown as typeof fetch
    await expect(readOfficialPage('https://example.com/tours', ['example.com'], fetcher, allowHost)).resolves.toBeNull()
  })
})

describe('pool entry', () => {
  it('adds an approved work-order entry and keeps an existing promo window', () => {
    const next = poolAfterPass([
      { kind: 'work_order', ref: 'wo-1', status: 'candidate', promo_window: { kind: 'evergreen' } },
      { kind: 'meta_video', ref: 'video-1', status: 'approved' },
    ], 'wo-1', '2026-10-27T00:00:00.000Z')
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.pool[0]).toMatchObject({ kind: 'meta_video', ref: 'video-1', status: 'approved' })
    expect(next.pool[1]).toMatchObject({
      kind: 'work_order',
      ref: 'wo-1',
      status: 'approved',
      approved_by: 'ai-dual-review',
      promo_window: { kind: 'evergreen' },
    })
  })

  it('does not replace a rejected entry or a different kind', () => {
    expect(poolAfterPass([{ kind: 'work_order', ref: 'wo-1', status: 'rejected' }], 'wo-1', 't').ok).toBe(false)
    expect(poolAfterPass([{ kind: 'meta_video', ref: 'wo-1', status: 'candidate' }], 'wo-1', 't').ok).toBe(false)
  })

  it('stores the uploaded video id on the approval and leaves an approved row unchanged', () => {
    const approved = poolAfterPass([], 'wo-1', '2026-10-27T00:00:00.000Z', '555')
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.pool[0]).toMatchObject({
      kind: 'work_order', status: 'approved', approved_by: 'ai-dual-review', alias_refs: ['555'],
    })
    const again = poolAfterPass(approved.pool, 'wo-1', 'later', '777')
    expect(again).toEqual({ ok: true, pool: approved.pool })
  })

  it('does not take a video id that already belongs to another row', () => {
    const blocked = poolAfterPass([{ kind: 'meta_video', ref: '555', status: 'candidate' }], 'wo-1', 't', '555')
    expect(blocked.ok).toBe(false)
  })
})
