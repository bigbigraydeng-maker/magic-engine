import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  AtmospherePropsSchema,
  parseAtmosphereProps,
  computeAtmosphereTiming,
  collectAtmosphereAssetFiles,
  resolveFades,
  MIN_DURATION_SEC,
  MAX_DURATION_SEC,
  LINE_UNITS,
  MAX_PUSH,
  TEXT_TOP_MIN,
  TEXT_TOP_MAX,
  FADE_IN_DEFAULT_SEC,
  FADE_OUT_DEFAULT_SEC,
  FADE_START_OPACITY,
} from '../src/atmosphere.ts'

import { formatZodIssues } from '../src/schema.ts'

// Fresh fictional fixture for every test.
const validProps = () => ({
  logoFile: 'logo.png',
  musicFile: null,
  clip: 'clips/main.mp4',
  durationSec: 15,
  line: {
    text: 'A calm main view',
    sourceUrl: 'https://example.com/view',
    sourceQuote: 'a calm main view of the water',
  },
})

// Clone the fixture, apply a mutation, and assert parsing rejects it.
const rejects = (mutate, expectedFragment) => {
  const props = validProps()
  mutate(props)
  assert.throws(
    () => parseAtmosphereProps(props),
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

describe('fixture', () => {
  test('valid props parse', () => {
    const props = parseAtmosphereProps(validProps())
    assert.equal(props.durationSec, 15)
    assert.equal(props.musicFile, null)
    assert.ok(props.line !== null)
  })

  test('constants are the documented values', () => {
    assert.equal(MIN_DURATION_SEC, 12)
    assert.equal(MAX_DURATION_SEC, 20)
    assert.equal(LINE_UNITS, 25)
    assert.equal(MAX_PUSH, 1.04)
    assert.equal(TEXT_TOP_MIN, 480)
    assert.equal(TEXT_TOP_MAX, 1100)
    assert.equal(FADE_IN_DEFAULT_SEC, 0.8)
    assert.equal(FADE_OUT_DEFAULT_SEC, 1.5)
    assert.equal(FADE_START_OPACITY, 0.6)
  })
})

describe('durationSec', () => {
  test('11.99 is rejected', () => {
    rejects((props) => {
      props.durationSec = 11.99
    }, '成片时长必须在 12 到 20 秒之间')
  })

  test('20.01 is rejected', () => {
    rejects((props) => {
      props.durationSec = 20.01
    }, '成片时长必须在 12 到 20 秒之间')
  })

  test('12 is accepted', () => {
    const props = validProps()
    props.durationSec = 12
    assert.equal(parseAtmosphereProps(props).durationSec, 12)
  })

  test('20 is accepted', () => {
    const props = validProps()
    props.durationSec = 20
    assert.equal(parseAtmosphereProps(props).durationSec, 20)
  })
})

describe('musicFile', () => {
  test('undefined is rejected', () => {
    rejects((props) => {
      delete props.musicFile
    })
  })

  test('null is accepted', () => {
    const props = validProps()
    props.musicFile = null
    assert.equal(parseAtmosphereProps(props).musicFile, null)
  })

  test('a music file is accepted', () => {
    const props = validProps()
    props.musicFile = 'music/track.mp3'
    assert.equal(parseAtmosphereProps(props).musicFile, 'music/track.mp3')
  })
})

describe('line', () => {
  test('null is accepted (no-text reel)', () => {
    const props = validProps()
    props.line = null
    assert.equal(parseAtmosphereProps(props).line, null)
  })

  test('a banned word is rejected', () => {
    rejects((props) => {
      props.line.text = 'Book now'
      props.line.sourceQuote = 'book now for the view'
    }, '促销词')
  })

  test('a price is rejected', () => {
    rejects((props) => {
      props.line.text = 'From $99'
      props.line.sourceQuote = 'from $99 per person'
    }, '画面文字里不许出现价格')
  })

  test('too wide text is rejected', () => {
    rejects((props) => {
      props.line.text = 'A'.repeat(60)
      props.line.sourceQuote = 'A'.repeat(60)
    }, '文字太宽')
  })

  test('a bad sourceUrl is rejected', () => {
    rejects((props) => {
      props.line.sourceUrl = 'ftp://x'
    }, '出处链接必须是 http 或 https 网址')
  })

  test('a quote that does not support the text is rejected', () => {
    rejects((props) => {
      props.line.sourceQuote = 'completely unrelated words here'
    }, '出处片段里找不到这句话的主要词')
  })
})

describe('textTop', () => {
  test('479 is rejected', () => {
    rejects((props) => {
      props.textTop = 479
    }, 'textTop 必须在 480 到 1100 之间')
  })

  test('1101 is rejected', () => {
    rejects((props) => {
      props.textTop = 1101
    }, 'textTop 必须在 480 到 1100 之间')
  })

  test('480 is accepted', () => {
    const props = validProps()
    props.textTop = 480
    assert.equal(parseAtmosphereProps(props).textTop, 480)
  })

  test('1100 is accepted', () => {
    const props = validProps()
    props.textTop = 1100
    assert.equal(parseAtmosphereProps(props).textTop, 1100)
  })
})

describe('push', () => {
  test('1.05 is rejected', () => {
    rejects((props) => {
      props.push = 1.05
    }, '推镜倍数必须在 1 到 1.04 之间')
  })

  test('1.04 is accepted', () => {
    const props = validProps()
    props.push = 1.04
    assert.equal(parseAtmosphereProps(props).push, 1.04)
  })
})

describe('crop', () => {
  test('x + w > 1 is rejected', () => {
    rejects((props) => {
      props.crop = { x: 0.5, y: 0, w: 0.6, h: 1 }
    }, '裁剪区域超出画面')
  })

  test('y + h > 1 is rejected', () => {
    rejects((props) => {
      props.crop = { x: 0, y: 0.5, w: 1, h: 0.6 }
    }, '裁剪区域超出画面')
  })

  test('a valid crop is accepted', () => {
    const props = validProps()
    props.crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }
    const parsed = parseAtmosphereProps(props)
    assert.deepEqual(parsed.crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
  })
})

describe('strictness', () => {
  test('an unknown top-level key is rejected', () => {
    rejects((props) => {
      props.extra = true
    })
  })

  test('a price key is rejected (no price field exists)', () => {
    rejects((props) => {
      props.price = { amount: 100 }
    })
  })
})

describe('fades', () => {
  test('fadeInSec 0.5 is rejected', () => {
    rejects((props) => {
      props.fadeInSec = 0.5
    }, '淡入时长必须在 0.6 到 1.5 秒之间')
  })

  test('resolveFades applies the defaults', () => {
    const fades = resolveFades(parseAtmosphereProps(validProps()))
    assert.equal(fades.fadeInSec, FADE_IN_DEFAULT_SEC)
    assert.equal(fades.fadeOutSec, FADE_OUT_DEFAULT_SEC)
  })
})

describe('timing', () => {
  test('durationSec 15 gives 450 frames with default fades and sourceIn 2.5', () => {
    const props = validProps()
    props.durationSec = 15
    props.sourceIn = 2.5
    const timing = computeAtmosphereTiming(parseAtmosphereProps(props))
    assert.equal(timing.totalFrames, 450)
    assert.equal(timing.fadeInFrames, 24)
    assert.equal(timing.fadeOutFrames, 45)
    assert.equal(timing.sourceInFrames, 75)
  })
})

describe('asset collection', () => {
  test('lists clip and logo once each and omits null music', () => {
    const files = collectAtmosphereAssetFiles(parseAtmosphereProps(validProps()))
    assert.deepEqual(files, ['clips/main.mp4', 'logo.png'])
    assert.equal(new Set(files).size, files.length)
  })

  test('includes the music file when present', () => {
    const props = validProps()
    props.musicFile = 'music/track.mp3'
    const files = collectAtmosphereAssetFiles(parseAtmosphereProps(props))
    assert.deepEqual(files, ['clips/main.mp4', 'logo.png', 'music/track.mp3'])
  })
})

describe('error text', () => {
  test('formatZodIssues produces one line per issue', () => {
    const result = AtmospherePropsSchema.safeParse({})
    assert.equal(result.success, false)
    const text = formatZodIssues(result.error)
    assert.ok(text.split('\n').length >= 1)
    assert.ok(text.includes('字段 '))
  })
})

describe('source quote promo scan', () => {
  test('a promotional phrase inside the source quote is rejected', () => {
    const props = validProps()
    props.line = { text: 'A calm main view', sourceUrl: 'https://example.com/page', sourceQuote: 'A calm main view of the place. Book now' }
    assert.throws(() => parseAtmosphereProps(props), /促销词/)
  })
})
