import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { musicGainSchema } from '../src/schema.ts'
import { parsePostcardProps } from '../src/postcard.ts'
import { parseListReelProps } from '../src/schema.ts'
import { parseDataCardProps } from '../src/datacard.ts'
import { parseAtmosphereProps } from '../src/atmosphere.ts'
import { parseMontageReelProps } from '../src/montage.ts'

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
  test('shared schema: optional, 1..2.5 inclusive, rejects below 1 / above 2.5 / non-finite', () => {
    assert.equal(musicGainSchema.safeParse(undefined).success, true)
    for (const ok of [1, 1.5, 1.9, 2.5]) assert.equal(musicGainSchema.safeParse(ok).success, true, String(ok))
    for (const bad of [0, 0.99, 2.51, 3, 10, -1, NaN, Infinity, '2']) assert.equal(musicGainSchema.safeParse(bad).success, false, String(bad))
  })

  test('postcard accepts musicGain and keeps it; absent stays undefined (no behaviour change)', () => {
    assert.equal(parsePostcardProps({ ...postcardProps(), musicGain: 2 }).musicGain, 2)
    assert.equal(parsePostcardProps(postcardProps()).musicGain, undefined)
  })

  test('postcard rejects an out-of-range musicGain with a readable message', () => {
    assert.throws(() => parsePostcardProps({ ...postcardProps(), musicGain: 5 }), /音乐增益/)
  })

  test('every template schema knows musicGain (a missing field would make the strict schema reject the whole order)', () => {
    const parsers = { list: parseListReelProps, postcard: parsePostcardProps, datacard: parseDataCardProps, atmosphere: parseAtmosphereProps, montage: parseMontageReelProps }
    for (const [name, parse] of Object.entries(parsers)) {
      let msg = ''
      try { parse({ musicGain: 99 }) } catch (e) { msg = String(e instanceof Error ? e.message : e) }
      assert.match(msg, /音乐增益/, `${name}: musicGain out of range must be reported by the musicGain rule`)
      assert.doesNotMatch(msg, /musicGain[^\n]*(Unrecognized|不认识|未知)|(Unrecognized|不认识|未知)[^\n]*musicGain/i, `${name}: musicGain must not be treated as an unknown key`)
    }
  })

  test('every template component multiplies the Audio volume by musicGain', () => {
    for (const f of ['ListReel', 'PostcardReel', 'DataCardReel', 'AtmosphereReel', 'MontageReel']) {
      const src = readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), 'utf8')
      assert.match(src, /<Audio[^>]*volume=\{[^}]*\(props\.musicGain \?\? 1\)[^}]*\}/, `${f} must apply musicGain inside the Audio volume prop`)
    }
  })
})
