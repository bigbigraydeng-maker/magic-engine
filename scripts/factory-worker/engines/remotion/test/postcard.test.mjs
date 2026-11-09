import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  PostcardPropsSchema,
  parsePostcardProps,
  computePostcardTiming,
  collectPostcardAssetFiles,
  textWidthUnits,
  bannedWordHits,
  priceMentionHits,
  normalizeForScan,
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
  end: null,
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

  test('textWidthUnits uppercase latin counts 0.7 per letter', () => {
    assert.equal(textWidthUnits('ABC', true), 2.1)
    assert.equal(textWidthUnits('ABC'), 1.65)
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

describe('banned words (extended)', () => {
  test('flags new English promotional phrases', () => {
    assert.ok(bannedWordHits('Limited places').length > 0)
    assert.ok(bannedWordHits('limited-seats').length > 0)
    assert.ok(bannedWordHits('LAST-CHANCE').length > 0)
    assert.ok(bannedWordHits('Last\u200B chance').length > 0)
    assert.ok(bannedWordHits('last\u00A0chance').length > 0)
    assert.ok(bannedWordHits('book-now').length > 0)
    assert.ok(bannedWordHits('Ends soon').length > 0)
    assert.ok(bannedWordHits('only three left').length > 0)
  })

  test('flags new Chinese promotional phrases', () => {
    assert.ok(bannedWordHits('限定名额').length > 0)
    assert.ok(bannedWordHits('限時').length > 0)
    assert.ok(bannedWordHits('截至周五').length > 0)
    assert.ok(bannedWordHits('抢购').length > 0)
    assert.ok(bannedWordHits('名 额').length > 0)
  })

  test('does not flag allowed wording (extended)', () => {
    assert.deepEqual(bannedWordHits('Unlimited access'), [])
    assert.deepEqual(bannedWordHits('limited edition'), [])
    assert.deepEqual(bannedWordHits('a 12-person group'), [])
    assert.deepEqual(bannedWordHits('限 12 人小团'), [])
  })

  test('normalizeForScan strips zero-width and collapses separators', () => {
    assert.equal(normalizeForScan('Last\u200B chance'), 'Last chance')
    assert.equal(normalizeForScan('book-now'), 'book now')
    assert.equal(normalizeForScan('a\u00A0b'), 'a b')
  })

  test('a hook line with a zero-width-joined banned word is rejected', () => {
    rejects((props) => {
      props.hook.lines = ['Last\u200B chance']
    }, '促销词')
  })
})

describe('banned words (curly quotes and new phrases)', () => {
  test('flags a curly-apostrophe banned phrase', () => {
    assert.ok(bannedWordHits('Don\u2019t miss out').length > 0)
  })

  test('flags new English promotional phrases', () => {
    assert.ok(bannedWordHits('Book soon').length > 0)
    assert.ok(bannedWordHits('Closes soon').length > 0)
    assert.ok(bannedWordHits('Booking closes Friday').length > 0)
    assert.ok(bannedWordHits('Final call').length > 0)
    assert.ok(bannedWordHits('Going fast').length > 0)
    assert.ok(bannedWordHits('Few seats').length > 0)
    assert.ok(bannedWordHits('Sale ends Friday').length > 0)
    assert.ok(bannedWordHits('While stocks last').length > 0)
    assert.ok(bannedWordHits('Prices rise soon').length > 0)
    assert.ok(bannedWordHits('Seats are limited').length > 0)
    assert.ok(bannedWordHits('This offer expired').length > 0)
  })

  test('flags new Chinese promotional phrases', () => {
    assert.ok(bannedWordHits('最后一天').length > 0)
    assert.ok(bannedWordHits('仅限今天').length > 0)
    assert.ok(bannedWordHits('错过再等').length > 0)
    assert.ok(bannedWordHits('限额').length > 0)
    assert.ok(bannedWordHits('限·时').length > 0)
  })

  test('does not flag allowed wording', () => {
    assert.deepEqual(bannedWordHits('Unlimited access'), [])
    assert.deepEqual(bannedWordHits('a small group of 12'), [])
    assert.deepEqual(bannedWordHits('限 12 人小团'), [])
  })
})

describe('banned words (latest additions)', () => {
  test('flags new English promotional phrases', () => {
    assert.ok(bannedWordHits('Last days').length > 0)
    assert.ok(bannedWordHits('Act fast').length > 0)
    assert.ok(bannedWordHits('Selling out').length > 0)
    assert.ok(bannedWordHits('Closing soon').length > 0)
    assert.ok(bannedWordHits('Offer closes').length > 0)
    assert.ok(bannedWordHits('3 left').length > 0)
  })

  test('flags new Chinese promotional phrases', () => {
    assert.ok(bannedWordHits('席位有限').length > 0)
    assert.ok(bannedWordHits('售罄').length > 0)
    assert.ok(bannedWordHits('手慢无').length > 0)
  })

  test('does not flag allowed wording', () => {
    assert.deepEqual(bannedWordHits('Unlimited access'), [])
    assert.deepEqual(bannedWordHits('限 12 人小团'), [])
  })
})

describe('price mentions', () => {
  test('flags currency symbols and codes', () => {
    assert.ok(priceMentionHits('From $1,999').length > 0)
    assert.ok(priceMentionHits('A$1999').length > 0)
    assert.ok(priceMentionHits('1999 NZD').length > 0)
    assert.ok(priceMentionHits('NZ$ 2,999').length > 0)
  })

  test('flags Chinese price phrases', () => {
    assert.ok(priceMentionHits('仅需 1999').length > 0)
    assert.ok(priceMentionHits('8折').length > 0)
    assert.ok(priceMentionHits('1999元').length > 0)
  })

  test('does not flag plain numbers', () => {
    assert.deepEqual(priceMentionHits('18 days'), [])
    assert.deepEqual(priceMentionHits('Day 12'), [])
    assert.deepEqual(priceMentionHits('Year 2027'), [])
    assert.deepEqual(priceMentionHits('a 12-person group'), [])
  })

  test('a hook line with a price is rejected', () => {
    rejects((props) => {
      props.hook.lines = ['FROM $1999']
    }, '画面文字里不许出现价格')
  })

  test('an end title with a price is rejected when price is null', () => {
    rejects((props) => {
      props.price = null
      props.end = { backdropClip: 'clips/end.mp4', title: 'From NZD 1999' }
    }, '画面文字里不许出现价格')
  })

  test('a scene line containing a dollar sign is rejected', () => {
    rejects((props) => {
      props.scenes[0].line = 'The tour costs $'
    }, '画面文字里不许出现价格')
  })

  test('a normal price object still parses', () => {
    const props = parsePostcardProps(validProps())
    assert.equal(props.price.currencyPrefix, '$')
    assert.equal(props.price.amount, 1200)
  })
})

describe('sourceUrl', () => {
  test('a non-http url is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'ftp://x'
    })
  })

  test('a bare host without a dot is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'https://a'
    })
  })

  test('localhost is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'http://localhost/x'
    })
  })

  test('an IPv4 host is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'http://10.0.0.1/x'
    })
  })

  test('a normal https url passes', () => {
    const props = validProps()
    props.scenes[0].sourceUrl = 'https://example.com/tour'
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.scenes[0].sourceUrl, 'https://example.com/tour')
  })

  test('reserved hosts and credentials are rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceUrl = 'https://foo.localhost/x'
    })
    rejects((props) => {
      props.scenes[0].sourceUrl = 'https://user:pw@example.com/x'
    })
    rejects((props) => {
      props.scenes[0].sourceUrl = 'http://a.b'
    })
    rejects((props) => {
      props.scenes[0].sourceUrl = 'https://example.internal/x'
    })
    rejects((props) => {
      props.scenes[0].sourceUrl = 'http://[::1]/x'
    })
  })

  test('a normal https url with a path passes', () => {
    const props = validProps()
    props.scenes[0].sourceUrl = 'https://www.example.com/tours/silk-road'
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.scenes[0].sourceUrl, 'https://www.example.com/tours/silk-road')
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

  test('short text with an unrelated quote is rejected', () => {
    rejects((props) => {
      props.scenes[0].line = 'Go to a zoo'
      props.scenes[0].sourceQuote = 'unrelated text'
    }, '出处片段里找不到这句话的主要词')
  })

  test('short text with a supporting quote passes', () => {
    const props = validProps()
    props.scenes[0].line = 'Go to a zoo'
    props.scenes[0].sourceQuote = 'You can go to a zoo here'
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.scenes[0].line, 'Go to a zoo')
  })

  test('a banned word inside sourceQuote is rejected', () => {
    rejects((props) => {
      props.scenes[0].sourceQuote = 'the harbour wakes slowly, book now'
    }, '促销词')
  })
})

describe('source quote coverage', () => {
  test('a Chinese line needs at least half its characters', () => {
    rejects((props) => {
      props.scenes[0].line = '京都的秋天'
      props.scenes[0].sourceQuote = '这里有的'
    }, '出处片段里找不到这句话的主要词')
  })

  test('a Chinese line with a supporting quote passes', () => {
    const props = validProps()
    props.scenes[0].line = '京都的秋天'
    props.scenes[0].sourceQuote = '京都的秋天很美'
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.scenes[0].line, '京都的秋天')
  })

  test('an English line needs at least half its long words', () => {
    rejects((props) => {
      props.scenes[0].line = 'Quiet harbour boats drift'
      props.scenes[0].sourceQuote = 'harbour only'
    }, '出处片段里找不到这句话的主要词')
  })

  test('an English line with a supporting quote passes', () => {
    const props = validProps()
    props.scenes[0].line = 'Quiet harbour boats drift'
    props.scenes[0].sourceQuote = 'quiet harbour boats'
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.scenes[0].line, 'Quiet harbour boats drift')
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

describe('end card', () => {
  test('price null with an end card parses', () => {
    const props = validProps()
    props.price = null
    props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.price, null)
    assert.ok(parsed.end !== null)
    assert.equal(parsed.end.title, 'QUIET HARBOUR')
  })

  test('price null and end null is rejected', () => {
    rejects((props) => {
      props.price = null
      props.end = null
    }, 'price 和 end 必须二选一')
  })

  test('price non-null and end non-null is rejected', () => {
    rejects((props) => {
      props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    }, 'price 和 end 必须二选一')
  })

  test('an end title with a banned word is rejected', () => {
    rejects((props) => {
      props.price = null
      props.end = { backdropClip: 'clips/end.mp4', title: 'Last chance' }
    }, '促销词')
  })

  test('an end title wider than 14 units is rejected', () => {
    rejects((props) => {
      props.price = null
      props.end = { backdropClip: 'clips/end.mp4', title: 'A'.repeat(30) }
    }, '结束卡标题太宽')
  })

  test('asset collection uses the end backdrop when price is null', () => {
    const props = validProps()
    props.price = null
    props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    const files = collectPostcardAssetFiles(parsePostcardProps(props))
    assert.ok(files.includes('clips/end.mp4'))
    assert.ok(!files.includes('clips/price.mp4'))
  })
})

describe('cardTop', () => {
  test('599 is rejected', () => {
    rejects((props) => {
      props.cardTop = 599
    }, 'cardTop 必须在 600 到 940 之间')
  })

  test('941 is rejected', () => {
    rejects((props) => {
      props.cardTop = 941
    }, 'cardTop 必须在 600 到 940 之间')
  })

  test('600 is accepted', () => {
    const props = validProps()
    props.cardTop = 600
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.cardTop, 600)
  })

  test('940 is accepted', () => {
    const props = validProps()
    props.cardTop = 940
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.cardTop, 940)
  })

  test('absent is accepted', () => {
    const props = parsePostcardProps(validProps())
    assert.equal(props.cardTop, undefined)
  })
})

describe('priceSec with a price card', () => {
  test('4 seconds with a price card is rejected', () => {
    rejects((props) => {
      props.timing.priceSec = 4
    }, '带价格卡时最后一段至少 5 秒')
  })

  test('4 seconds with price null and an end card is accepted', () => {
    const props = validProps()
    props.price = null
    props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    props.timing.priceSec = 4
    const parsed = parsePostcardProps(props)
    assert.equal(parsed.timing.priceSec, 4)
  })

  test('2.9 seconds is rejected with a price card', () => {
    rejects((props) => {
      props.timing.priceSec = 2.9
    })
  })

  test('2.9 seconds is rejected with an end card', () => {
    rejects((props) => {
      props.price = null
      props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
      props.timing.priceSec = 2.9
    })
  })
})

describe('timing with an end card', () => {
  test('price null, hookSec 3, sceneSec 4 (3 scenes), priceSec 4 gives 570 frames', () => {
    const props = validProps()
    props.price = null
    props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    props.timing.hookSec = 3
    props.timing.sceneSec = 4
    props.timing.priceSec = 4
    const base = props.scenes[0]
    props.scenes = [
      { ...base, clip: 'clips/a.mp4' },
      { ...base, clip: 'clips/b.mp4' },
      { ...base, clip: 'clips/c.mp4' },
    ]
    const timing = computePostcardTiming(parsePostcardProps(props))
    assert.equal(timing.totalFrames, 570)
  })
})

describe('hook and end-card sources', () => {
  const hookSource = {
    sourceUrl: 'https://example.com/tour',
    sourceQuote: 'quiet harbour mornings on the water',
  }

  test('a hook with a matching official-page source parses', () => {
    const props = validProps()
    props.hook = { ...props.hook, lines: ['QUIET', 'HARBOUR'], ...hookSource }
    assert.equal(parsePostcardProps(props).hook.sourceUrl, hookSource.sourceUrl)
  })

  test('an end card with a matching source parses', () => {
    const props = validProps()
    props.price = null
    props.end = {
      backdropClip: 'clips/end.mp4',
      title: 'QUIET HARBOUR',
      ...hookSource,
    }
    assert.equal(parsePostcardProps(props).end.sourceQuote, hookSource.sourceQuote)
  })

  test('a source URL without a quote is rejected', () => {
    rejects((props) => {
      props.hook = { ...props.hook, sourceUrl: hookSource.sourceUrl }
    }, '要么都填')
  })

  test('a quote that does not contain the hook words is rejected', () => {
    rejects((props) => {
      props.hook = { ...props.hook, sourceUrl: hookSource.sourceUrl, sourceQuote: 'something unrelated entirely' }
    }, '出处片段里找不到')
  })

  test('a non-http source URL on the end card is rejected', () => {
    rejects((props) => {
      props.price = null
      props.end = {
        backdropClip: 'clips/end.mp4',
        title: 'QUIET HARBOUR',
        sourceUrl: 'file:///etc/passwd',
        sourceQuote: hookSource.sourceQuote,
      }
    }, 'http')
  })

  test('a source quote with a banned promo word is rejected', () => {
    rejects((props) => {
      props.hook = { ...props.hook, sourceUrl: hookSource.sourceUrl, sourceQuote: 'quiet harbour mornings, book now' }
    }, '促销词')
  })

  test('every hook line must be supported, not just the first', () => {
    rejects((props) => {
      props.hook = { ...props.hook, lines: ['QUIET', 'MOUNTAINS'], ...hookSource }
    }, '第 2 行')
  })

  test('a quote without a URL is rejected', () => {
    rejects((props) => {
      props.hook = { ...props.hook, sourceQuote: hookSource.sourceQuote }
    }, '要么都填')
  })

  test('an end title not found in its quote is rejected', () => {
    rejects((props) => {
      props.price = null
      props.end = { backdropClip: 'clips/end.mp4', title: 'MOUNTAIN RETREAT', ...hookSource }
    }, '出处片段里找不到')
  })

  test('a half-filled citation on a three-line hook is reported once', () => {
    const props = validProps()
    props.hook = { ...props.hook, lines: ['QUIET', 'HARBOUR', 'MORNINGS'], sourceUrl: hookSource.sourceUrl }
    const result = PostcardPropsSchema.safeParse(props)
    assert.equal(result.success, false)
    const hits = result.error.issues.filter((i) => i.message.includes('要么都填'))
    assert.equal(hits.length, 1)
  })

  test('hook and end without sources still parse (sources stay optional)', () => {
    const props = validProps()
    props.price = null
    props.end = { backdropClip: 'clips/end.mp4', title: 'QUIET HARBOUR' }
    assert.doesNotThrow(() => parsePostcardProps(props))
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
