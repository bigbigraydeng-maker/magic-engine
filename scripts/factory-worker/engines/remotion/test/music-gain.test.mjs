import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { musicGainSchema } from '../src/schema.ts'
import { parsePostcardProps } from '../src/postcard.ts'

// Fictional fixture (same shape as postcard.test.mjs); musicGain is the only thing under test.
const postcardProps = () => ({
  brandColor: '#0b6e99',
  logoFile: 'logo.png',
  musicFile: null,
  cardOpacity: 0.4,
  cardSide: 'left',
  hook: { clip: 'clips/hook.mp4', lines: ['QUIET', 'HARBOUR'] },
  scenes: [
    { clip: 'clips/a.mp4', place: 'Fictional Harbour', line: 'The harbour wakes slowly', sourceUrl: 'https://example.com/tour', sourceQuote: 'the harbour wakes slowly at dawn', placeSourceQuote: 'fictional harbour is a quiet place' },
    { clip: 'clips/b.mp4', place: 'Example Bay', line: 'Boats drift past the pier', sourceUrl: 'https://example.com/bay', sourceQuote: 'boats drift past the pier each morning', placeSourceQuote: 'example bay has a long pier' },
  ],
  price: null,
  end: { backdropClip: 'clips/price.mp4', title: 'READ THE GUIDE' },
  timing: { hookSec: 3, sceneSec: 4, priceSec: 3 },
})

describe('musicGain', () => {
  test('shared schema: optional, 1..3 inclusive, rejects below 1 / above 3 / non-finite', () => {
    assert.equal(musicGainSchema.safeParse(undefined).success, true)
    for (const ok of [1, 1.5, 2.05, 3]) assert.equal(musicGainSchema.safeParse(ok).success, true, String(ok))
    for (const bad of [0, 0.99, 3.01, 10, -1, NaN, Infinity, '2']) assert.equal(musicGainSchema.safeParse(bad).success, false, String(bad))
  })

  test('postcard accepts musicGain and keeps it; absent stays undefined (no behaviour change)', () => {
    assert.equal(parsePostcardProps({ ...postcardProps(), musicGain: 2 }).musicGain, 2)
    assert.equal(parsePostcardProps(postcardProps()).musicGain, undefined)
  })

  test('postcard rejects an out-of-range musicGain with a readable message', () => {
    assert.throws(() => parsePostcardProps({ ...postcardProps(), musicGain: 5 }), /音乐增益/)
  })

  test('every template component applies musicGain to the audio volume', () => {
    for (const f of ['ListReel', 'PostcardReel', 'DataCardReel', 'AtmosphereReel', 'MontageReel']) {
      const src = readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), 'utf8')
      assert.match(src, /props\.musicGain \?\? 1/, `${f} must multiply the audio volume by musicGain`)
    }
  })
})
