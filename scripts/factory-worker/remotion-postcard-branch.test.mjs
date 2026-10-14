import { describe, it, expect } from 'vitest'
import {
  buildPostcardText,
  buildPostcardCaption,
  buildPostcardSrt,
  assertPostcardTextVisible,
  RemotionOrderError,
} from './remotion-branch.mjs'

const props = () => ({
  hook: { clip: 'clips/h.mp4', lines: ['QUIET', 'HARBOUR'] },
  scenes: [
    { clip: 'clips/a.mp4', place: 'Fictional Harbour', line: 'The harbour wakes slowly' },
    { clip: 'clips/b.mp4', place: 'Fictional Pier', line: 'Boats drift past the pier' },
  ],
  price: {
    backdropClip: 'clips/p.mp4',
    fromLabel: 'FROM',
    currencyPrefix: 'NZ$',
    amount: 4999,
    qualifier: 'PER PERSON',
    footnote: 'TWIN SHARE',
  },
})

const timing = () => ({
  hookFrames: 96,
  sceneFrom: [96, 204],
  sceneDur: [108, 108],
  priceFrom: 312,
  totalFrames: 492,
})

describe('buildPostcardText', () => {
  it('builds hook, scenes and price text', () => {
    const { hook, scenes, price } = buildPostcardText(props())
    expect(hook).toBe('QUIET HARBOUR')
    expect(scenes[0]).toBe('Fictional Harbour The harbour wakes slowly')
    expect(price).toBe('FROM NZ$4,999 PER PERSON TWIN SHARE')
  })

  it('includes dateLine between qualifier and footnote', () => {
    const p = props()
    p.price.dateLine = 'ON SALE'
    const { price } = buildPostcardText(p)
    expect(price).toBe('FROM NZ$4,999 PER PERSON ON SALE TWIN SHARE')
  })
})

describe('buildPostcardCaption', () => {
  it('joins hook, scenes and price with " · "', () => {
    const caption = buildPostcardCaption(props())
    expect(caption).toBe(
      'QUIET HARBOUR · Fictional Harbour The harbour wakes slowly · Fictional Pier Boats drift past the pier · FROM NZ$4,999 PER PERSON TWIN SHARE',
    )
  })
})

describe('buildPostcardSrt', () => {
  it('emits 4 numbered cues with the expected timings', () => {
    const srt = buildPostcardSrt(props(), timing(), 30)
    const cues = srt.split('\n\n').filter((c) => c !== '')
    expect(cues).toHaveLength(4)
    expect(cues[0].split('\n')[1]).toBe('00:00:00,000 --> 00:00:03,200')
    expect(cues[1].split('\n')[1]).toBe('00:00:03,200 --> 00:00:06,800')
    expect(cues[3].split('\n')[1].endsWith('00:00:16,300')).toBe(true)
    cues.forEach((cue, i) => {
      expect(cue.split('\n')[0]).toBe(String(i + 1))
    })
    expect(srt.endsWith('\n\n')).toBe(true)
  })
})

describe('assertPostcardTextVisible', () => {
  it('throws for a scene line containing invisible characters', () => {
    const p = props()
    p.scenes[0].line = 'The harbour\u200b wakes slowly'
    expect(() => assertPostcardTextVisible(p)).toThrow(RemotionOrderError)
    expect(() => assertPostcardTextVisible(p)).toThrow(/不可见/)
  })

  it('throws for a hook line that is only invisible characters', () => {
    const p = props()
    p.hook.lines = ['\u200b']
    expect(() => assertPostcardTextVisible(p)).toThrow(RemotionOrderError)
    expect(() => assertPostcardTextVisible(p)).toThrow(/空的/)
  })

  it('does not throw for valid props', () => {
    expect(() => assertPostcardTextVisible(props())).not.toThrow()
  })

  it('uses the end title instead of a price block when price is null', () => {
    const noPrice = { ...props(), price: null, end: { backdropClip: 'clips/e.mp4', title: 'QUIET HARBOUR' } }
    expect(buildPostcardText(noPrice).price).toBe('QUIET HARBOUR')
    expect(() => assertPostcardTextVisible(noPrice)).not.toThrow()
    expect(() => assertPostcardTextVisible({ ...noPrice, end: { backdropClip: 'clips/e.mp4', title: '\u200b' } })).toThrow(RemotionOrderError)
  })
})
