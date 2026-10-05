import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  TEMPLATE_IDS,
  isTemplateId,
  loadTemplate,
} from '../src/templates.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Load the sydney-apartment list fixture. */
function listProps() {
  const file = path.join(here, '..', 'examples', 'sydney-apartment.props.json')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Build a valid montage props object inline. */
function montageProps() {
  const kinds = ['aerial', 'street', 'person', 'detail']
  const tags = ['beach', 'kitchen', 'beach', 'kitchen', 'beach', 'kitchen', 'beach', 'kitchen', 'beach', 'kitchen', 'beach', 'kitchen']
  const clips = []
  for (let i = 0; i < 12; i++) {
    clips.push({
      file: `clips/clip-${i}.mp4`,
      tag: tags[i],
      kind: kinds[i % 4],
      source: 'own',
      lenFrames: 120,
    })
  }
  const words = []
  for (let i = 0; i < 12; i++) {
    words.push({
      at: i * 2,
      beats: 1,
      text: i === 0 ? '1 个开头' : `词${i}`,
      bg: 'black',
      rot: 0,
    })
  }
  const beats = []
  for (let i = 0; i < 40; i++) {
    beats.push(0.5 + i * 0.45)
  }
  return {
    brandColor: '#0B6E99',
    logoFile: 'logo.png',
    musicFile: 'track.m4a',
    beats,
    totalBeats: 32,
    fastBars: [2, 5],
    words,
    clips,
  }
}

test('TEMPLATE_IDS lists the supported templates', () => {
  assert.deepEqual([...TEMPLATE_IDS], ['list', 'montage'])
})

test('isTemplateId accepts known ids and rejects others', () => {
  assert.equal(isTemplateId('list'), true)
  assert.equal(isTemplateId('montage'), true)
  assert.equal(isTemplateId('carousel'), false)
  assert.equal(isTemplateId(undefined), false)
})

test('loadTemplate list returns ListReel metadata', () => {
  const loaded = loadTemplate('list', listProps())
  assert.equal(loaded.compositionId, 'ListReel')
  assert.equal(loaded.totalFrames, 307)
  assert.ok(loaded.assetFiles.includes('logo.png'))
})

test('loadTemplate montage returns MontageReel metadata', () => {
  const props = montageProps()
  const loaded = loadTemplate('montage', props)
  assert.equal(loaded.compositionId, 'MontageReel')
  assert.equal(loaded.totalFrames, Math.round(props.beats[32] * 30) + 2)
  assert.ok(loaded.assetFiles.includes('track.m4a'))
  for (const clip of props.clips) {
    assert.ok(loaded.assetFiles.includes(clip.file))
  }
})

test('loadTemplate rejects mismatched props', () => {
  assert.throws(() => loadTemplate('list', montageProps()))
  assert.throws(() => loadTemplate('montage', listProps()))
})

test('render.mjs rejects an unknown --template with exit code 2', () => {
  const renderPath = fileURLToPath(new URL('../render.mjs', import.meta.url))
  const propsPath = path.join(here, '..', 'examples', 'sydney-apartment.props.json')
  const result = spawnSync(
    process.execPath,
    [renderPath, '--props', propsPath, '--out', '/tmp/x.mp4', '--template', 'carousel'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.ok(result.stderr.includes('--template'))
})

test('the sydney montage example loads and uses 3 or more clip kinds', () => {
  const raw = JSON.parse(
    fs.readFileSync(new URL('../examples/sydney-montage.props.json', import.meta.url), 'utf8'),
  )
  const loaded = loadTemplate('montage', raw)
  assert.equal(loaded.compositionId, 'MontageReel')
  assert.ok(new Set(raw.clips.map((c) => c.kind)).size >= 3)
})
