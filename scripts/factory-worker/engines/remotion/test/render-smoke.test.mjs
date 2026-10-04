import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { makePlaceholderAssets } from '../tools/make-placeholder-assets.mjs'
import { computeTimingFromProps } from '../src/timing.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const renderPath = path.join(here, '..', 'render.mjs')
const fixturePath = path.join(here, '..', 'examples', 'sydney-apartment.props.json')

const tempDirs = []

/** Create a fresh temp directory tracked for cleanup. */
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-test-'))
  tempDirs.push(dir)
  return dir
}

/** Run render.mjs with the given args. */
function runRender(args, opts) {
  return spawnSync(process.execPath, [renderPath, ...args], {
    encoding: 'utf8',
    timeout: opts?.timeout,
  })
}

/** Load the fixture, apply mutate, write props.json into dir, return its path. */
function writeProps(dir, mutate) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const props = mutate ? mutate(fixture) : fixture
  const file = path.join(dir, 'props.json')
  fs.writeFileSync(file, JSON.stringify(props, null, 2))
  return file
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('render.mjs command line guards', () => {
  it('exits 2 with usage when no arguments are given', () => {
    const result = runRender([])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /用法/)
  })

  it('exits 2 when --out does not end with .mp4', () => {
    const dir = tmp()
    const props = writeProps(dir)
    const result = runRender(['--props', props, '--out', path.join(dir, 'x.txt')])
    assert.equal(result.status, 2)
  })

  it('exits 3 when brandColor is not a hex colour', () => {
    const dir = tmp()
    const props = writeProps(dir, (p) => ({ ...p, brandColor: 'red' }))
    const result = runRender(['--props', props, '--out', path.join(dir, 'out.mp4')])
    assert.equal(result.status, 3)
    assert.match(result.stderr, /颜色必须是/)
  })

  it('exits 3 when props contain an unknown key', () => {
    const dir = tmp()
    const props = writeProps(dir, (p) => ({ ...p, unexpectedKey: true }))
    const result = runRender(['--props', props, '--out', path.join(dir, 'out.mp4')])
    assert.equal(result.status, 3)
  })

  it('exits 3 when the props file is not valid JSON', () => {
    const dir = tmp()
    const file = path.join(dir, 'props.json')
    fs.writeFileSync(file, '{not json')
    const result = runRender(['--props', file, '--out', path.join(dir, 'out.mp4')])
    assert.equal(result.status, 3)
  })

  it('exits 4 when the public dir has no assets', () => {
    const dir = tmp()
    const emptyPublic = tmp()
    const props = writeProps(dir)
    const result = runRender([
      '--props',
      props,
      '--out',
      path.join(dir, 'out.mp4'),
      '--public-dir',
      emptyPublic,
    ])
    assert.equal(result.status, 4)
    assert.match(result.stderr, /缺少素材文件/)
  })

  it('exits 2 when --concurrency is out of range', () => {
    const dir = tmp()
    const props = writeProps(dir)
    const result = runRender([
      '--props',
      props,
      '--out',
      path.join(dir, 'out.mp4'),
      '--concurrency',
      '0',
    ])
    assert.equal(result.status, 2)
  })

  it('exits 2 when --timeout-sec is below the minimum', () => {
    const dir = tmp()
    const props = writeProps(dir)
    const result = runRender([
      '--props',
      props,
      '--out',
      path.join(dir, 'out.mp4'),
      '--timeout-sec',
      '5',
    ])
    assert.equal(result.status, 2)
  })
})

const skipSmoke =
  process.env.RUN_REMOTION_RENDER !== '1'
    ? 'set RUN_REMOTION_RENDER=1 to run (needs Chrome + ffmpeg, takes minutes)'
    : false

describe('render smoke', { skip: skipSmoke }, () => {
  it(
    'renders the fixture to a 1080x1920 h264 mp4 of the expected duration',
    { timeout: 12 * 60 * 1000 },
    () => {
      const dir = tmp()
      makePlaceholderAssets(dir)
      const props = writeProps(dir)
      const out = path.join(dir, 'out.mp4')

      const result = runRender([
        '--props',
        props,
        '--out',
        out,
        '--public-dir',
        dir,
        '--concurrency',
        '2',
        '--timeout-sec',
        '600',
      ])
      assert.equal(result.status, 0, result.stderr)

      const stat = fs.statSync(out)
      assert.ok(stat.size > 10 * 1024, `output too small: ${stat.size} bytes`)

      const probe = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,codec_name',
          '-show_entries',
          'format=duration',
          '-of',
          'json',
          out,
        ],
        { encoding: 'utf8' },
      )
      assert.equal(probe.status, 0, probe.stderr)
      const info = JSON.parse(probe.stdout)
      const stream = info.streams[0]
      assert.equal(stream.width, 1080)
      assert.equal(stream.height, 1920)
      assert.equal(stream.codec_name, 'h264')

      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
      const expected = computeTimingFromProps(fixture).totalFrames / 30
      const actual = Number(info.format.duration)
      assert.ok(
        Math.abs(actual - expected) <= 0.3,
        `duration ${actual}s not within 0.3s of ${expected}s`,
      )
    },
  )

  it('exits 3 when the price key is missing', () => {
    const dir = tmp()
    const props = writeProps(dir, (p) => {
      const copy = { ...p }
      delete copy.price
      return copy
    })
    const result = runRender(['--props', props, '--out', path.join(dir, 'out.mp4')])
    assert.equal(result.status, 3)
  })
})
