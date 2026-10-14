import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  PostcardPropsSchema,
  parsePostcardProps,
  computePostcardTiming,
  collectPostcardAssetFiles,
  textWidthUnits,
  bannedWordHits,
  MIN_SCENES,
  MAX_SCENES,
  MAX_TOTAL_SEC,
  MAX_HOOK_LINES,
  HOOK_LINE_UNITS,
  SCENE_LINE_UNITS,
  PLACE_UNITS,
} from '../src/postcard.ts'

import { formatZodIssues } from '../src/schema.ts'

// Fresh fictional fixture for every test.
const validProps = () => ({
  brandColor: '#0b6e99',
  logoFile: 'logo.png',
  musicFile: null,
  cardOpacity: 0.4,
  cardSide: 'left',
  hook: {
    clip: 'clips/hook.mp4',
    lines: ['QUIET', 'HARBOUR'],
  },
  scenes: [
    {
      clip: 'clips/a.mp4',
      place: 'Fictional Harbour',
      line: 'The harbour wakes slowly',
      sourceUrl: 'https://example.com/tour',
      sourceQuote: 'the harbour wakes slowly at dawn',
      placeSourceQuote: 'fictional harbour is a quiet place',
    },
    {
      clip: 'clips/b.mp4',
      place: 'Example Bay',
      line: 'Boats drift past the pier',
      sourceUrl: 'https://example.com/bay',
      sourceQuote: 'boats drift past the pier each morning',
      placeSourceQuote: 'example bay has a long pier',
    },
  ],
  price: {
    backdropClip: 'clips/price.mp4',
    fromLabel: 'From',
    currencyPrefix: '$',
    amount: 1200,
    qualifier: 'per person',
    footnote: 'Sample itinerary only',
  },
  timing: {
    hookSec: 3,
    sceneSec: 4,
    priceSec: 6,
  },
})

// Clone the fixture, apply a mutation, and assert parsing rejects it.
const rejects = (mutate, expectedFragment) => {
  const props = validProps()
  mutate(props)
  assert.throws(
    () => parsePostcardProps(props),
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
    const props = parsePostcardProps(validProps())
    assert.equal(props.scenes.length, 2)
    assert.equal(props.musicFile, null)
  })

  test('constants are the documented values', () => {
    assert.equal(MIN_SCENES, 2)
    assert.equal(MAX_SCENES, 4)
    assert.equal(MAX_TOTAL_SEC, 25)
    assert.equal(MAX_HOOK_LINES, 3)
    assert.equal(HOOK_LINE_UNITS, 8.7)
    assert.equal(SCENE_LINE_UNITS, 25)
    assert.equal(PLACE_UNITS, 19)
  })
})

describe('scene count', () => {
  test('one scene is rejected', () => {
    rejects((props) => {
      props.scenes = props.scenes.slice(0, 1)
    })
  })

  test('five scenes are rejected', () => {
    rejects((props) => {
      const base = props.scenes[0]
      props.scenes = [
        { ...base, clip: 'clips/a.mp4' },
        { ...base, clip: 'clips/b.mp4' },
        { ...base, clip: 'clips/c.mp4' },
        { ...base, clip: 'clips/d.mp4' },
        { ...base, clip: 'clips/e.mp4' },
      ]
    })
  })
})

describe('extra fields', () => {
  test('an unknown top-level key is rejected', () => {
    rejects((props) => {
      props.extra = true
    })
  })

  test('an unknown key inside a scene is rejected', () => {
    rejects((props) => {
      props.scenes[0].extra = true
    })
  })
})

describe('text width', () => {
  test('textWidthUnits measures latin, CJK and spaces', () => {
    assert.equal(textWidthUnits('abc'), 1.65)
    assert.equal(textWidthUnits('日本語'), 3)
    assert.equal(textWidthUnits('a b'), 1.4)
  })

  test('a hook line over the budget is rejected', () => {
    rejects((props) => {
      props.hook.lines = ['A very long hook line indeed']
    }, '开场第 1 行太宽')
  })

  test('a 13-char Chinese hook line is rejected', () => {
    rejects((props) => {
      props.hook.lines = ['这是一个非常长的中文开场句子']
    }, '开场第 1 行太宽')
  })

  test('a scene line over 25 units is rejected', () => {
    rejects((props) => {
      props.scenes[0].line = 'A'.repeat(60)
    }, '第 1 段文字太宽')
  })
})

describe('banned words', () => {
  test('flags English and Chinese promotional phrases', () => {
    assert.ok(bannedWordHits('Early Bird price').length > 0)
    assert.ok(bannedWordHits('Book NOW').length > 0)
    assert.ok(bannedWordHits('only 3 seats left').length > 0)
    assert.ok(bannedWordHits('限时优惠').length > 0)
    assert.ok(bannedWordHits('最后机会').length > 0)
  })

  test('does not flag allowed wording', () => {
    assert.deepEqual(bannedWordHits('unlimited access'), [])
    assert.deepEqual(bannedWordHits('limited'), [])
    assert.deepEqual(bannedWordHits('a 12-person small group'), [])
  })

  test('a banned word inside a scene line is rejected by the schema', () => {
    rejects((props) => {
      props.scenes[0].line = 'Book now for the harbour tour'
    }, '促销词')
  })
})

describe('sourceUrl', () => {
  test('a non-http url is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'ftp://x'
    })
  })
})

describe('source quote relevance', () => {
  test('a quote sharing no word with the line is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceQuote = 'completely unrelated words here'
    }, '出处片段里找不到这句话的主要词')
  })

  test('a place quote sharing no word with the place is rejected', () => {
    rejects((props) => {
      props.scenes[0].placeSourceQuote = 'completely unrelated words here'
    }, '出处片段里找不到这句话的主要词')
  })
})

describe('total duration', () => {
  test('over 25 seconds is rejected', () => {
    rejects((props) => {
      props.timing.hookSec = 4
      props.timing.sceneSec = 6
      props.timing.priceSec = 8
      const base = props.scenes[0]
      props.scenes = [
        { ...base, clip: 'clips/a.mp4' },
        { ...base, clip: 'clips/b.mp4' },
        { ...base, clip: 'clips/c.mp4' },
        { ...base, clip: 'clips/d.mp4' },
      ]
    }, '成片总时长不能超过')
  })
})

describe('timing', () => {
  test('two scenes produce the expected frame layout', () => {
    const props = validProps()
    props.timing.hookSec = 3.2
    props.timing.sceneSec = 3.6
    props.timing.priceSec = 6
    const timing = computePostcardTiming(parsePostcardProps(props))
    assert.equal(timing.hookFrames, 96)
    assert.deepEqual(timing.sceneFrom, [96, 204])
    assert.deepEqual(timing.sceneDur, [108, 108])
    assert.equal(timing.priceFrom, 312)
    assert.equal(timing.totalFrames, 492)
  })
})

describe('asset collection', () => {
  test('de-duplicates a repeated clip and omits null music', () => {
    const props = validProps()
    props.scenes[1].clip = 'clips/a.mp4'
    const files = collectPostcardAssetFiles(parsePostcardProps(props))
    assert.deepEqual(files, [
      'clips/hook.mp4',
      'clips/a.mp4',
      'clips/price.mp4',
      'logo.png',
    ])
  })

  test('includes the music file when present', () => {
    const props = validProps()
    props.musicFile = 'music/track.mp3'
    const files = collectPostcardAssetFiles(parsePostcardProps(props))
    assert.ok(files.includes('music/track.mp3'))
    assert.equal(files.length, 6)
  })
})

describe('error text', () => {
  test('formatZodIssues produces one line per issue', () => {
    const result = PostcardPropsSchema.safeParse({})
    assert.equal(result.success, false)
    const text = formatZodIssues(result.error)
    assert.ok(text.split('\n').length >= 1)
    assert.ok(text.includes('字段 '))
  })
})
