import { describe, expect, it } from 'vitest'

import type { OverviewReel } from '../build'
import {
  countReelWorks,
  describeReelTag,
  describeReelTemplate,
  describeVarietyAdvice,
  groupReelWorks,
  groupWorksByStage,
  parseTicket,
} from '../reel-works'

function reel(overrides: Partial<OverviewReel> & { id: string; angle: string }): OverviewReel {
  return {
    status: 'in_review',
    created_at: '2026-10-20T00:00:00Z',
    published_at: null,
    permalink: null,
    video_state: null,
    music_file: null,
    template: 'postcard',
    ...overrides,
  }
}

describe('groupReelWorks: folding revisions of one piece', () => {
  it('folds revisions into one work, newest first, with a short title, batch and note', () => {
    const works = groupReelWorks([
      reel({ id: 'a3', created_at: '2026-10-22T00:00:00Z', angle: 'Harbour Tour postcard (Spring launch batch1 #4): hook on the bridge; end card (r2: scene replaced (card covered the bridge in a1)) (r3: clip swapped)' }),
      reel({ id: 'a1', created_at: '2026-10-21T00:00:00Z', angle: 'Harbour Tour postcard (Spring launch batch1 #4): hook on the bridge; end card' }),
      reel({ id: 'b1', angle: 'Coast Walk postcard (Spring launch batch1 #2): hook on the cliffs' }),
    ])
    expect(works).toHaveLength(2)
    expect(works[0]).toMatchObject({ title: 'Harbour Tour #4', batchLabel: '第 1 批', campaignNote: 'Spring launch batch1', templateLabel: '明信片款' })
    expect(works[0].versions.map((v) => v.reel.id)).toEqual(['a3', 'a1'])
    expect(works[0].latest.reel.id).toBe('a3')
    expect(works[1].title).toBe('Coast Walk #2')
  })

  it('takes version marks (v1, v1g, r2, v5-story-r3) out of the name', () => {
    const works = groupReelWorks([
      reel({ id: 'g', angle: 'Alpine Story postcard v1g (May remake): same as v1f except music' }),
      reel({ id: 'f', angle: 'Alpine Story postcard v1 (May remake): hook; end card (v1f: preview, temporary music)' }),
      reel({ id: 'e', angle: 'Alpine Story postcard v1 (May remake): hook; end card (v1e: preview only)' }),
      reel({ id: 'x', angle: 'Detail Clip r2: new ending' }),
      reel({ id: 'y', angle: 'Detail Clip r1: first cut' }),
      reel({ id: 'z', angle: 'Night Market ad v5-story-r3: postcard (no price)' }),
    ])
    expect(works.map((w) => [w.title, w.versions.length])).toEqual([
      ['Alpine Story', 3],
      ['Detail Clip', 2],
      ['Night Market ad', 1],
    ])
  })

  it('reads "#n" from the name itself and folds "City Break #2 postcard v2" with "City Break #2 postcard"', () => {
    const works = groupReelWorks([
      reel({ id: 'n2', angle: 'City Break #2 postcard v2: hook trimmed (re-run: first try failed) (re-run 2)' }),
      reel({ id: 'n1', angle: 'City Break #2 postcard: ten days, no price on screen' }),
    ])
    expect(works).toHaveLength(1)
    expect(works[0].title).toBe('City Break #2')
    expect(works[0].versions).toHaveLength(2)
  })

  it('does not fold anything it is not sure about', () => {
    const works = groupReelWorks([
      reel({ id: '1', angle: 'Harbour Tour postcard (Spring batch1 #4): a' }),
      reel({ id: '2', angle: 'Harbour Tour postcard (Spring batch1 #5): a' }),
      reel({ id: '3', template: 'list', angle: 'Harbour Tour postcard (Spring batch1 #4): a' }),
      reel({ id: '4', angle: 'Harbour Tour postcard (Autumn batch1 #4): a' }),
      reel({ id: '5', angle: 'Lake Paid A: price suspense' }),
      reel({ id: '6', angle: 'Lake Paid A2: price suspense, revised' }),
    ])
    expect(works).toHaveLength(6)
  })

  it('tells two different works with the same title apart by their version mark', () => {
    const works = groupReelWorks([
      reel({ id: 'n4', template: 'list', angle: 'Alpha v4: price-led list' }),
      reel({ id: 'n1', template: 'postcard', angle: 'Alpha v1 (remake): hook' }),
    ])
    expect(works.map((w) => w.title)).toEqual(['Alpha v4', 'Alpha v1'])
  })

  it('drops the template word that the template chip already says', () => {
    expect(groupReelWorks([reel({ id: 'a', angle: 'Dusk Walk postcard v2: two shots' })])[0].title).toBe('Dusk Walk')
    expect(groupReelWorks([reel({ id: 'a', template: 'list', angle: 'Best Of v3: price-led list reel (From NZ$1,000)' })])[0].title).toBe('Best Of')
  })
})

describe('parseTicket / odd tickets never break the page', () => {
  it('empty, Chinese, full-width colon, very long and unbalanced tickets', () => {
    expect(groupReelWorks([reel({ id: 'a', angle: '' })])[0].title).toBe('（没有写主题）')
    expect(groupReelWorks([reel({ id: 'a', angle: '' }), reel({ id: 'b', angle: '' })])).toHaveLength(2)
    expect(groupReelWorks([reel({ id: 'a', angle: '上海价格', template: null })])[0].title).toBe('上海价格')
    expect(groupReelWorks([reel({ id: 'a', angle: '上海行程：第一版', template: null })])[0].title).toBe('上海行程')
    const long = groupReelWorks([reel({ id: 'a', angle: 'word '.repeat(60) })])[0].title
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long.endsWith('…')).toBe(true)
    expect(() => parseTicket('Name (oops: never closed', 'postcard')).not.toThrow()
    expect(parseTicket('Name (oops: never closed', 'postcard').name).toContain('Name')
  })

  it('keeps the batch and note only when the ticket says them', () => {
    const plain = groupReelWorks([reel({ id: 'a', angle: 'Quiet Cove: one shot' })])[0]
    expect(plain.batchLabel).toBeNull()
    expect(plain.campaignNote).toBeNull()
    expect(describeReelTemplate('postcard')).toBe('明信片款')
    expect(describeReelTemplate('list')).toBe('价格款')
    expect(describeReelTemplate('atmosphere')).toBe('氛围款')
    expect(describeReelTemplate('some_internal_code')).toBeNull()
    expect(describeReelTemplate(null)).toBeNull()
  })
})

describe('describeReelTag', () => {
  const tag = (status: string, extra: Partial<OverviewReel> = {}) => describeReelTag({ status, published_at: null, video_state: null, ...extra })

  it('one small tag per state, same words everywhere', () => {
    expect(tag('in_review')).toMatchObject({ kind: 'review', label: '待审核' })
    expect(tag('approved')).toMatchObject({ kind: 'approved', label: '已通过' })
    expect(tag('publishing')).toMatchObject({ kind: 'approved', label: '发布中' })
    expect(tag('review_rejected')).toMatchObject({ kind: 'problem', label: '已打回' })
    expect(tag('publish_failed')).toMatchObject({ kind: 'problem', label: '发布失败' })
    expect(tag('failed')).toMatchObject({ kind: 'problem', label: '出问题' })
    expect(tag('dead_letter')).toMatchObject({ kind: 'problem', label: '出问题' })
    for (const status of ['queued', 'claimed', 'producing']) expect(tag(status)).toMatchObject({ kind: 'making', label: '制作中' })
    for (const status of ['rendered', 'archived', 'superseded']) expect(tag(status).kind).toBe('closed')
    expect(tag('something_new')).toMatchObject({ kind: 'making', label: '状态未知' })
  })

  it('an uploaded Reel says draft / public, and never claims more than the record knows', () => {
    expect(tag('published', { published_at: '2026-10-21T00:00:00Z', video_state: 'DRAFT' })).toMatchObject({ kind: 'draft', label: '草稿' })
    expect(tag('published', { published_at: '2026-10-21T00:00:00Z', video_state: 'PUBLISHED' })).toMatchObject({ kind: 'sent', label: '已发出' })
    const unchecked = tag('published', { published_at: '2026-10-21T00:00:00Z', video_state: null })
    expect(unchecked).toMatchObject({ kind: 'uploaded', label: '已上传（未核对）' })
    expect(unchecked.hint).toContain('还没核对')
    expect(tag('closed')).toMatchObject({ kind: 'uploaded' })
  })

  it('no tag or hint uses internal words', () => {
    const all = ['in_review', 'approved', 'publishing', 'review_rejected', 'publish_failed', 'failed', 'queued', 'archived', 'published', 'weird'].map((s) => tag(s))
    for (const t of all) expect(`${t.label}${t.hint}`).not.toMatch(/库里|平台状态未核|尚未接入|放行规则|BGM|价格屏/)
  })
})

describe('groupWorksByStage / countReelWorks', () => {
  const works = groupReelWorks([
    reel({ id: '1', angle: 'Review One: a' }),
    reel({ id: '2', angle: 'Review Two: a' }),
    reel({ id: '3', status: 'review_rejected', angle: 'Rejected One: a' }),
    reel({ id: '4', status: 'approved', angle: 'Approved One: a' }),
    reel({ id: '5', status: 'queued', angle: 'Making One: a' }),
    reel({ id: '6', status: 'published', published_at: '2026-10-21T00:00:00Z', video_state: 'DRAFT', angle: 'Draft One: a' }),
    reel({ id: '7', status: 'published', published_at: '2026-10-21T00:00:00Z', video_state: null, angle: 'Unchecked One: a' }),
    reel({ id: '8', status: 'published', published_at: '2026-10-21T00:00:00Z', video_state: 'PUBLISHED', angle: 'Public One: a' }),
  ])

  it('puts what needs a person first, drafts and unchecked uploads together, and leaves empty groups out', () => {
    const stages = groupWorksByStage(works)
    expect(stages.map((s) => [s.id, s.works.length])).toEqual([
      ['review', 2],
      ['problem', 1],
      ['approved', 1],
      ['making', 1],
      ['draft', 2],
      ['sent', 1],
    ])
    expect(Object.fromEntries(stages.map((s) => [s.id, s.defaultOpen]))).toEqual({ review: true, problem: true, approved: true, making: false, draft: false, sent: true })
    expect(groupWorksByStage([])).toEqual([])
  })

  it('counts works and versions, per state', () => {
    const folded = groupReelWorks([
      reel({ id: 'a2', created_at: '2026-10-22T00:00:00Z', angle: 'Same Piece v2: x' }),
      reel({ id: 'a1', created_at: '2026-10-21T00:00:00Z', angle: 'Same Piece v1: x' }),
      reel({ id: 'b', status: 'failed', angle: 'Other Piece: x' }),
    ])
    const counts = countReelWorks(folded)
    expect(counts).toMatchObject({ works: 2, versions: 3 })
    expect(counts.byKind.review).toBe(1)
    expect(counts.byKind.problem).toBe(1)
  })

  it('the state of a work is the state of its newest version', () => {
    const folded = groupReelWorks([
      reel({ id: 'r2', created_at: '2026-10-22T00:00:00Z', angle: 'Detail Clip r2: new ending' }),
      reel({ id: 'r1', created_at: '2026-10-21T00:00:00Z', status: 'published', published_at: '2026-10-21T01:00:00Z', video_state: 'DRAFT', angle: 'Detail Clip r1: first cut' }),
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0].tag.label).toBe('待审核')
    expect(folded[0].versions[1].tag.label).toBe('草稿')
  })
})

describe('describeVarietyAdvice', () => {
  it('says what is off in plain words and what to do, only when the existing rule says something is off', () => {
    const track = describeVarietyAdvice({ same_track_max: 7, same_track_file: 'a.mp3', price_screen_count: 9, total: 30 })
    expect(track).toBe('最近 30 条里，同一首背景音乐用了 7 次。下一批建议换一首背景音乐。')
    const price = describeVarietyAdvice({ same_track_max: 1, same_track_file: 'a.mp3', price_screen_count: 5, total: 10 })
    expect(price).toBe('最近 10 条里，价格款占了 5 条。下一批建议少放价格款。')
    const both = describeVarietyAdvice({ same_track_max: 3, same_track_file: 'a.mp3', price_screen_count: 5, total: 10 })
    expect(both).toContain('换一首背景音乐、少放价格款')
    expect(describeVarietyAdvice({ same_track_max: 1, same_track_file: 'a.mp3', price_screen_count: 0, total: 3 })).toBeNull()
    expect(describeVarietyAdvice({ same_track_max: 0, same_track_file: null, price_screen_count: 0, total: 0 })).toBeNull()
    expect(`${track}${price}${both}`).not.toMatch(/BGM|价格屏|放行规则/)
  })
})
