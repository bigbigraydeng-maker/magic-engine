import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  MusicCatalogSchema,
  parseMusicCatalog,
  effectiveBpm,
  stagedFileName,
  beatGrid,
  beatsFor,
  MUSIC_FOLDERS,
  FOLD_ABOVE_BPM,
} from '../src/music.ts'

import { SAFE_REL_PATH, MUSIC_EXTS, parseListReelProps } from '../src/schema.ts'
import { computeTimingFromProps, requiredBeatCount } from '../src/timing.ts'

// Raw catalog text, kept around so tests can assert on it directly.
const catalogText = fs.readFileSync(
  new URL('../catalog/music.json', import.meta.url),
  'utf8',
)

// Fresh clone of the parsed catalog for every test.
const catalog = () => structuredClone(JSON.parse(catalogText))

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

// Clone the catalog, apply a mutation, and assert parsing rejects it.
const rejects = (mutate, expectedFragment) => {
  const raw = catalog()
  mutate(raw)
  assert.throws(
    () => parseMusicCatalog(raw),
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.startsWith('音乐目录校验失败'),
        `expected message to start with '音乐目录校验失败', got: ${err.message}`,
      )
      if (expectedFragment !== undefined) {
        assert.ok(
          err.message.includes(expectedFragment),
          `expected message to contain '${expectedFragment}', got: ${err.message}`,
        )
      }
      return true
    },
  )
}

// A minimal valid entry, overridable per test.
const entry = (overrides = {}) => ({
  id: 'test-track',
  folder: 'Music',
  file: 'test.m4a',
  durationSec: 100,
  bpmDetected: 120,
  offsetSec: 0.1,
  barPhase: 2,
  status: 'ready',
  energy: 'mid',
  style: 'test',
  mood: 'test',
  ...overrides,
})

describe('catalog', () => {
  test('parses with parseMusicCatalog', () => {
    const parsed = parseMusicCatalog(catalog())
    assert.equal(parsed.version, 1)
    assert.ok(Array.isArray(parsed.tracks))
  })

  test('has at least 25 tracks', () => {
    const parsed = parseMusicCatalog(catalog())
    assert.ok(
      parsed.tracks.length >= 25,
      `expected at least 25 tracks, got ${parsed.tracks.length}`,
    )
  })

  test('every staged file name is safe and has an allowed extension', () => {
    const parsed = parseMusicCatalog(catalog())
    for (const track of parsed.tracks) {
      const staged = stagedFileName(track)
      assert.ok(
        SAFE_REL_PATH.test(staged),
        `staged name not safe for ${track.id}: ${staged}`,
      )
      const lower = staged.toLowerCase()
      assert.ok(
        MUSIC_EXTS.some((ext) => lower.endsWith(ext)),
        `staged name has bad extension for ${track.id}: ${staged}`,
      )
    }
  })

  test("the 'pipa-trap' track stages as 'pipa-trap.m4a'", () => {
    const parsed = parseMusicCatalog(catalog())
    const pipa = parsed.tracks.find((t) => t.id === 'pipa-trap')
    assert.ok(pipa, "expected a track with id 'pipa-trap'")
    assert.equal(stagedFileName(pipa), 'pipa-trap.m4a')
  })

  test('MUSIC_FOLDERS and FOLD_ABOVE_BPM are the documented values', () => {
    assert.deepEqual([...MUSIC_FOLDERS], ['Music', '_shared/music'])
    assert.equal(FOLD_ABOVE_BPM, 150)
  })
})

describe('catalog schema rejects', () => {
  test('a duplicate id', () => {
    rejects((raw) => {
      raw.tracks[1].id = raw.tracks[0].id
    }, '音乐 id 重复')
  })

  test("folder 'Other'", () => {
    rejects((raw) => {
      raw.tracks[0].folder = 'Other'
    })
  })

  test("status 'maybe'", () => {
    rejects((raw) => {
      raw.tracks[0].status = 'maybe'
    })
  })

  test('an extra key', () => {
    rejects((raw) => {
      raw.tracks[0].extra = true
    })
  })

  test('offsetSec -0.1', () => {
    rejects((raw) => {
      raw.tracks[0].offsetSec = -0.1
    })
  })

  test('offsetSec 2', () => {
    rejects((raw) => {
      raw.tracks[0].offsetSec = 2
    })
  })

  test('barPhase 4', () => {
    rejects((raw) => {
      raw.tracks[0].barPhase = 4
    })
  })

  test('bpmDetected 40', () => {
    rejects((raw) => {
      raw.tracks[0].bpmDetected = 40
    })
  })
})

describe('catalog text', () => {
  test('contains no client names', () => {
    assert.ok(
      !/\bCTS\b|ctstours/i.test(catalogText),
      'catalog text must not mention client names',
    )
  })
})

describe('effectiveBpm', () => {
  test('200 -> 100', () => {
    assert.equal(effectiveBpm(200), 100)
  })

  test('150 -> 150', () => {
    assert.equal(effectiveBpm(150), 150)
  })

  test('133 -> 133', () => {
    assert.equal(effectiveBpm(133), 133)
  })

  test('151 -> 75.5', () => {
    assert.equal(effectiveBpm(151), 75.5)
  })
})

describe('stagedFileName', () => {
  test("'My Song.MP3' -> 'a-b.mp3'", () => {
    assert.equal(stagedFileName({ id: 'a-b', file: 'My Song.MP3' }), 'a-b.mp3')
  })

  test("'song.flac' throws", () => {
    assert.throws(() => stagedFileName({ id: 'a', file: 'song.flac' }))
  })

  test("'noext' throws", () => {
    assert.throws(() => stagedFileName({ id: 'a', file: 'noext' }))
  })
})

describe('beatGrid', () => {
  test('a 120 bpm entry with barPhase 2 gives the expected grid', () => {
    const e = entry({ bpmDetected: 120, offsetSec: 0.1, barPhase: 2 })
    assert.deepEqual(beatGrid(e, 4), [1.1, 1.6, 2.1, 2.6])
  })

  test('a folded 180 bpm entry with barPhase 3 gives the expected grid', () => {
    const e = entry({ bpmDetected: 180, offsetSec: 0.1, barPhase: 3 })
    assert.deepEqual(beatGrid(e, 3), [0.433, 1.1, 1.767])
  })

  test('every real track produces increasing, non-negative beats', () => {
    const parsed = parseMusicCatalog(catalog())
    for (const track of parsed.tracks) {
      const beats = beatGrid(track, 21)
      assert.equal(beats.length, 21)
      for (let i = 0; i < beats.length; i++) {
        assert.ok(beats[i] >= 0, `negative beat for ${track.id}`)
        if (i > 0) {
          assert.ok(
            beats[i] > beats[i - 1],
            `beats not increasing for ${track.id}`,
          )
        }
      }
    }
  })

  test('count 0 throws', () => {
    assert.throws(() => beatGrid(entry(), 0), /节拍数量必须是 1 到 80 的整数/)
  })

  test('count 81 throws', () => {
    assert.throws(() => beatGrid(entry(), 81), /节拍数量必须是 1 到 80 的整数/)
  })

  test('count 1.5 throws', () => {
    assert.throws(() => beatGrid(entry(), 1.5), /节拍数量必须是 1 到 80 的整数/)
  })

  test('a 10-second entry at 120 bpm cannot fit 21 beats', () => {
    const e = entry({ durationSec: 10, bpmDetected: 120, barPhase: 0 })
    assert.throws(
      () => beatGrid(e, 21),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(
          err.message.includes('音乐太短'),
          `expected '音乐太短', got: ${err.message}`,
        )
        return true
      },
    )
  })
})

describe('beatsFor', () => {
  test("the real 'pipa-trap' entry returns requiredBeatCount(4) beats", () => {
    const parsed = parseMusicCatalog(catalog())
    const pipa = parsed.tracks.find((t) => t.id === 'pipa-trap')
    assert.ok(pipa, "expected a track with id 'pipa-trap'")
    const beats = beatsFor(pipa, 4)
    assert.equal(beats.length, requiredBeatCount(4))
  })

  test('integrates with the sydney props fixture', () => {
    const parsed = parseMusicCatalog(catalog())
    const pipa = parsed.tracks.find((t) => t.id === 'pipa-trap')
    assert.ok(pipa, "expected a track with id 'pipa-trap'")

    const props = valid()
    props.beats = beatsFor(pipa, 4)
    props.musicFile = stagedFileName(pipa)

    const parsedProps = parseListReelProps(props)
    const timing = computeTimingFromProps(parsedProps)
    assert.ok(Number.isInteger(timing.totalFrames))
    assert.ok(timing.totalFrames > 0)
  })
})
