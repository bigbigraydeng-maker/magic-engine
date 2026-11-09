import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { excerptFor } from '../src/music.ts'
import { parseListReelProps } from '../src/schema.ts'
import { requiredBeatCount } from '../src/timing.ts'

// A minimal valid entry, overridable per test.
const entry = (o = {}) => ({
  id: 't',
  folder: 'Music',
  file: 't.m4a',
  durationSec: 100,
  bpmDetected: 120,
  offsetSec: 0.1,
  barPhase: 2,
  status: 'ready',
  energy: 'mid',
  style: 't',
  mood: 't',
  ...o,
})

// Fresh clone of the valid props fixture for every test.
const valid = () =>
  structuredClone(
    JSON.parse(
      fs.readFileSync(
        new URL('../examples/sydney-apartment.props.json', import.meta.url),
        'utf8',
      ),
    ),
  )

// Assert fn throws an Error whose message includes fragment.
const throwsWith = (fn, fragment) => {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error)
    assert.ok(
      err.message.includes(fragment),
      `expected message to contain '${fragment}', got: ${err.message}`,
    )
    return true
  })
}

describe('excerptFor', () => {
  test('startBar 0 gives the expected start and beats', () => {
    const ex = excerptFor(entry(), 4, 0)
    assert.equal(ex.musicStartSec, 1.1)
    assert.equal(ex.beats.length, requiredBeatCount(4))
    assert.equal(ex.beats[0], 0)
    assert.equal(ex.beats[1], 0.5)
    assert.equal(ex.beats[2], 1)
  })

  test('startBar 3 shifts the start', () => {
    const ex = excerptFor(entry(), 4, 3)
    assert.equal(ex.musicStartSec, 7.1)
    assert.equal(ex.beats[0], 0)
  })

  test('an off-grid downbeat keeps the bar exact', () => {
    const ex = excerptFor(entry({ offsetSec: 0.119 }), 4, 0)
    assert.equal(ex.musicStartSec, 1.1)
    assert.equal(ex.beats[0], 0.019)
    assert.equal(ex.beats[1], 0.519)
  })

  test('a fast song is folded', () => {
    const ex = excerptFor(entry({ bpmDetected: 160 }), 4, 1)
    assert.equal(ex.musicStartSec, 3.1)
    const gap = Math.round((ex.beats[1] - ex.beats[0]) * 1000) / 1000
    assert.equal(gap, 0.75)
  })

  test('rejects a bad startBar', () => {
    throwsWith(() => excerptFor(entry(), 4, -1), '起始小节')
    throwsWith(() => excerptFor(entry(), 4, 1.5), '起始小节')
  })

  test('rejects a startBar past the end', () => {
    throwsWith(() => excerptFor(entry(), 4, 100), '音乐太短')
  })
})

describe('musicStartSec in props', () => {
  test('a computed start round-trips through the schema', () => {
    const props = valid()
    const ex = excerptFor(entry(), 4, 2)
    props.musicFile = 'music/t.m4a'
    props.musicStartSec = ex.musicStartSec
    props.beats = ex.beats
    assert.equal(parseListReelProps(props).musicStartSec, ex.musicStartSec)
  })

  test('old props without musicStartSec stay valid', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.musicStartSec, undefined)
  })

  test('musicStartSec bounds are enforced', () => {
    for (const bad of [-1, 601]) {
      const props = valid()
      props.musicStartSec = bad
      assert.throws(
        () => parseListReelProps(props),
        (err) => {
          assert.ok(err instanceof Error)
          assert.ok(err.message.startsWith('props 校验失败'))
          return true
        },
      )
    }
    const ok = valid()
    ok.musicStartSec = 600
    assert.equal(parseListReelProps(ok).musicStartSec, 600)
  })
})

// Skip the analyzer test when its tools are missing.
const skip =
  spawnSync('python3', ['-c', 'import numpy, scipy']).status !== 0 ||
  spawnSync('ffmpeg', ['-version']).status !== 0
    ? 'python3 with numpy/scipy and ffmpeg are required'
    : false

describe('analyze-music.py on a synthetic click track', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const script = new URL('../../../tools/analyze-music.py', import.meta.url).pathname

  // Render a click track from an ffmpeg expression, run the analyzer on it, return its JSON.
  const analyse = (name, expr, seconds) => {
    const file = path.join(dir, name)
    const src = `aevalsrc=${expr}:d=${seconds}:s=22050`
    const gen = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, file])
    assert.equal(gen.status, 0)
    const run = spawnSync('python3', [script, file], { encoding: 'utf8' })
    assert.equal(run.status, 0)
    return JSON.parse(run.stdout)
  }

  test('analyses the whole file: clicks that only start after the first minute are found', () => {
    const r = analyse('late.wav', 'if(gte(t\\,65.37)\\,exp(-60*mod(t-65.37\\,0.6))*sin(2*PI*1000*t)\\,0)', 75)
    assert.ok(Math.abs(r.bpmDetected - 100) < 1)
  })

  test('the first beat is not early by a frame (within 12 ms of the true click)', () => {
    const r = analyse('clicks.wav', 'exp(-60*mod(t\\,0.6))*sin(2*PI*1000*t)', 16)
    const err = r.offsetSec > 0.3 ? r.offsetSec - 0.6 : r.offsetSec
    assert.ok(Math.abs(err) < 0.012, `first beat ${r.offsetSec}`)
  })
})
