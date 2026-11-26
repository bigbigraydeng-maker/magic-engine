import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computeTimingFromProps } from '../src/timing.ts'
import { computeMontageTiming } from '../src/montage.ts'
import { computeDataCardTiming } from '../src/datacard.ts'
import { computeAtmosphereTiming } from '../src/atmosphere.ts'
import { loadTemplate } from '../src/templates.ts'
import { usesFlash } from '../src/styles/craft.ts'
import {
  atmosphereCraftOf,
  atmosphereShotPlan,
  datacardKeepsNumbers,
  styledDataCardTiming,
  styledListTiming,
  styledMontageTiming,
} from '../src/styles/template-craft.ts'

function readJson(name) {
  return JSON.parse(fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'))
}

function montageProps() {
  const kinds = ['aerial', 'street', 'person', 'detail']
  const clips = []
  const words = []
  for (let i = 0; i < 12; i++) {
    clips.push({ file: `clips/clip-${i}.mp4`, tag: i % 2 === 0 ? 'beach' : 'kitchen', kind: kinds[i % 4], source: 'own', lenFrames: 120 })
    words.push({ at: i * 2, beats: 1, text: i === 0 ? '1 个开头' : `词${i}`, bg: 'black', rot: 0 })
  }
  const beats = []
  for (let i = 0; i < 40; i++) beats.push(0.5 + i * 0.45)
  return {
    brandColor: '#0B6E99',
    logoFile: 'logo.png',
    musicFile: 'track.m4a',
    beats,
    totalBeats: 32,
    fastBars: [2, 5],
    placeTerms: [],
    words,
    clips,
  }
}

function atmosphereProps() {
  return { logoFile: 'logo.png', musicFile: null, clip: 'clips/main.mp4', durationSec: 15, line: null }
}

test('omitting style keeps list, montage, datacard and atmosphere on the old clock', () => {
  const list = readJson('sydney-apartment.props.json')
  const loadedList = loadTemplate('list', list)
  assert.equal(Object.hasOwn(loadedList.props, 'look'), false)
  assert.equal(loadedList.totalFrames, computeTimingFromProps(loadedList.props).totalFrames)

  const montage = montageProps()
  const loadedMontage = loadTemplate('montage', montage)
  assert.equal(Object.hasOwn(loadedMontage.props, 'look'), false)
  assert.equal(loadedMontage.totalFrames, computeMontageTiming(loadedMontage.props).totalFrames)

  const card = readJson('fictional-datacard.props.json')
  const loadedCard = loadTemplate('datacard', card)
  assert.equal(Object.hasOwn(loadedCard.props, 'look'), false)
  assert.equal(loadedCard.totalFrames, computeDataCardTiming(loadedCard.props).totalFrames)

  const atmo = atmosphereProps()
  const loadedAtmo = loadTemplate('atmosphere', atmo)
  assert.equal(Object.hasOwn(loadedAtmo.props, 'look'), false)
  assert.equal(loadedAtmo.totalFrames, computeAtmosphereTiming(loadedAtmo.props).totalFrames)
})

test('a filled style retimes list, montage and datacard, and the three packs do not share a rhythm', () => {
  const list = readJson('sydney-apartment.props.json')
  const plain = loadTemplate('list', list)
  const vivid = loadTemplate('list', list, { preset: 'vivid' })
  const travel = loadTemplate('list', list, { preset: 'travel' })
  const data = loadTemplate('list', list, { preset: 'b2b' })
  assert.equal(vivid.totalFrames, styledListTiming(list.items.length, vivid.props.look).totalFrames)
  assert.notEqual(vivid.totalFrames, plain.totalFrames)
  assert.ok(styledListTiming(list.items.length, vivid.props.look).shotFrames < styledListTiming(list.items.length, travel.props.look).shotFrames)
  assert.notEqual(vivid.props.look.craft.caption, travel.props.look.craft.caption)
  assert.notEqual(travel.props.look.craft.picture, data.props.look.craft.picture)
  assert.notEqual(vivid.props.look.craft.textMotion, data.props.look.craft.textMotion)
  assert.ok(styledListTiming(list.items.length, vivid.props.look).cuts > 0)

  const montage = montageProps()
  const vividMontage = loadTemplate('montage', montage, { preset: 'vivid' })
  const plainMontage = loadTemplate('montage', montage)
  assert.notEqual(vividMontage.totalFrames, plainMontage.totalFrames)
  const montagePlan = styledMontageTiming(montage.clips.length, montage.words.length, vividMontage.props.look)
  assert.equal(vividMontage.totalFrames, montagePlan.totalFrames)
  assert.ok(montagePlan.cuts >= montage.clips.length - 1)

  const card = readJson('fictional-datacard.props.json')
  const vividCard = loadTemplate('datacard', card, { preset: 'vivid' })
  const travelCard = loadTemplate('datacard', card, { preset: 'travel' })
  const vividRows = styledDataCardTiming(card.rows, vividCard.props.look)
  const travelRows = styledDataCardTiming(card.rows, travelCard.props.look)
  assert.equal(datacardKeepsNumbers(card.rows, vividRows), true)
  assert.equal(vividRows.primary, 'numbers')
  assert.equal(vividRows.values.join('|'), card.rows.map((row) => row.value).join('|'))
  assert.notEqual(vividRows.rowFrames, travelRows.rowFrames)
  assert.notEqual(vividCard.totalFrames, loadTemplate('datacard', card).totalFrames)
})

test('atmosphere stays one shot and only the caption and picture treatment change', () => {
  const atmo = atmosphereProps()
  const plain = loadTemplate('atmosphere', atmo)
  const vivid = loadTemplate('atmosphere', atmo, { preset: 'vivid' })
  const travel = loadTemplate('atmosphere', atmo, { preset: 'travel' })
  const data = loadTemplate('atmosphere', atmo, { preset: 'b2b' })
  assert.equal(vivid.totalFrames, plain.totalFrames)
  assert.equal(travel.totalFrames, plain.totalFrames)
  assert.equal(data.totalFrames, plain.totalFrames)
  for (const loaded of [vivid, travel, data]) {
    const plan = atmosphereShotPlan(loaded.totalFrames)
    assert.equal(plan.shots, 1)
    assert.equal(plan.cuts, 0)
    const craft = atmosphereCraftOf(loaded.props.look.craft)
    assert.deepEqual([...craft.transitions], ['cut'])
    assert.equal(usesFlash(craft), false)
  }
  assert.equal(atmosphereCraftOf(vivid.props.look.craft).caption, 'sticker')
  assert.equal(atmosphereCraftOf(vivid.props.look.craft).picture, 'shake')
  assert.equal(atmosphereCraftOf(travel.props.look.craft).caption, 'stroke-bottom')
  assert.equal(atmosphereCraftOf(travel.props.look.craft).picture, 'grain')
  assert.equal(atmosphereCraftOf(data.props.look.craft).caption, 'lower-third')
  assert.equal(atmosphereCraftOf(data.props.look.craft).picture, 'split')
  assert.equal(usesFlash(vivid.props.look.craft), true)
})

test('a brief single shot removes list and montage cuts but keeps every datacard value', () => {
  const list = readJson('sydney-apartment.props.json')
  const held = loadTemplate('list', list, { preset: 'vivid', rules: { singleShot: true, singleShotSec: 7 } })
  assert.equal(styledListTiming(list.items.length, held.props.look).cuts, 0)
  assert.equal(held.totalFrames, Math.round(7 * 30))
  const montage = montageProps()
  const quiet = loadTemplate('montage', montage, { preset: 'retail', rules: { singleShot: true, singleShotSec: 7 } })
  assert.equal(styledMontageTiming(montage.clips.length, montage.words.length, quiet.props.look).cuts, 0)
  const card = readJson('fictional-datacard.props.json')
  const numbers = loadTemplate('datacard', card, { preset: 'b2b', rules: { singleShot: true, singleShotSec: 7 } })
  const plan = styledDataCardTiming(card.rows, numbers.props.look)
  assert.equal(plan.cuts, 0)
  assert.equal(datacardKeepsNumbers(card.rows, plan), true)
})
