import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { beatsFor, musicStartFor, MAX_BEATS, MUSIC_FPS } from '../src/music.ts'
import { parseListReelProps } from '../src/schema.ts'
import {
  computeTiming,
  requiredBeatCount,
  FPS,
  SYNC_SHIFT_FRAMES,
  LOGO_BEATS,
} from '../src/timing.ts'

// Build a music entry: bars every 4 beats from 0.5 up to durationSec - one bar.
const entry = (bpm = 120, durationSec = 40) => {
  const bar = (60 / bpm) * 4
  const bars = []
  for (let t = 0.5; t <= durationSec - bar + 1e-9; t += bar) {
    bars.push(Math.round(t * 1000) / 1000)
  }
  return { bpm, durationSec, bars }
}

// Fresh clone of the valid fixture for every test.
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

describe('beatsFor', () => {
  test('120 bpm from bar 0 gives a half second grid', () => {
    const e = entry(120)
    assert.deepEqual(beatsFor(e, 5, 0), [0, 0.5, 1, 1.5, 2])
    assert.equal(beatsFor(e, 5, 3)[0], 0)
    assert.equal(musicStartFor(e, 3), 6.5)
  })

  test('the excerpt starts on a frame boundary and the lead keeps the bar exact', () => {
    assert.equal(MUSIC_FPS, FPS)
    const e = { bpm: 120, durationSec: 40, bars: [9.719, 11.719] }
    assert.equal(musicStartFor(e, 0), 9.7)
    assert.equal(beatsFor(e, 3, 0)[0], 0.019)
    assert.equal(beatsFor(e, 3, 0)[2], 1.019)
    assert.equal(musicStartFor({ ...e, bars: [0.7] }, 0), 0.7)
  })

  test('stride 2 skips every other beat', () => {
    assert.deepEqual(beatsFor(entry(120), 4, 0, 2), [0, 1, 2, 3])
  })

  test('rounds to 3 decimals without drift', () => {
    const b = beatsFor(entry(139.03, 60), 11, 0)
    assert.equal(b[1], 0.432)
    assert.equal(b[10], 4.316)
  })

  test('is always strictly increasing', () => {
    for (const bpm of [100, 133.1, 90]) {
      const b = beatsFor(entry(bpm, 60), 40, 0)
      for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1])
    }
  })

  test('rejects bad arguments', () => {
    const e = entry(120)
    throwsWith(() => beatsFor(e, 0, 0), '节拍数量')
    throwsWith(() => beatsFor(e, MAX_BEATS + 1, 0), '节拍数量')
    throwsWith(() => beatsFor(e, 2.5, 0), '节拍数量')
    throwsWith(() => beatsFor(e, 5, -1), '起始小节')
    throwsWith(() => beatsFor(e, 5, 1.5), '起始小节')
    throwsWith(() => beatsFor(e, 5, e.bars.length), '起始小节')
    throwsWith(() => beatsFor(e, 5, 0, 0), '步长')
    throwsWith(() => beatsFor(entry(20), 5, 0), 'BPM')
    throwsWith(() => beatsFor(entry(400), 5, 0), 'BPM')
    throwsWith(() => beatsFor(entry(NaN), 5, 0), 'BPM')
    throwsWith(() => beatsFor(entry(120, 10), 30, 0), '音乐不够长')
  })

  test('the last beat may land exactly on the end', () => {
    const e = { bpm: 120, durationSec: 2.5, bars: [0.5] }
    const b = beatsFor(e, 5, 0)
    assert.equal(b[b.length - 1], 2)
    assert.ok(0.5 + 2 <= 2.5)
    throwsWith(() => beatsFor(e, 6, 0), '音乐不够长')
  })
})

describe('ListReel props with synced beats', () => {
  test('beats from a track parse and keep musicStartSec', () => {
    const e = entry(100, 60)
    const props = valid()
    props.beats = beatsFor(e, requiredBeatCount(4), 2)
    props.musicFile = 'music/track.mp3'
    props.musicStartSec = musicStartFor(e, 2)
    const parsed = parseListReelProps(props)
    assert.equal(parsed.musicStartSec, props.musicStartSec)
  })

  test('musicStartSec is optional', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.musicStartSec, undefined)
  })

  test('musicStartSec is bounded to 0..600', () => {
    for (const bad of [-1, 601]) {
      const props = valid()
      props.musicStartSec = bad
      assert.throws(
        () => parseListReelProps(props),
        (err) => {
          assert.ok(err.message.startsWith('props 校验失败'))
          return true
        },
      )
    }
    const ok = valid()
    ok.musicStartSec = 600
    assert.doesNotThrow(() => parseListReelProps(ok))
  })

  test('timing follows the beats', () => {
    const b = beatsFor(entry(100, 60), requiredBeatCount(4), 0)
    const t = computeTiming(b, 4)
    assert.equal(t.itemFrom[0], Math.round(b[4] * FPS) + SYNC_SHIFT_FRAMES)
    assert.equal(t.itemFrom[3], Math.round(b[10] * FPS) + SYNC_SHIFT_FRAMES)
    assert.equal(t.totalFrames, Math.round(b[20] * FPS) + SYNC_SHIFT_FRAMES)
  })

  test('the logo only covers the closing beats', () => {
    const b = beatsFor(entry(100, 60), requiredBeatCount(4), 0)
    const t = computeTiming(b, 4)
    assert.equal(LOGO_BEATS, 2)
    assert.equal(t.logoFrom, Math.round(b[18] * FPS) + SYNC_SHIFT_FRAMES)
    assert.ok(t.logoFrom > t.revealFrom)
    assert.ok(t.logoFrom < t.totalFrames)
  })
})

describe('music catalogue', () => {
  const tracks = JSON.parse(
    fs.readFileSync(new URL('../catalog/music.json', import.meta.url), 'utf8'),
  ).tracks

  test('has at least 20 well formed tracks', () => {
    assert.ok(tracks.length >= 20)
    assert.equal(new Set(tracks.map((t) => t.id)).size, tracks.length)
    for (const t of tracks) {
      for (const key of ['id', 'file', 'folder', 'mood']) {
        assert.equal(typeof t[key], 'string')
        assert.ok(t[key].length > 0)
      }
      assert.ok(t.durationSec > 0)
      assert.ok(t.bpm >= 60 && t.bpm <= 150)
      assert.ok(t.bars.length > 0)
      for (let i = 1; i < t.bars.length; i++) assert.ok(t.bars[i] > t.bars[i - 1])
      assert.ok(t.bars[0] >= 0)
      assert.ok(t.bars[t.bars.length - 1] < t.durationSec)
      assert.ok(['low', 'mid', 'high'].includes(t.energy))
      assert.ok(Array.isArray(t.suits))
      for (const s of t.suits) assert.ok(['list', 'montage', 'quiz'].includes(s))
      assert.equal(t.needs_listening, true)
    }
  })

  test('halving is consistent with rawBpm', () => {
    for (const t of tracks) {
      assert.equal(typeof t.halved, 'boolean')
      if (t.halved) {
        assert.ok(t.rawBpm > 150)
        assert.ok(Math.abs(t.rawBpm / 2 - t.bpm) < 0.01)
      } else {
        assert.equal(t.rawBpm, t.bpm)
      }
    }
  })

  test('no file name mentions temp', () => {
    for (const t of tracks) assert.ok(!/temp/i.test(t.file))
  })

  test('musicStartFor(track, 0) is at most one frame before the first bar', () => {
    for (const t of tracks) {
      const lead = t.bars[0] - musicStartFor(t, 0)
      assert.ok(lead >= -1e-9 && lead < 1 / FPS)
    }
  })
})

const toolPath = new URL('../../../tools/analyze-music.py', import.meta.url).pathname
const hasPython =
  spawnSync('python3', ['-c', 'import numpy, scipy']).status === 0
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const skip = hasPython && hasFfmpeg ? false : 'python3 with numpy+scipy and ffmpeg are required'

const PRELUDE = [
  'import sys, json, importlib.util',
  "spec = importlib.util.spec_from_file_location('am', sys.argv[1])",
  'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)',
].join('\n')

// Run a snippet against the tool module and parse its printed JSON.
const py = (code) => {
  const res = spawnSync('python3', ['-c', `${PRELUDE}\n${code}`, toolPath], {
    encoding: 'utf8',
  })
  assert.equal(res.status, 0, res.stderr)
  return JSON.parse(res.stdout)
}

const tmpDirs = []
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

// Write a 16 s click track at the given bpm into dir.
const click = (bpm, dir) => {
  const file = path.join(dir, `${bpm}.wav`)
  const src = `aevalsrc=sin(2*PI*1000*t)*exp(-60*mod(t\\,${60 / bpm})):d=16:s=22050`
  const res = spawnSync(
    'ffmpeg',
    ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, file],
    { encoding: 'utf8' },
  )
  assert.equal(res.status, 0, res.stderr)
  return file
}

// Run the tool and parse its JSON report.
const analyse = (args) => {
  const res = spawnSync('python3', [toolPath, ...args], { encoding: 'utf8' })
  return { status: res.status, out: JSON.parse(res.stdout) }
}

describe('analyze-music.py', { skip }, () => {
  test('normalise_bpm halves only above 150', () => {
    const out = py(
      'print(json.dumps([m.normalise_bpm(151), m.normalise_bpm(150), m.normalise_bpm(199.0)]))',
    )
    assert.deepEqual(out, [[75.5, true], [150, false], [99.5, true]])
  })

  test('bar_starts keeps only whole bars', () => {
    const out = py('print(json.dumps(m.bar_starts(0.5, 120, 10)))')
    assert.deepEqual(out, [0.5, 2.5, 4.5, 6.5])
  })

  test('100 bpm click track', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'))
    tmpDirs.push(dir)
    const file = click(100, dir)
    const { status, out } = analyse([file])
    assert.equal(status, 0)
    const t = out.tracks[0]
    for (const key of [
      'file',
      'dir',
      'durationSec',
      'rawBpm',
      'bpm',
      'halved',
      'firstBeat',
      'downbeat',
      'bars',
    ]) {
      assert.ok(key in t, `expected key ${key}`)
    }
    assert.ok(Math.abs(t.bpm - 100) < 1)
    assert.equal(t.halved, false)
    const r = t.firstBeat % 0.6
    assert.ok(Math.min(r, 0.6 - r) < 0.03)
    for (let i = 1; i < t.bars.length; i++) {
      assert.ok(Math.abs(t.bars[i] - t.bars[i - 1] - 2.4) < 0.05)
    }
  })

  test('180 bpm click track is halved to 90', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'))
    tmpDirs.push(dir)
    const { status, out } = analyse([click(180, dir)])
    assert.equal(status, 0)
    const t = out.tracks[0]
    assert.equal(t.halved, true)
    assert.ok(Math.abs(t.bpm - 90) < 1)
    assert.ok(Math.abs(t.rawBpm - 180) < 1)
  })

  test('directory input skips temp names and reports errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'))
    tmpDirs.push(dir)
    const a = click(100, dir)
    fs.copyFileSync(a, path.join(dir, 'temp_b.wav'))
    const { status, out } = analyse([dir])
    assert.equal(status, 0)
    assert.equal(out.tracks.length, 1)
    assert.equal(out.tracks[0].file, '100.wav')

    const missing = analyse([path.join(dir, 'nope.wav')])
    assert.equal(missing.status, 1)
    assert.ok(typeof missing.out.tracks[0].error === 'string')
    assert.ok(missing.out.tracks[0].error.length > 0)
  })
})
