/**
 * Parity: the server twin (src/lib/factory/content-substance.ts) must give the same answer as the Remotion engine
 * original for the same props. Fixtures are the engine's own fictional examples plus hand-built edge cases.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentSubstanceOf as serverOf } from './content-substance.ts'
// The engine is outside the Next runtime; this import is for the parity check only.
import { contentSubstanceOf as engineOf } from '../../../scripts/factory-worker/engines/remotion/src/contentSubstance.ts'

const EX = join(process.cwd(), 'scripts/factory-worker/engines/remotion/examples')
const load = (name) => JSON.parse(readFileSync(join(EX, name), 'utf8'))
const clone = (v) => JSON.parse(JSON.stringify(v))

const list = load('sydney-apartment.props.json')
const montage = load('sydney-montage.props.json')
const datacard = load('fictional-datacard.props.json')
const postcard = load('fictional-postcard.props.json')
const atmosphere = {
  durationSec: 15,
  fadeInSec: 1,
  fadeOutSec: 1.5,
  line: { text: 'The skyline at dusk', sourceUrl: 'https://example.test/a', sourceQuote: 'The skyline at dusk.' },
}

function variants() {
  const out = [
    ['list', 'list', list],
    ['montage', 'montage', montage],
    ['datacard', 'datacard', datacard],
    ['postcard', 'postcard', postcard],
    ['atmosphere', 'atmosphere', atmosphere],
  ]
  const blankList = clone(list)
  blankList.revealTitle = 'ㅤㅤㅤ'
  for (const i of blankList.items) i.text = 'x'
  for (const l of blankList.hook.lines) l.text = 'x'
  out.push(['list blank', 'list', blankList])
  out.push(['atmosphere no line', 'atmosphere', { ...atmosphere, line: null }])
  out.push(['atmosphere unsourced', 'atmosphere', { ...atmosphere, line: { text: 'The skyline at dusk', sourceUrl: '', sourceQuote: '' } }])
  const noEndPostcard = clone(postcard)
  for (const s of noEndPostcard.scenes) { s.place = 'a'; s.line = '' }
  out.push(['postcard thin', 'postcard', noEndPostcard])
  const fewWords = clone(montage)
  fewWords.words = fewWords.words.slice(0, 2)
  out.push(['montage few words', 'montage', fewWords])
  const shortRows = clone(datacard)
  shortRows.rowSec = 0.5
  out.push(['datacard fast rows', 'datacard', shortRows])
  out.push(['unknown template', 'weird', {}])
  out.push(['malformed list', 'list', { beats: 'nope', items: 3 }])
  return out
}

describe('content-substance server/engine parity', () => {
  for (const [name, template, props] of variants()) {
    it(`${name}: same verdict, kinds and textSeconds`, () => {
      const a = serverOf(template, props)
      let b
      try {
        b = engineOf(template, props)
      } catch {
        // The engine may throw on malformed input (the worker turns that into a refusal); the server must not pass it.
        expect(a.verdict).toBe('fail')
        return
      }
      expect({ verdict: a.verdict, kinds: a.kinds, textSeconds: a.textSeconds }).toEqual({
        verdict: b.verdict,
        kinds: b.kinds,
        textSeconds: b.textSeconds,
      })
    })
  }
})
