import { describe, expect, it } from 'vitest'
import { buildVariantBrief, parseVariantRequest, VARIANT_BASE_STATUSES } from './variant-order'
import { remotionMusicChoices } from './remotion-music-options.mjs'
import postcardProps from '../../../scripts/factory-worker/engines/remotion/examples/fictional-postcard.props.json'

const BASE_ID = '11111111-2222-4333-8444-555555555555'

function baseBrief(): Record<string, unknown> {
  return {
    engine: 'remotion',
    copy: { caption: 'Fictional caption' },
    reopened_from: '99999999-0000-4000-8000-000000000000',
    review_feedback: 'old feedback',
    review_feedback_by: 'someone',
    remotion: {
      template: 'list',
      props: {
        hook: { clip: 'clips/hook_tower.mp4', lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'DAYS', badge: '10' }] },
        beats: [0.046, 0.955, 1.864, 2.773, 3.682, 4.591, 5.5, 6.409, 7.318, 8.227, 9.136, 10.045, 10.954, 11.863, 12.772, 13.681, 14.59, 15.499, 16.408],
        items: [
          { clip: 'clips/item_a.mp4', text: 'CITY SKYLINE', blurBackdrop: false },
          { clip: 'clips/item_b.mp4', text: 'LAKE BOATS', blurBackdrop: false },
          { clip: 'clips/item_c.mp4', text: 'RIVER SUNSET', blurBackdrop: false },
        ],
        price: { amount: 1999, layout: 'center', dateLine: 'DEPARTS 1 MAY 2027', footnote: 'FLIGHTS INCLUDED', fromLabel: 'FROM', qualifier: 'PER PERSON · TWIN SHARE', backdropClip: 'clips/end.mp4', footnoteSize: 50, qualifierSize: 50, currencyPrefix: 'NZ$', footnoteBackdrop: true },
        cutFlash: false, logoFile: 'logo.png', logoMode: 'always', itemLabel: 'YOUR 10 DAYS',
        musicFile: 'music/jade_river_journey.mp3', brandColor: '#B61E2E', revealTitle: 'LAKE TOWN & COAST.',
        footageScrim: 0.35, itemLabelSize: 52, musicStartSec: 0.118, revealTitleSize: 48, itemOverlayOpacity: 0.08,
      },
    },
  }
}

const hookBody = (lines: unknown) => ({ base_work_order_id: BASE_ID, change: { kind: 'hook', lines } })
const okLines = [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: '+ FLIGHTS', badge: null }]

function at(obj: unknown, ...keys: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      if (typeof key !== 'number') return undefined
      cur = cur[key]
    } else {
      if (typeof key !== 'string') return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
  }
  return cur
}

describe('parseVariantRequest', () => {
  it('accepts a valid hook request', () => {
    const r = parseVariantRequest(hookBody(okLines))
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    expect(r.baseId).toBe(BASE_ID)
    expect(r.change.kind).toBe('hook')
    if (r.change.kind !== 'hook') throw new Error('expected hook change')
    expect(r.change.lines).toHaveLength(3)
    expect(r.note).toBe('')
  })

  it('trims text and turns an empty-string badge into null', () => {
    const r = parseVariantRequest(
      hookBody([
        { text: '  FROM  ', badge: '   ' },
        { text: 'NZ$1,999', badge: null },
        { text: '+ FLIGHTS', badge: null },
      ]),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    if (r.change.kind !== 'hook') throw new Error('expected hook change')
    expect(r.change.lines[0]).toEqual({ text: 'FROM', badge: null })
  })

  it('keeps a trimmed note and cuts it to 300 chars', () => {
    const r = parseVariantRequest({ ...hookBody(okLines), note: '   ' + 'x'.repeat(400) + '   ' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    expect(r.note).toHaveLength(300)
    expect(r.note).toBe('x'.repeat(300))
  })

  it('rejects a non-object body', () => {
    const r = parseVariantRequest('nope')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('请求格式')
  })

  it('rejects a bad base id', () => {
    const r = parseVariantRequest({ base_work_order_id: 'abc', change: { kind: 'hook', lines: okLines } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('底稿视频编号')
  })

  it('rejects an unknown change kind', () => {
    const r = parseVariantRequest({ base_work_order_id: BASE_ID, change: { kind: 'price' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('开场文字或换配乐')
  })

  it('rejects two hook lines', () => {
    const r = parseVariantRequest(hookBody(okLines.slice(0, 2)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('3 行')
  })

  it('rejects an empty line text', () => {
    const r = parseVariantRequest(
      hookBody([{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: '   ', badge: null }]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('空的')
  })

  it('rejects a badge that is too long', () => {
    const r = parseVariantRequest(
      hookBody([{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'DAYS', badge: 'TOOLONG7' }]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('小标签')
  })

  it('rejects a numeric badge', () => {
    const r = parseVariantRequest(
      hookBody([{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'DAYS', badge: 5 }]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('小标签')
  })

  it('accepts a music request', () => {
    const r = parseVariantRequest({ base_work_order_id: BASE_ID, change: { kind: 'music', music_id: 'horizons-call' } })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    expect(r.change.kind).toBe('music')
    if (r.change.kind !== 'music') throw new Error('expected music change')
    expect(r.change.musicId).toBe('horizons-call')
  })

  it('rejects a malformed music id', () => {
    const r = parseVariantRequest({ base_work_order_id: BASE_ID, change: { kind: 'music', music_id: 'Bad Id!' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch('配乐')
  })
})

describe('buildVariantBrief', () => {
  it('builds a hook variant and strips review keys', () => {
    const input = {
      ...baseBrief(),
      recipe_replan_required: true,
      review_feedback_digest: 'd',
      review_overrides: { music: { track_id: 'x' } },
    }
    const r = buildVariantBrief(input, BASE_ID, { kind: 'hook', lines: okLines })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(r.error)
    const brief = r.brief
    expect(at(brief, 'remotion', 'props', 'hook', 'lines')).toEqual(okLines)
    expect(at(brief, 'remotion', 'props', 'hook', 'clip')).toBe('clips/hook_tower.mp4')
    expect(r.summary).toContain('+ FLIGHTS')
    expect(at(brief, 'variant_of')).toEqual({ base_work_order_id: BASE_ID, change: r.summary })
    expect('reopened_from' in brief).toBe(false)
    expect('review_feedback' in brief).toBe(false)
    expect('review_feedback_by' in brief).toBe(false)
    expect('recipe_replan_required' in brief).toBe(false)
    expect('review_feedback_digest' in brief).toBe(false)
    expect('review_overrides' in brief).toBe(false)
    expect(at(brief, 'copy')).toEqual({ caption: 'Fictional caption' })
  })

  it('rejects an unchanged hook', () => {
    const r = buildVariantBrief(baseBrief(), BASE_ID, {
      kind: 'hook',
      lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'DAYS', badge: '10' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('一模一样')
  })

  it('does not mutate the input brief', () => {
    const input = baseBrief()
    const r = buildVariantBrief(input, BASE_ID, { kind: 'hook', lines: okLines })
    expect(r.ok).toBe(true)
    expect(at(input, 'remotion', 'props', 'hook', 'lines', 2, 'text')).toBe('DAYS')
    expect('reopened_from' in input).toBe(true)
  })

  it('rejects a line that is too long', () => {
    const r = buildVariantBrief(baseBrief(), BASE_ID, {
      kind: 'hook',
      lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'FLIGHTS INCLUDED', badge: null }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('第 3 行太长')
  })

  it('counts the badge toward the line width', () => {
    const pass = buildVariantBrief(baseBrief(), BASE_ID, {
      kind: 'hook',
      lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'NIGHTS', badge: '10' }],
    })
    expect(pass.ok).toBe(true)

    const fail = buildVariantBrief(baseBrief(), BASE_ID, {
      kind: 'hook',
      lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'NIGHTSS', badge: '10' }],
    })
    expect(fail.ok).toBe(false)
    if (!fail.ok) expect(fail.error).toContain('第 3 行太长')
  })

  it('rejects a non-remotion brief', () => {
    const r = buildVariantBrief({ copy: {} }, BASE_ID, { kind: 'hook', lines: okLines })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是模板出片')
  })

  it('rejects a brief that has a creative_recipe', () => {
    const brief = baseBrief()
    brief.creative_recipe = {}
    const r = buildVariantBrief(brief, BASE_ID, { kind: 'hook', lines: okLines })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是模板出片')
  })

  it('rejects a hook change on a non-list template', () => {
    const brief = baseBrief()
    const remotion = at(brief, 'remotion')
    if (remotion === null || typeof remotion !== 'object' || Array.isArray(remotion)) {
      throw new Error('fixture remotion missing')
    }
    ;(remotion as Record<string, unknown>).template = 'postcard'
    const r = buildVariantBrief(brief, BASE_ID, { kind: 'hook', lines: okLines })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('清单款')
  })

  it('builds a music variant from the real catalog', () => {
    // Postcard cuts are not beat-timed, so any vocal-cleared track long enough is offered.
    const brief = { engine: 'remotion', remotion: { template: 'postcard', props: postcardProps } }
    const choices = remotionMusicChoices(brief.remotion)
    expect(choices.length).toBeGreaterThan(0)
    const choice = choices[0]
    const r = buildVariantBrief(brief, BASE_ID, { kind: 'music', musicId: choice.id })
    if (!r.ok) throw new Error(r.error)
    expect(r.summary).toBe(`配乐换成 ${choice.id}`)
    const musicFile = at(r.brief, 'remotion', 'props', 'musicFile')
    expect(typeof musicFile).toBe('string')
    expect(musicFile).not.toBe(postcardProps.musicFile)
    expect(at(r.brief, 'remotion', 'props', 'musicGain')).toBeUndefined()
    expect(at(r.brief, 'remotion', 'props', 'hook')).toEqual(postcardProps.hook)
  })

  it('rejects an unknown music id', () => {
    const r = buildVariantBrief(baseBrief(), BASE_ID, { kind: 'music', musicId: 'no-such-track' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('配乐')
  })
})

describe('VARIANT_BASE_STATUSES', () => {
  it('does not include pre-review or terminal statuses', () => {
    const statuses: readonly string[] = VARIANT_BASE_STATUSES
    expect(statuses).not.toContain('queued')
    expect(statuses).not.toContain('claimed')
    expect(statuses).not.toContain('producing')
    expect(statuses).not.toContain('dead_letter')
  })
})
