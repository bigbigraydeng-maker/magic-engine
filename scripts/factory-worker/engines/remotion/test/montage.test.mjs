import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseMontageReelProps,
  collectMontageAssetFiles,
  computeMontageTiming,
  buildMontageSegments,
  montageFrameOf,
  MONTAGE_MIN_WORDS,
  MONTAGE_MIN_CLIPS,
  MONTAGE_MIN_KINDS,
  MONTAGE_MAX_SECONDS,
  MONTAGE_SYNC_SHIFT_FRAMES,
  MONTAGE_LOGO_BEATS,
  MONTAGE_MIN_TOTAL_FRAMES,
  MONTAGE_MIN_BEAT_GAP_SEC,
  maxFlashesPerSecond,
  recipeGapsOf,
  impactTagAtBeat,
  impactPlanReport,
  montageMusicVolumeAtFrame,
  MONTAGE_MAX_FLASHES_PER_SEC,
} from '../src/montage.ts'

import { FPS } from '../src/timing.ts'

// Build a fresh valid fixture for every test.
const valid = () => {
  const beats = []
  for (let i = 0; i < 40; i++) {
    beats.push(Math.round((0.5 + i * 0.45) * 1000) / 1000)
  }

  const words = [
    { at: 0, beats: 1, text: '3 BED', bg: 'brand', rot: -3 },
    { at: 2, beats: 1, text: 'OPEN SAT', bg: 'black', rot: 2 },
    { at: 4, beats: 1, text: 'SEA VIEWS', bg: 'white', rot: -1 },
    { at: 6, beats: 1, text: 'BEACH', bg: 'brand', rot: 3, clipTag: 'beach' },
    { at: 8, beats: 1, text: 'FROM', bg: 'black', rot: -2 },
    { at: 10, beats: 1, text: 'A$1.2M', bg: 'white', rot: 1 },
    { at: 12, beats: 1, text: 'KITCHEN', bg: 'brand', rot: -4, clipTag: 'kitchen' },
    { at: 14, beats: 1, text: 'QUIET', bg: 'black', rot: 2 },
    { at: 16, beats: 1, text: 'NORTH', bg: 'white', rot: -1 },
    { at: 18, beats: 1, text: 'LIGHT', bg: 'brand', rot: 3 },
    { at: 20, beats: 1, text: 'CALL NOW?', bg: 'black', rot: -2 },
    { at: 22, beats: 1, text: 'INSPECT', bg: 'white', rot: 1 },
  ]

  const kinds = ['aerial', 'street', 'person', 'detail']
  const clips = []
  for (let i = 0; i < 12; i++) {
    const n = String(i + 1).padStart(2, '0')
    let tag = `general-${i}`
    if (i === 3 || i === 9) tag = 'beach'
    if (i === 7 || i === 11) tag = 'kitchen'
    clips.push({
      file: `clips/c${n}.mp4`,
      tag,
      kind: kinds[i % 4],
      source: 'stock',
      lenFrames: 90 + i * 5,
    })
  }

  return {
    brandColor: '#0B6E99',
    logoFile: 'logo.png',
    musicFile: 'track.m4a',
    beats,
    totalBeats: 32,
    fastBars: [2, 5],
    placeTerms: ['BEACH', 'MANLY'],
    words,
    clips,
  }
}

const impactValid = () => {
  const raw = valid()
  const tags = ['hook', 'build-one', 'build-two', 'build-three', 'build-four', 'payoff']
  raw.clips.forEach((clip, i) => { clip.tag = tags[Math.floor(i / 2)] })
  raw.words[3].clipTag = 'build-one'
  raw.words[6].clipTag = 'build-two'
  raw.words.push({ at: 30, beats: 2, text: 'PAYOFF', bg: 'brand', rot: 0, clipTag: 'payoff' })
  raw.impactPlan = {
    hookTag: 'hook',
    buildTags: tags.slice(1, 5),
    payoffTag: 'payoff',
    hookBeats: 2,
    payoffBeats: 2,
  }
  return raw
}

// Clone the fixture, apply a mutation, and assert parsing rejects it.
const rejects = (mutate, fragment) => {
  const raw = valid()
  mutate(raw)
  assert.throws(
    () => parseMontageReelProps(raw),
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.startsWith('props 校验失败'),
        `expected message to start with 'props 校验失败', got: ${err.message}`,
      )
      if (fragment !== undefined) {
        assert.ok(
          err.message.includes(fragment),
          `expected message to contain '${fragment}', got: ${err.message}`,
        )
      }
      return true
    },
  )
}

// Find the beat index whose frame range contains `frame`.
function beatOfFrame(props, frame) {
  for (let i = 0; i < props.totalBeats; i++) {
    const f0 = montageFrameOf(props.beats, i)
    const f1 = montageFrameOf(props.beats, i + 1)
    if (frame >= f0 && frame < f1) return i
  }
  return props.totalBeats - 1
}

describe('montage props', () => {
  test('valid fixture parses', () => {
    const parsed = parseMontageReelProps(valid())
    assert.equal(parsed.totalBeats, 32)
    assert.equal(parsed.words.length, 12)
    assert.equal(parsed.clips.length, 12)
  })

  test('impact plan requires distinct scenes with multiple source clips each', () => {
    assert.doesNotThrow(() => parseMontageReelProps(impactValid()))
    rejects((raw) => { raw.impactPlan = impactValid().impactPlan; raw.impactPlan.buildTags[0] = 'hook' }, '不同场景标签')
    rejects((raw) => { raw.impactPlan = impactValid().impactPlan; raw.clips[0].tag = 'other' }, '需要至少 2 条不同素材')
  })

  test('collectMontageAssetFiles returns logo, music and 12 clips', () => {
    const parsed = parseMontageReelProps(valid())
    const files = collectMontageAssetFiles(parsed)
    assert.equal(files.length, 14)
    assert.ok(files.includes('logo.png'))
    assert.ok(files.includes('track.m4a'))
    assert.ok(files.includes('clips/c01.mp4'))
    assert.ok(files.includes('clips/c12.mp4'))
  })

  test('constants are the documented values', () => {
    assert.equal(MONTAGE_MIN_WORDS, 10)
    assert.equal(MONTAGE_MIN_CLIPS, 8)
    assert.equal(MONTAGE_MIN_KINDS, 3)
    assert.equal(MONTAGE_MAX_SECONDS, 20)
    assert.equal(MONTAGE_SYNC_SHIFT_FRAMES, 2)
    assert.equal(MONTAGE_LOGO_BEATS, 2)
    assert.equal(MONTAGE_MIN_TOTAL_FRAMES, 60)
    assert.equal(MONTAGE_MIN_BEAT_GAP_SEC, 0.25)
  })
})

describe('montage schema rejects', () => {
  test('an extra key', () => {
    rejects((raw) => {
      raw.extra = true
    })
  })

  test('musicFile null', () => {
    rejects((raw) => {
      raw.musicFile = null
    })
  })

  test('musicFile a URL', () => {
    rejects((raw) => {
      raw.musicFile = 'https://x.com/a.mp3'
    })
  })

  test('totalBeats 40 with only 40 beats', () => {
    rejects((raw) => {
      raw.totalBeats = 40
    }, '节拍数量不够')
  })

  test('duration over 20 seconds', () => {
    rejects((raw) => {
      const beats = []
      for (let i = 0; i < 40; i++) {
        beats.push(Math.round((0.5 + i * 0.765625) * 1000) / 1000)
      }
      raw.beats = beats
    }, '成片总时长不能超过 20 秒')
  })

  test('first word at 1', () => {
    rejects((raw) => {
      raw.words[0].at = 1
    }, '第一个词必须从第 0 拍开始')
  })

  test('first word text HELLO', () => {
    rejects((raw) => {
      raw.words[0].text = 'HELLO'
    }, '第一个词必须从第 0 拍开始')
  })

  test('first word text WHY NOW? is accepted', () => {
    const raw = valid()
    raw.words[0].text = 'WHY NOW?'
    const parsed = parseMontageReelProps(raw)
    assert.equal(parsed.words[0].text, 'WHY NOW?')
  })

  test('overlapping words', () => {
    rejects((raw) => {
      raw.words[1].at = 0
    }, '重叠')
  })

  test('word clipTag nope', () => {
    rejects((raw) => {
      raw.words[3].clipTag = 'nope'
    }, '在镜头池里不存在')
  })

  test('place word without clipTag', () => {
    rejects((raw) => {
      raw.words[1].text = 'MANLY'
    }, '含地名')
  })

  test('place word match is case-insensitive', () => {
    rejects((raw) => {
      raw.words[1].text = 'manly wharf'
    }, '含地名')
  })

  test('clipTag carried by a single clip', () => {
    rejects((raw) => {
      raw.clips[9].tag = 'general-9'
    }, '只有 1 条镜头')
  })

  test('placeTerms missing', () => {
    rejects((raw) => {
      delete raw.placeTerms
    })
  })

  test('only 2 kinds', () => {
    rejects((raw) => {
      for (const clip of raw.clips) {
        if (clip.kind === 'detail') clip.kind = 'aerial'
        if (clip.kind === 'street') clip.kind = 'aerial'
      }
    }, '镜头池至少要有 3 种类型')
  })

  test('duplicate clip file', () => {
    rejects((raw) => {
      raw.clips[1].file = raw.clips[0].file
    }, '镜头文件重复')
  })

  test('fastBars empty', () => {
    rejects((raw) => {
      raw.fastBars = []
    })
  })

  test('fastBars 8 with totalBeats 32', () => {
    rejects((raw) => {
      raw.fastBars = [8]
    }, '超出范围')
  })

  test('fewer than 10 words', () => {
    rejects((raw) => {
      raw.words = raw.words.slice(0, 9)
    })
  })

  test('text 13 chars', () => {
    rejects((raw) => {
      raw.words[1].text = 'ABCDEFGHIJKLM'
    })
  })

  test('beats spaced 0.2 seconds apart', () => {
    rejects((raw) => {
      const beats = []
      for (let i = 0; i < 40; i++) {
        beats.push(Math.round((0.5 + i * 0.2) * 1000) / 1000)
      }
      raw.beats = beats
    }, '节拍间隔太近')
  })

  test('beats spaced exactly 0.25 seconds apart parse', () => {
    const raw = valid()
    const beats = []
    for (let i = 0; i < 40; i++) {
      beats.push(Math.round((0.5 + i * 0.25) * 1000) / 1000)
    }
    raw.beats = beats
    const parsed = parseMontageReelProps(raw)
    assert.equal(parsed.beats.length, 40)
  })
})

describe('computeMontageTiming', () => {
  test('totalFrames and logoFrom match the beat grid', () => {
    const parsed = parseMontageReelProps(valid())
    const timing = computeMontageTiming(parsed)
    assert.equal(
      timing.totalFrames,
      Math.round(parsed.beats[32] * FPS) + MONTAGE_SYNC_SHIFT_FRAMES,
    )
    assert.equal(
      timing.logoFrom,
      Math.round(parsed.beats[30] * FPS) + MONTAGE_SYNC_SHIFT_FRAMES,
    )
  })

  test('throws when beats are too close', () => {
    const raw = valid()
    const beats = []
    for (let i = 0; i < 40; i++) {
      beats.push(Math.round(i * 0.001 * 1000) / 1000)
    }
    // The schema now rejects this spacing first (see 'montage schema rejects'); the timing helper keeps its own guard.
    assert.throws(() => computeMontageTiming({ beats, totalBeats: raw.totalBeats }), /成片太短|太近/)
  })
})

describe('buildMontageSegments', () => {
  test('is deterministic', () => {
    const parsed = parseMontageReelProps(valid())
    assert.deepEqual(buildMontageSegments(parsed), buildMontageSegments(parsed))
  })

  test('impact template renders the planned hook, four-step progression, and payoff in order', () => {
    const parsed = parseMontageReelProps(impactValid())
    const segments = buildMontageSegments(parsed)
    const selectedTags = new Set(segments.map((segment) => parsed.clips[segment.clip].tag))
    assert.equal(impactTagAtBeat(parsed, 0), 'hook')
    assert.equal(impactTagAtBeat(parsed, 2), 'build-one')
    assert.equal(impactTagAtBeat(parsed, 9), 'build-two')
    assert.equal(impactTagAtBeat(parsed, 30), 'payoff')
    assert.deepEqual([...selectedTags], ['hook', 'build-one', 'build-two', 'build-three', 'build-four', 'payoff'])
    assert.deepEqual(impactPlanReport(parsed), {
      schema_version: 1,
      hook_tag: 'hook',
      hook_beats: 2,
      build_tags: ['build-one', 'build-two', 'build-three', 'build-four'],
      payoff_tag: 'payoff',
      payoff_beats: 2,
      planned_scene_count: 6,
      rendered_clip_file_count: 12,
      human_review_required: true,
    })
  })

  test('impact template adds two middle-section accelerations even when the brief has only one fast bar', () => {
    const raw = impactValid()
    raw.fastBars = [0]
    const parsed = parseMontageReelProps(raw)
    const counts = new Map()
    for (const segment of buildMontageSegments(parsed)) {
      const bar = Math.floor(beatOfFrame(parsed, segment.from) / 4)
      counts.set(bar, (counts.get(bar) ?? 0) + 1)
    }
    assert.equal(counts.get(0), 8)
    assert.equal(counts.get(2), 8)
    assert.equal(counts.get(5), 8)
    assert.equal(counts.get(1), 4)
  })

  test('impact music rises through the middle and fades out while standard montage keeps its envelope', () => {
    const totalFrames = 480
    assert.equal(montageMusicVolumeAtFrame(3, totalFrames, false), 0.5)
    assert.equal(montageMusicVolumeAtFrame(3, totalFrames, true), 0.34)
    assert.ok(montageMusicVolumeAtFrame(300, totalFrames, true) > montageMusicVolumeAtFrame(60, totalFrames, true))
    assert.equal(montageMusicVolumeAtFrame(totalFrames - 2, totalFrames, true), 0)
  })

  test('segments are contiguous and cover the whole video', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    const timing = computeMontageTiming(parsed)
    // The video must open on a clip and word from frame 0, never on black, even when the first beat is late.
    assert.equal(parsed.beats[0] > 0, true)
    assert.equal(montageFrameOf(parsed.beats, 0), 0)
    let cursor = 0
    for (const seg of segs) {
      assert.equal(seg.from, cursor)
      cursor += seg.dur
    }
    assert.equal(cursor, timing.totalFrames)
  })

  test('fast bars produce two segments per beat', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const bar of [2, 5]) {
      const f0 = montageFrameOf(parsed.beats, bar * 4)
      const f1 = montageFrameOf(parsed.beats, bar * 4 + 4)
      const inBar = segs.filter((s) => s.from >= f0 && s.from < f1)
      assert.equal(inBar.length, 8, `bar ${bar} should have 8 segments`)
    }
  })

  test('never the same clip twice in a row', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (let i = 1; i < segs.length; i++) {
      assert.notEqual(segs[i].clip, segs[i - 1].clip)
    }
  })

  test('every segment fits inside its clip', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const seg of segs) {
      const clip = parsed.clips[seg.clip]
      const need = seg.dur + 2
      assert.ok(
        seg.start + need <= clip.lenFrames || clip.lenFrames <= need,
        `segment does not fit clip ${clip.file}`,
      )
    }
  })

  test('tagged words use clips with the matching tag', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const word of parsed.words) {
      if (word.clipTag === undefined) continue
      for (let beat = word.at; beat < word.at + word.beats; beat++) {
        const f0 = montageFrameOf(parsed.beats, beat)
        const f1 = montageFrameOf(parsed.beats, beat + 1)
        const inBeat = segs.filter((s) => s.from >= f0 && s.from < f1)
        assert.ok(inBeat.length > 0)
        for (const seg of inBeat) {
          assert.equal(parsed.clips[seg.clip].tag, word.clipTag)
        }
      }
    }
  })

  test('person clips fill at least a third of untagged segments', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    const taggedBeats = new Set()
    for (const word of parsed.words) {
      if (word.clipTag === undefined) continue
      for (let beat = word.at; beat < word.at + word.beats; beat++) {
        taggedBeats.add(beat)
      }
    }
    const untagged = segs.filter(
      (seg) => !taggedBeats.has(beatOfFrame(parsed, seg.from)),
    )
    const persons = untagged.filter(
      (seg) => parsed.clips[seg.clip].kind === 'person',
    )
    assert.ok(
      persons.length * 3 >= untagged.length,
      `expected at least a third person clips, got ${persons.length}/${untagged.length}`,
    )
  })

  test('every third untagged segment is a person clip', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    const taggedBeats = new Set()
    for (const word of parsed.words) {
      if (word.clipTag === undefined) continue
      for (let beat = word.at; beat < word.at + word.beats; beat++) taggedBeats.add(beat)
    }
    let checked = 0
    segs.forEach((seg, k) => {
      if (k % 3 !== 2 || taggedBeats.has(beatOfFrame(parsed, seg.from))) return
      checked += 1
      assert.equal(parsed.clips[seg.clip].kind, 'person', `segment ${k} should be a person clip`)
    })
    assert.ok(checked >= 5, 'the fixture must exercise the person rule at least 5 times')
  })

  test('bw is true only in bars where bar % 3 === 2', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const seg of segs) {
      const beat = beatOfFrame(parsed, seg.from)
      const bar = Math.floor(beat / 4)
      assert.equal(seg.bw, bar % 3 === 2)
    }
  })

  test('down is true for exactly the segments starting a bar', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const seg of segs) {
      const beat = beatOfFrame(parsed, seg.from)
      const expected =
        beat % 4 === 0 && seg.from === montageFrameOf(parsed.beats, beat)
      assert.equal(seg.down, expected)
    }
  })
})

describe('montage guards', () => {
  test('full-width question mark opens a video', () => {
    const raw = valid()
    raw.words[0].text = '为什么？'
    assert.doesNotThrow(() => parseMontageReelProps(raw))
  })

  test('one flash per bar, none mid-bar', () => {
    const parsed = parseMontageReelProps(valid())
    const segs = buildMontageSegments(parsed)
    for (const seg of segs) assert.equal('mid' in seg, false)
    assert.equal(segs.filter((s) => s.down).length, parsed.totalBeats / 4)
    assert.ok(maxFlashesPerSecond(segs) <= MONTAGE_MAX_FLASHES_PER_SEC)
  })

  test('maxFlashesPerSecond counts 4 flashes inside one second', () => {
    const seg = (from, down) => ({ from, dur: 6, clip: 0, start: 0, bw: false, down })
    const segs = [0, 6, 12, 18].map((from) => seg(from, true))
    segs.push(seg(24, false))
    assert.equal(maxFlashesPerSecond(segs), 4)
    assert.ok(maxFlashesPerSecond(segs) > MONTAGE_MAX_FLASHES_PER_SEC)
    assert.equal(maxFlashesPerSecond([seg(0, true), seg(30, true)]), 1)
  })

  test('recipe gaps are reported honestly', () => {
    const parsed = parseMontageReelProps(valid())
    assert.deepEqual(recipeGapsOf(parsed).map((g) => g.column), ['真实感'])
    for (const gap of recipeGapsOf(parsed)) assert.equal(gap.status, '未满足')

    const noPerson = valid()
    for (const clip of noPerson.clips) {
      if (clip.kind === 'person') clip.kind = 'detail'
    }
    assert.deepEqual(
      recipeGapsOf(parseMontageReelProps(noPerson)).map((g) => g.column),
      ['真人出镜/自拍感', '真实感'],
    )

    noPerson.clips[0].source = 'own'
    assert.deepEqual(
      recipeGapsOf(parseMontageReelProps(noPerson)).map((g) => g.column),
      ['真人出镜/自拍感'],
    )
  })
})
