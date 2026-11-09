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
  musicSourceOf,
} from '../src/templates.ts'
import { parseMusicCatalog } from '../src/music.ts'

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
    placeTerms: [],
    words,
    clips,
  }
}

test('TEMPLATE_IDS lists the supported templates', () => {
  assert.deepEqual([...TEMPLATE_IDS], ['list', 'montage', 'datacard', 'postcard', 'atmosphere'])
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

test('render.mjs applies the same bitrate cap for every aspect', () => {
  const render = fs.readFileSync(new URL('../render.mjs', import.meta.url), 'utf8')
  const runRender = render.slice(render.indexOf('async function runRender'))
  const beforeMedia = runRender.slice(0, runRender.indexOf('await renderMedia('))
  assert.match(beforeMedia, /const cap = encodingCapFor\(/)
  assert.equal(/if\s*\([\s\S]*aspect[\s\S]*encodingCapFor/.test(beforeMedia), false)
  const mediaCall = runRender.slice(runRender.indexOf('await renderMedia('), runRender.indexOf('onProgress:'))
  assert.match(mediaCall, /crf: 18/)
  assert.match(mediaCall, /encodingMaxRate: cap\.encodingMaxRate/)
  assert.match(mediaCall, /encodingBufferSize: cap\.encodingBufferSize/)
})

test('render.mjs rejects an unknown --aspect with exit code 2 and accepts 9:16 as the default flag', () => {
  const renderPath = fileURLToPath(new URL('../render.mjs', import.meta.url))
  const propsPath = path.join(here, '..', 'examples', 'sydney-apartment.props.json')
  const bad = spawnSync(
    process.execPath,
    [renderPath, '--props', propsPath, '--out', '/tmp/x.mp4', '--aspect', '21:9'],
    { encoding: 'utf8' },
  )
  assert.equal(bad.status, 2)
  assert.ok(bad.stderr.includes('--aspect'))
})

test('the sydney montage example loads and uses 3 or more clip kinds', () => {
  const raw = JSON.parse(
    fs.readFileSync(new URL('../examples/sydney-montage.props.json', import.meta.url), 'utf8'),
  )
  const loaded = loadTemplate('montage', raw)
  assert.equal(loaded.compositionId, 'MontageReel')
  assert.ok(new Set(raw.clips.map((c) => c.kind)).size >= 3)
})

test('loadTemplate montage reports no recipe gaps for a complete fixture', () => {
  assert.deepEqual(loadTemplate('montage', montageProps()).recipeGaps, [])
})

test('recipe gaps reflect the sydney example and are absent for list', () => {
  const raw = JSON.parse(
    fs.readFileSync(new URL('../examples/sydney-montage.props.json', import.meta.url), 'utf8'),
  )
  assert.deepEqual(
    loadTemplate('montage', raw).recipeGaps.map((g) => g.column),
    ['真实感'],
  )
  assert.equal(loadTemplate('list', listProps()).recipeGaps, undefined)
})

/** Load the real music catalog fixture. */
function musicCatalog() {
  return parseMusicCatalog(
    JSON.parse(
      fs.readFileSync(new URL('../catalog/music.json', import.meta.url), 'utf8'),
    ),
  )
}

test('musicSourceOf resolves a Music folder track', () => {
  const catalog = musicCatalog()
  const src = musicSourceOf(catalog, 'pipa-trap.m4a')
  assert.ok(src)
  assert.equal(src.id, 'pipa-trap')
  assert.equal(src.folder, 'Music')
  assert.equal(src.file, '琵琶陷阱.m4a')
  assert.equal(typeof src.status, 'string')
})

test('musicSourceOf resolves a _shared/music folder track', () => {
  const catalog = musicCatalog()
  const src = musicSourceOf(catalog, 'jade-river-journey.mp3')
  assert.ok(src)
  assert.equal(src.id, 'jade-river-journey')
  assert.equal(src.folder, '_shared/music')
  assert.equal(src.file, 'Jade River Journey.mp3')
  assert.equal(typeof src.status, 'string')
})

test('musicSourceOf returns null for unknown or non-exact names', () => {
  const catalog = musicCatalog()
  assert.equal(musicSourceOf(catalog, 'unknown-song.mp3'), null)
  assert.equal(musicSourceOf(catalog, 'PIPA-TRAP.M4A'), null)
})

test('musicSourceOf skips a corrupt catalog entry without throwing', () => {
  const catalog = structuredClone(musicCatalog())
  catalog.tracks.push({
    ...catalog.tracks[0],
    id: 'weird-track',
    file: 'weird.ogg',
  })
  const src = musicSourceOf(catalog, 'pipa-trap.m4a')
  assert.ok(src)
  assert.equal(src.id, 'pipa-trap')
  assert.equal(musicSourceOf(catalog, 'unknown.mp3'), null)
})

test('loadTemplate postcard returns PostcardReel metadata', () => {
  const input = JSON.parse(fs.readFileSync(new URL('../examples/fictional-postcard.props.json', import.meta.url), 'utf8'))
  const loaded = loadTemplate('postcard', input)
  assert.equal(loaded.compositionId, 'PostcardReel')
  assert.equal(loaded.totalFrames, 492)
  assert.ok(loaded.assetFiles.includes('clips/hook.mp4'))
})

test('isTemplateId accepts postcard', () => {
  assert.equal(isTemplateId('postcard'), true)
})

test('loadTemplate atmosphere returns AtmosphereReel metadata and reports the missing person column', () => {
  const loaded = loadTemplate('atmosphere', {
    logoFile: 'logo.png',
    musicFile: null,
    clip: 'clips/main.mp4',
    durationSec: 15,
    line: null,
  })
  assert.equal(loaded.compositionId, 'AtmosphereReel')
  assert.equal(loaded.totalFrames, 450)
  assert.deepEqual(loaded.assetFiles, ['clips/main.mp4', 'logo.png'])
  assert.deepEqual(loaded.recipeGaps.map((g) => g.column), ['真人背影/真人出镜'])
})

test('loadTemplate refuses an unknown template id instead of falling back to montage', () => {
  assert.throws(() => loadTemplate('nope', {}), /未知模板/)
})
