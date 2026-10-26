import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  ListReelPropsSchema,
  parseListReelProps,
  collectAssetFiles,
  formatZodIssues,
  MIN_ITEMS,
  MAX_ITEMS,
} from '../src/schema.ts'

import {
  computeTiming,
  computeTimingFromProps,
  FPS,
  HOOK_BEATS,
  ITEM_BEATS,
  LOGO_BEATS,
  REVEAL_BEATS,
  SYNC_SHIFT_FRAMES,
} from '../src/timing.ts'

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

// Clone the fixture, apply a mutation, and assert parsing rejects it.
const rejects = (mutate, expectedFragment) => {
  const props = valid()
  mutate(props)
  assert.throws(
    () => parseListReelProps(props),
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.startsWith('props 校验失败'),
        `expected message to start with 'props 校验失败', got: ${err.message}`,
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

// Build n strictly increasing beats at 0.5 s steps starting at 0.2.
const grid = (n) => {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(Math.round((0.2 + 0.5 * i) * 1000) / 1000)
  }
  return out
}

// Build a props object with a given number of items and beats.
const withItems = (count, beats) => {
  const props = valid()
  const base = props.items[0]
  props.items = []
  for (let i = 0; i < count; i++) {
    props.items.push({ ...base, clip: `clips/item${i + 1}.mp4` })
  }
  props.beats = beats
  return props
}

describe('fixture and asset collection', () => {
  test('the fixture is accepted', () => {
    const props = parseListReelProps(valid())
    assert.equal(props.items.length, 4)
    assert.equal(props.musicFile, null)
  })

  test('collectAssetFiles returns 7 unique names for the fixture', () => {
    const files = collectAssetFiles(parseListReelProps(valid()))
    assert.equal(files.length, 7)
    assert.equal(new Set(files).size, 7)
    assert.ok(files.includes('logo.png'))
    assert.ok(files.includes('clips/hook.mp4'))
    assert.ok(files.includes('clips/item1.mp4'))
    assert.ok(files.includes('clips/item4.mp4'))
    assert.ok(files.includes('clips/price.mp4'))
  })

  test('a music file is accepted and then included', () => {
    const props = valid()
    props.musicFile = 'music/track.mp3'
    const parsed = parseListReelProps(props)
    const files = collectAssetFiles(parsed)
    assert.equal(files.length, 8)
    assert.ok(files.includes('music/track.mp3'))
  })
})

describe('missing fields', () => {
  const topLevelKeys = [
    'brandColor',
    'itemOverlayOpacity',
    'logoFile',
    'musicFile',
    'beats',
    'hook',
    'items',
    'itemLabel',
    'revealTitle',
    'price',
  ]

  for (const key of topLevelKeys) {
    test(`deleting top-level key ${key} is rejected`, () => {
      rejects((props) => {
        delete props[key]
      })
    })
  }

  test('deleting price.amount is rejected', () => {
    rejects((props) => {
      delete props.price.amount
    })
  })

  test('deleting hook.clip is rejected', () => {
    rejects((props) => {
      delete props.hook.clip
    })
  })

  test('deleting items[0].blurBackdrop is rejected', () => {
    rejects((props) => {
      delete props.items[0].blurBackdrop
    })
  })

  test('deleting a hook line badge is rejected', () => {
    rejects((props) => {
      delete props.hook.lines[0].badge
    })
  })
})

describe('extra fields', () => {
  test('an unknown top-level key is rejected', () => {
    rejects((props) => {
      props.extra = true
    })
  })

  test('an unknown key inside price is rejected', () => {
    rejects((props) => {
      props.price.extra = true
    })
  })

  test('an unknown key inside hook is rejected', () => {
    rejects((props) => {
      props.hook.extra = true
    })
  })

  test('an unknown key inside an item is rejected', () => {
    rejects((props) => {
      props.items[0].extra = true
    })
  })

  test('an unknown key inside a hook line is rejected', () => {
    rejects((props) => {
      props.hook.lines[0].extra = true
    })
  })
})

describe('hook lines tuple', () => {
  test('two hook lines are rejected', () => {
    rejects((props) => {
      props.hook.lines = props.hook.lines.slice(0, 2)
    })
  })

  test('four hook lines are rejected', () => {
    rejects((props) => {
      props.hook.lines = [...props.hook.lines, { badge: null, text: 'EXTRA' }]
    })
  })
})

describe('text length and content', () => {
  test('item text of 49 chars is rejected', () => {
    rejects((props) => {
      props.items[0].text = 'A'.repeat(49)
    })
  })

  test('hook line text of 10 chars is rejected, 9 accepted', () => {
    rejects((props) => {
      props.hook.lines[1].text = 'A'.repeat(10)
    })
    const ok = valid()
    ok.hook.lines[1].text = 'A'.repeat(9)
    assert.doesNotThrow(() => parseListReelProps(ok))
  })

  test('hook line wider than the budget (badge + space + text > 9) is rejected', () => {
    rejects((props) => {
      props.hook.lines[0].badge = '27'
      props.hook.lines[0].text = 'A'.repeat(7)
    }, '开场第 1 行太长')
    const ok = valid()
    ok.hook.lines[0].badge = '27'
    ok.hook.lines[0].text = 'A'.repeat(6)
    assert.doesNotThrow(() => parseListReelProps(ok))
  })

  test('hook badge of 7 chars is rejected', () => {
    rejects((props) => {
      props.hook.lines[0].badge = 'A'.repeat(7)
    })
  })

  test('footnote of 81 chars is rejected', () => {
    rejects((props) => {
      props.price.footnote = 'A'.repeat(81)
    })
  })

  test('currencyPrefix of 7 chars is rejected', () => {
    rejects((props) => {
      props.price.currencyPrefix = 'A'.repeat(7)
    })
  })

  test('an empty string is rejected', () => {
    rejects((props) => {
      props.items[0].text = ''
    })
  })

  test('a control character is rejected', () => {
    rejects((props) => {
      props.items[0].text = 'BAD\u0007TEXT'
    })
  })

  test('an item text of exactly 48 chars is accepted', () => {
    const props = valid()
    props.items[0].text = 'A'.repeat(48)
    assert.doesNotThrow(() => parseListReelProps(props))
  })
})

describe('unsafe file references', () => {
  const badPaths = [
    'https://example.com/a',
    'file:///tmp/a',
    '/etc/passwd',
    '../a',
    'clips/../a',
    'clips\\a',
    'C:/a',
    'a?x=1',
    'clips/a b',
  ]

  // Each file field with its own valid extension appended to the bad path.
  const fields = [
    { name: 'logoFile', ext: '.png', set: (p, v) => (p.logoFile = v) },
    { name: 'musicFile', ext: '.mp3', set: (p, v) => (p.musicFile = v) },
    { name: 'hook.clip', ext: '.mp4', set: (p, v) => (p.hook.clip = v) },
    { name: 'items[0].clip', ext: '.mp4', set: (p, v) => (p.items[0].clip = v) },
    {
      name: 'price.backdropClip',
      ext: '.mp4',
      set: (p, v) => (p.price.backdropClip = v),
    },
  ]

  for (const field of fields) {
    for (const bad of badPaths) {
      test(`${field.name} rejects ${bad}${field.ext}`, () => {
        rejects((props) => field.set(props, bad + field.ext))
      })
    }

    test(`${field.name} rejects a wrong extension`, () => {
      rejects((props) => field.set(props, 'clips/a.exe'))
    })
  }

  test('a nested relative path is accepted', () => {
    const props = valid()
    props.items[0].clip = 'clips/sub/a.mp4'
    assert.doesNotThrow(() => parseListReelProps(props))
  })
})

describe('item count', () => {
  test('two items are rejected', () => {
    rejects((props) => {
      props.items = props.items.slice(0, 2)
    })
  })

  test('eight items are rejected with the item count rule', () => {
    const props = withItems(8, grid(30))
    assert.throws(
      () => parseListReelProps(props),
      (err) => {
        assert.ok(err.message.startsWith('props 校验失败'))
        assert.ok(
          err.message.includes('条目数量最多'),
          `expected item count rule, got: ${err.message}`,
        )
        return true
      },
    )
  })

  test('three items are accepted with 19 beats', () => {
    const props = withItems(3, grid(19))
    assert.doesNotThrow(() => parseListReelProps(props))
  })

  test('seven items are accepted with 27 beats', () => {
    const props = withItems(7, grid(27))
    assert.doesNotThrow(() => parseListReelProps(props))
  })

  test('MIN_ITEMS and MAX_ITEMS are 3 and 7', () => {
    assert.equal(MIN_ITEMS, 3)
    assert.equal(MAX_ITEMS, 7)
  })
})

describe('brandColor', () => {
  for (const bad of ['red', '#fff', '#GGGGGG', 'D11D3A', '#D11D3A00']) {
    test(`rejects ${bad}`, () => {
      rejects((props) => {
        props.brandColor = bad
      })
    })
  }

  for (const good of ['#0b6e99', '#0B6E99']) {
    test(`accepts ${good}`, () => {
      const props = valid()
      props.brandColor = good
      assert.doesNotThrow(() => parseListReelProps(props))
    })
  }
})

describe('itemOverlayOpacity', () => {
  test('rejects -0.1', () => {
    rejects((props) => {
      props.itemOverlayOpacity = -0.1
    })
  })

  test('rejects 0.61', () => {
    rejects((props) => {
      props.itemOverlayOpacity = 0.61
    })
  })

  test("rejects '0.4'", () => {
    rejects((props) => {
      props.itemOverlayOpacity = '0.4'
    })
  })

  for (const good of [0, 0.6, 0.4]) {
    test(`accepts ${good}`, () => {
      const props = valid()
      props.itemOverlayOpacity = good
      assert.doesNotThrow(() => parseListReelProps(props))
    })
  }
})

describe('beats', () => {
  test('a duplicate value is rejected', () => {
    rejects((props) => {
      props.beats[5] = props.beats[4]
    })
  })

  test('a decreasing value is rejected', () => {
    rejects((props) => {
      props.beats[5] = props.beats[4] - 0.1
    })
  })

  test('a negative value is rejected', () => {
    rejects((props) => {
      props.beats[0] = -1
    })
  })

  test('too few beats for the item count is rejected', () => {
    const props = withItems(4, grid(20))
    assert.throws(
      () => parseListReelProps(props),
      (err) => {
        assert.ok(err.message.startsWith('props 校验失败'))
        assert.ok(
          err.message.includes('节拍数量不够'),
          `expected beat count rule, got: ${err.message}`,
        )
        return true
      },
    )
  })

  test('an ending beat above 90 seconds is rejected', () => {
    const beats = grid(30)
    beats[20] = 95
    for (let i = 21; i < beats.length; i++) {
      beats[i] = 95 + (i - 20) * 0.5
    }
    const props = withItems(4, beats)
    assert.throws(
      () => parseListReelProps(props),
      (err) => {
        assert.ok(err.message.startsWith('props 校验失败'))
        assert.ok(
          err.message.includes('90'),
          `expected 90 second rule, got: ${err.message}`,
        )
        return true
      },
    )
  })

  test('a beats array of 81 entries is rejected', () => {
    rejects((props) => {
      props.beats = grid(81)
    })
  })
})

describe('price.amount', () => {
  for (const bad of [0, -5, 1.5, '1250000', 10000000]) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      rejects((props) => {
        props.price.amount = bad
      })
    })
  }

  test('accepts 9999999', () => {
    const props = valid()
    props.price.amount = 9999999
    assert.doesNotThrow(() => parseListReelProps(props))
  })
})

describe('non-object input', () => {
  for (const bad of [null, [], 'x', 42]) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => parseListReelProps(bad),
        (err) => {
          assert.ok(err instanceof Error)
          assert.ok(err.message.startsWith('props 校验失败'))
          return true
        },
      )
    })
  }
})

describe('error text', () => {
  test('is human readable and names the field', () => {
    const props = valid()
    props.items[0].clip = 'https://x.com/a.mp4'
    assert.throws(
      () => parseListReelProps(props),
      (err) => {
        assert.ok(err.message.includes('字段 items.0.clip'))
        assert.ok(err.message.includes('相对文件名'))
        return true
      },
    )
  })

  test('formatZodIssues produces one line per issue', () => {
    const result = ListReelPropsSchema.safeParse({})
    assert.equal(result.success, false)
    const text = formatZodIssues(result.error)
    assert.ok(text.split('\n').length >= 1)
    assert.ok(text.includes('字段 '))
  })
})

describe('no defaults', () => {
  test('parseListReelProps({}) throws and mentions every top-level key', () => {
    const keys = [
      'brandColor',
      'itemOverlayOpacity',
      'logoFile',
      'musicFile',
      'beats',
      'hook',
      'items',
      'itemLabel',
      'revealTitle',
      'price',
    ]
    assert.throws(
      () => parseListReelProps({}),
      (err) => {
        assert.ok(err.message.startsWith('props 校验失败'))
        for (const key of keys) {
          assert.ok(
            err.message.includes(`字段 ${key}`),
            `expected message to mention '字段 ${key}', got: ${err.message}`,
          )
        }
        return true
      },
    )
  })
})

describe('timing', () => {
  test('the fixture produces the expected layout', () => {
    const timing = computeTimingFromProps(valid())
    assert.equal(timing.hookFrames, 67)
    assert.deepEqual(timing.itemFrom, [67, 97, 127, 157])
    assert.equal(timing.revealFrom, 187)
    assert.equal(timing.totalFrames, 307)
    assert.equal(timing.logoFrom, 277)
  })

  test('the logo appears only during the last LOGO_BEATS beats', () => {
    const timing = computeTimingFromProps(valid())
    assert.equal(LOGO_BEATS, 2)
    assert.ok(timing.logoFrom >= timing.revealFrom)
    assert.ok(timing.logoFrom < timing.totalFrames)
  })

  test('three items produce three item slots', () => {
    const beats = grid(30)
    const timing = computeTiming(beats, 3)
    assert.equal(timing.itemFrom.length, 3)
    assert.equal(timing.totalFrames, Math.round(beats[2 * 3 + 12] * 30) + 1)
  })

  test('seven items produce seven item slots', () => {
    const beats = grid(30)
    const timing = computeTiming(beats, 7)
    assert.equal(timing.itemFrom.length, 7)
    assert.equal(timing.totalFrames, Math.round(beats[2 * 7 + 12] * 30) + 1)
  })

  test('too few beats throws', () => {
    assert.throws(
      () => computeTiming(grid(5), 4),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('节拍数量不够'))
        return true
      },
    )
  })

  test('constants are consistent', () => {
    assert.equal(FPS, 30)
    assert.equal(HOOK_BEATS, 4)
    assert.equal(ITEM_BEATS, 2)
    assert.equal(REVEAL_BEATS, 8)
    assert.equal(SYNC_SHIFT_FRAMES, 1)
  })

  test('a video shorter than the minimum length throws', () => {
    // 4 items, beats 10 ms apart: every scene is only a frame or so long
    const tiny = Array.from({ length: 30 }, (_, i) => 0.2 + i * 0.01)
    assert.throws(
      () => computeTiming(tiny, 4),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('太近') || err.message.includes('太短'))
        return true
      },
    )
  })
})

describe('logoMode', () => {
  test('props without logoMode still parse and stay undefined', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.logoMode, undefined)
  })

  test("logoMode 'last_beats' is accepted", () => {
    const props = valid()
    props.logoMode = 'last_beats'
    assert.doesNotThrow(() => parseListReelProps(props))
  })

  test("logoMode 'always' is accepted", () => {
    const props = valid()
    props.logoMode = 'always'
    assert.doesNotThrow(() => parseListReelProps(props))
  })

  test("logoMode 'forever' is rejected", () => {
    rejects((props) => {
      props.logoMode = 'forever'
    })
  })

  test('logoMode null is rejected', () => {
    rejects((props) => {
      props.logoMode = null
    })
  })

  test('the default timing is unchanged (regression)', () => {
    const props = valid()
    const fromProps = computeTimingFromProps(props)
    const fromBeats = computeTiming(props.beats, props.items.length)
    const explicit = computeTiming(props.beats, props.items.length, 'last_beats')
    assert.deepEqual(fromProps, fromBeats)
    assert.deepEqual(fromProps, explicit)
  })

  test("logoMode 'always' starts the logo at frame 0 and changes nothing else", () => {
    const props = valid()
    const base = computeTimingFromProps(props)
    const always = computeTimingFromProps({ ...props, logoMode: 'always' })
    assert.equal(always.logoFrom, 0)
    assert.equal(always.hookFrames, base.hookFrames)
    assert.deepEqual(always.itemFrom, base.itemFrom)
    assert.deepEqual(always.itemDur, base.itemDur)
    assert.equal(always.revealFrom, base.revealFrom)
    assert.equal(always.totalFrames, base.totalFrames)
  })
})

describe('readability options', () => {
  test('props without the new fields still parse and stay undefined', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.cutFlash, undefined)
    assert.equal(parsed.price.footnoteSize, undefined)
  })

  test('deleting price.dateLine now parses OK and stays undefined', () => {
    const props = valid()
    delete props.price.dateLine
    const parsed = parseListReelProps(props)
    assert.equal(parsed.price.dateLine, undefined)
  })

  test('price.dateLine of an empty string is still rejected', () => {
    rejects((props) => {
      props.price.dateLine = ''
    })
  })

  test('footnoteSize 38 is accepted', () => {
    const props = valid()
    props.price.footnoteSize = 38
    assert.doesNotThrow(() => parseListReelProps(props))
  })

  for (const bad of [29, 61, 38.5, '38']) {
    test(`footnoteSize ${JSON.stringify(bad)} is rejected`, () => {
      rejects((props) => {
        props.price.footnoteSize = bad
      })
    })
  }

  for (const good of [true, false]) {
    test(`cutFlash ${good} is accepted`, () => {
      const props = valid()
      props.cutFlash = good
      assert.doesNotThrow(() => parseListReelProps(props))
    })
  }

  for (const bad of ['no', null]) {
    test(`cutFlash ${JSON.stringify(bad)} is rejected`, () => {
      rejects((props) => {
        props.cutFlash = bad
      })
    })
  }
})

// Music, montage and template tests ride along with this file because package.json (an A-level path) lists test files explicitly.
import './music.test.mjs'
import './music-excerpt.test.mjs'
import './montage.test.mjs'
import './templates.test.mjs'

describe('footageScrim', () => {
  test('props without footageScrim still parse and stay undefined', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.footageScrim, undefined)
  })

  test('footageScrim between 0 and 1 is accepted', () => {
    for (const good of [0, 0.35, 1]) {
      const props = valid()
      props.footageScrim = good
      assert.equal(parseListReelProps(props).footageScrim, good)
    }
  })

  test('footageScrim out of range or non-number is rejected', () => {
    for (const bad of [-0.1, 1.01, '0.4', null]) {
      rejects((props) => {
        props.footageScrim = bad
      })
    }
  })
})
import './datacard.test.mjs'

describe('price/label layout options', () => {
  test('corner layout, qualifierSize, footnoteBackdrop and itemLabelSize are accepted', () => {
    const props = valid()
    props.price.layout = 'corner'
    props.price.qualifier = 'FLIGHTS INCLUDED'
    props.price.footnote = 'PER PERSON'
    delete props.price.dateLine
    props.price.qualifierSize = 48
    props.price.footnoteBackdrop = true
    props.itemLabelSize = 52
    const parsed = parseListReelProps(props)
    assert.equal(parsed.price.layout, 'corner')
    assert.equal(parsed.price.qualifierSize, 48)
    assert.equal(parsed.price.footnoteBackdrop, true)
    assert.equal(parsed.itemLabelSize, 52)
  })

  test("price.layout 'left' is rejected", () => {
    rejects((props) => {
      props.price.layout = 'left'
    })
  })

  for (const bad of [29, 61]) {
    test(`qualifierSize ${bad} is rejected`, () => {
      rejects((props) => {
        props.price.qualifierSize = bad
      })
    })
  }

  for (const bad of [29, 65]) {
    test(`itemLabelSize ${bad} is rejected`, () => {
      rejects((props) => {
        props.itemLabelSize = bad
      })
    })
  }

  test('the unmodified fixture still parses (defaults)', () => {
    const parsed = parseListReelProps(valid())
    assert.equal(parsed.price.layout, undefined)
    assert.equal(parsed.price.qualifierSize, undefined)
    assert.equal(parsed.price.footnoteBackdrop, undefined)
    assert.equal(parsed.itemLabelSize, undefined)
  })
})

describe('corner layout safe-zone guard', () => {
  test('corner layout rejects oversized qualifier/footnote text', () => {
    const a = valid()
    a.price.layout = 'corner'
    a.price.qualifierSize = 49
    assert.throws(() => parseListReelProps(a), /右下小卡/)
    const b = valid()
    b.price.layout = 'corner'
    b.price.footnoteSize = 41
    assert.throws(() => parseListReelProps(b), /右下小卡/)
    const c = valid()
    c.price.layout = 'corner'
    c.price.footnote = 'X'.repeat(27)
    assert.throws(() => parseListReelProps(c), /右下小卡/)
    const d = valid()
    d.price.layout = 'corner'
    d.price.dateLine = 'Y'.repeat(25)
    assert.throws(() => parseListReelProps(d), /右下小卡/)
  })
  test('corner layout accepts the boundary sizes; centre layout keeps the full range', () => {
    const a = valid()
    a.price.layout = 'corner'
    a.price.qualifierSize = 48
    a.price.footnoteSize = 40
    a.price.footnote = 'F'.repeat(26)
    a.price.qualifier = 'Q'.repeat(26)
    a.price.dateLine = 'D'.repeat(24)
    assert.doesNotThrow(() => parseListReelProps(a))
    const b = valid()
    b.price.layout = 'center'
    b.price.qualifierSize = 60
    b.price.footnoteSize = 60
    assert.doesNotThrow(() => parseListReelProps(b))
  })
  test('footnoteBackdrop must be a boolean; size boundaries 30/60/64 are accepted', () => {
    const a = valid()
    a.price.footnoteBackdrop = 'yes'
    assert.throws(() => parseListReelProps(a))
    const b = valid()
    b.price.qualifierSize = 30
    b.itemLabelSize = 64
    assert.doesNotThrow(() => parseListReelProps(b))
  })
})

describe('revealTitleSize', () => {
  test('accepts 36..60 and rejects outside', () => {
    for (const ok of [36, 48, 60]) {
      const p = valid()
      p.revealTitleSize = ok
      assert.equal(parseListReelProps(p).revealTitleSize, ok)
    }
    for (const bad of [35, 61, 47.5]) {
      const p = valid()
      p.revealTitleSize = bad
      assert.throws(() => parseListReelProps(p))
    }
  })
})
