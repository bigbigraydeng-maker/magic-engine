import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  FALLBACK_CTA,
  FALLBACK_CTA_ZH,
  FALLBACK_HOOK_LINE,
  FALLBACK_HOOK_LINE_ZH,
  ctaButtonWidth,
  endCardActive,
  estimatePostcardCardHeight,
  extraCaptionLines,
  hookActive,
  hookDisplayRows,
  hookRows,
  hookTypeSize,
  inferHookStyle,
  overlayWindows,
  postcardCardTop,
  resolveEndCard,
  resolveFramePlan,
  resolveHook,
  statTypeSize,
  workOrderLooksChinese,
  wrapHeadline,
} from '../src/frame.ts'
import { readableOn, safeRectFor } from '../src/safeZone.ts'
import { parsePostcardProps } from '../src/postcard.ts'
import { parseListReelProps } from '../src/schema.ts'
import { parseDataCardProps } from '../src/datacard.ts'
import { parseAtmosphereProps } from '../src/atmosphere.ts'
import { buildAtmosphereSrt, buildPostcardSrt, frameCaptionExtras } from '../../../remotion-branch.mjs'

const postcardBase = () => ({
  brandColor: '#0b6e99',
  logoFile: 'logo.png',
  musicFile: null,
  cardOpacity: 0.4,
  cardSide: 'left',
  hook: { clip: 'clips/hook.mp4', lines: ['QUIET', 'HARBOUR'] },
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
  price: null,
  end: { backdropClip: 'clips/end.mp4', title: 'See the route' },
  timing: { hookSec: 3, sceneSec: 4, priceSec: 3 },
})

describe('safe zone', () => {
  test('9:16 matches the Reels insets', () => {
    const safe = safeRectFor(1080, 1920)
    assert.deepEqual(safe, { left: 60, top: 270, right: 960, bottom: 1248, width: 900, height: 978 })
  })

  test('1:1 keeps a caption margin under the picture', () => {
    const safe = safeRectFor(1080, 1080)
    assert.ok(safe.top >= 80)
    assert.ok(safe.bottom <= 860)
    assert.ok(safe.right <= 1020)
    assert.ok(safe.left >= 60)
  })

  test('readableOn picks black on a light fill and white on a dark fill', () => {
    assert.equal(readableOn('#F4F1EA'), '#111111')
    assert.equal(readableOn('#0B6E99'), '#ffffff')
  })
})

describe('hook fallbacks', () => {
  test('no copy becomes one generic kinetic line', () => {
    const hook = resolveHook({})
    assert.equal(hook.style, 'kinetic')
    assert.equal(hook.fallbackLine, true)
    assert.deepEqual(hook.lines, [{ text: FALLBACK_HOOK_LINE, badge: null }])
  })

  test('a question mark selects the question card', () => {
    const hook = resolveHook({ lines: ['想从哪一步开始？'] })
    assert.equal(hook.style, 'question')
    assert.equal(hook.question, '想从哪一步开始？')
    assert.equal(hook.fallbackLine, false)
  })

  test('a question mark on one line keeps the other hook lines', () => {
    const lines = ['沿着海岸', '慢慢走走', '想去看看？']
    const hook = resolveHook({ lines })
    assert.equal(hook.style, 'question')
    assert.deepEqual(hook.lines.map((line) => line.text), lines)
    const rows = hookRows(hook.lines)
    assert.equal(rows.map((row) => row.text).join(''), lines.join(''))
  })

  test('an explicit question is drawn first and stays in the caption extras', () => {
    const source = ['沿着海岸', '慢慢走走']
    const question = '想去哪里？'
    const props = {
      ...postcardBase(),
      hook: { clip: 'clips/hook.mp4', lines: source },
      frame: { hook: { question } },
    }
    const hook = resolveFramePlan('postcard', props).hook
    assert.equal(hook?.style, 'question')
    assert.equal(hook?.question, question)
    assert.deepEqual(hook?.lines.map((line) => line.text), [question, ...source])
    assert.ok(extraCaptionLines('postcard', props).includes(question))
    assert.deepEqual(frameCaptionExtras('postcard', props), extraCaptionLines('postcard', props))
    assert.equal(hookRows(hook?.lines ?? []).map((row) => row.text).join(''), [question, ...source].join(''))
  })

  test('question-marked hook text is drawn ahead of the template lines', () => {
    const hook = resolveHook({
      lines: ['沿着海岸', '慢慢走走'],
      spec: { text: '想去哪里？' },
    })
    assert.equal(hook.question, '想去哪里？')
    assert.deepEqual(hook.lines.map((line) => line.text), ['想去哪里？', '沿着海岸', '慢慢走走'])
  })

  test('an explicit question is not repeated when a hook line already says it', () => {
    const hook = resolveHook({
      lines: ['沿着海岸', '想去哪里？'],
      spec: { question: '想去哪里？' },
    })
    assert.deepEqual(hook.lines.map((line) => line.text), ['想去哪里？', '沿着海岸'])
  })

  test('when the explicit question cannot share three rows, it is the whole hook', () => {
    const hook = resolveHook({
      lines: ['沿着海岸', '慢慢走走', '看看日落'],
      spec: { question: '想去哪里？' },
    })
    assert.deepEqual(hook.lines.map((line) => line.text), ['想去哪里？'])
    assert.doesNotThrow(() => hookRows(hook.lines))
  })

  test('a number selects the stat pop and keeps the other line as the caption', () => {
    const hook = resolveHook({ lines: ['48', '小时内回复'] })
    assert.equal(hook.style, 'stat')
    assert.equal(hook.stat, '48')
    assert.deepEqual(hook.lines.map((line) => line.text), ['小时内回复'])
  })

  test('an explicit style wins over inference', () => {
    assert.equal(inferHookStyle(['48'], { style: 'kinetic' }), 'kinetic')
    const hook = resolveHook({ lines: ['48 reasons'], spec: { style: 'kinetic' } })
    assert.equal(hook.style, 'kinetic')
    assert.equal(hook.lines[0].text, '48 reasons')
  })

  test('list badges survive on a kinetic line', () => {
    const hook = resolveHook({ lines: [{ badge: 'NEW', text: 'Harbour' }] })
    assert.equal(hook.lines[0].badge, 'NEW')
  })

  test('a long headline wraps to at most three lines', () => {
    const lines = wrapHeadline('One two three four five six seven')
    assert.ok(lines.length >= 2)
    assert.ok(lines.length <= 3)
  })

  test('empty copy stays English, and Chinese copy selects the Chinese line', () => {
    assert.equal(resolveHook({}).lines[0].text, FALLBACK_HOOK_LINE)
    assert.equal(resolveHook({ chinese: true }).lines[0].text, FALLBACK_HOOK_LINE_ZH)
    assert.equal(workOrderLooksChinese({ scenes: [{ place: '示例湾' }] }), true)
    assert.equal(workOrderLooksChinese({ scenes: [{ place: 'Example Bay' }] }), false)
  })

  test('a short Chinese question splits so the type can stay large', () => {
    assert.deepEqual(hookDisplayRows('想从哪一步开始？'), ['想从哪一步', '开始？'])
  })

  test('hook type for four Han characters covers at least 60% of a 9:16 frame', () => {
    const size = hookTypeSize(1080, 900, 4, true)
    assert.ok(size * 1.02 * 4 >= 1080 * 0.6, `width ${size * 1.02 * 4}`)
    const stat = statTypeSize(1080, 900, '48')
    assert.ok(stat >= 200)
  })
})

describe('end card fallbacks', () => {
  test('missing cta and title use the generic action', () => {
    const card = resolveEndCard({})
    assert.equal(card.cta, FALLBACK_CTA)
    assert.equal(card.fallbackCta, true)
    assert.equal(card.logoFile, null)
    assert.equal(card.monogram, 'L')
  })

  test('an end title is the action, and a missing logo uses the brand initial', () => {
    const card = resolveEndCard({ title: 'See the route', spec: { brandName: '示例客户' } })
    assert.equal(card.cta, 'See the route')
    assert.equal(card.fallbackCta, false)
    assert.equal(card.brandName, '示例客户')
    assert.equal(card.logoFile, null)
    assert.equal(card.monogram, '示')
  })

  test('contact is omitted when absent, and a logo file is kept', () => {
    const card = resolveEndCard({ spec: { cta: '了解更多', contact: 'example.com' }, logoFile: 'logo.png' })
    assert.equal(card.contact, 'example.com')
    assert.equal(card.logoFile, 'logo.png')
    assert.equal(card.fallbackCta, false)
  })

  test('a Chinese work order uses the Chinese action, an English one does not', () => {
    assert.equal(resolveEndCard({ chinese: true }).cta, FALLBACK_CTA_ZH)
    assert.equal(resolveEndCard({}).cta, FALLBACK_CTA)
    const width = ctaButtonWidth(1080, 900)
    assert.ok(width >= 1080 * 0.55, `button ${width}`)
    assert.ok(width <= 900)
  })
})

describe('template switches', () => {
  test('postcard hook and title ending default on, and can be turned off', () => {
    assert.equal(hookActive('postcard', undefined), true)
    assert.equal(hookActive('postcard', { hook: false }), false)
    assert.equal(endCardActive('postcard', undefined, 'end'), true)
    assert.equal(endCardActive('postcard', { endCard: false }, 'end'), false)
  })

  test('a price ending does not cover the price unless the end card is asked for', () => {
    assert.equal(endCardActive('postcard', undefined, 'price'), false)
    assert.equal(endCardActive('postcard', { endCard: { cta: '了解更多' } }, 'price'), true)
  })

  test('list, montage, datacard and atmosphere stay off until a frame object opts in', () => {
    for (const template of ['list', 'montage', 'datacard', 'atmosphere']) {
      assert.equal(hookActive(template, undefined), false)
      assert.equal(hookActive(template, { hook: {} }), true)
      assert.equal(endCardActive(template, undefined, 'none'), false)
      assert.equal(endCardActive(template, { endCard: {} }, 'price'), true)
    }
  })

  test('a postcard plan uses the hook lines and the end title, with no invented caption lines', () => {
    const props = postcardBase()
    const plan = resolveFramePlan('postcard', props)
    assert.deepEqual(plan.hook?.lines.map((line) => line.text), ['QUIET', 'HARBOUR'])
    assert.equal(plan.endCard?.cta, 'See the route')
    assert.equal(plan.endCard?.logoFile, 'logo.png')
    assert.deepEqual(extraCaptionLines('postcard', props), [])
  })

  test('caption extras match the worker copy of the same rules', () => {
    const cases = [
      ['postcard', postcardBase()],
      ['postcard', { ...postcardBase(), frame: { hook: false, endCard: false } }],
      ['list', { hook: { lines: [{ text: 'Open' }] }, revealTitle: 'The list', price: { amount: 1 }, frame: { hook: { text: 'Look here' } } }],
      ['montage', { frame: { hook: {}, endCard: { contact: 'example.com' } } }],
      ['atmosphere', { line: { text: 'A calm view' } }],
      ['datacard', { frame: { endCard: { brandName: '示例客户' } } }],
    ]
    for (const [template, props] of cases) {
      assert.deepEqual(frameCaptionExtras(template, props), extraCaptionLines(template, props))
    }
  })
})

describe('postcard card position', () => {
  test('omitted cardTop alternates the lower and upper safe bands', () => {
    const height = estimatePostcardCardHeight('The harbour wakes slowly')
    const lower = postcardCardTop({ sceneIndex: 0, cardHeight: height })
    const upper = postcardCardTop({ sceneIndex: 1, cardHeight: height })
    assert.ok(lower > 800, `lower band should leave the middle, got ${lower}`)
    assert.ok(upper < 400, `upper band should sit under the top chrome, got ${upper}`)
    assert.ok(lower + height <= 1248)
    assert.ok(upper >= 270)
  })

  test('an explicit cardTop is kept when it already fits', () => {
    const height = estimatePostcardCardHeight('Short line')
    assert.equal(postcardCardTop({ sceneIndex: 0, cardHeight: height, cardTop: 800 }), 800)
  })

  test('a tall card is pulled up so it does not cross the bottom chrome', () => {
    const line = 'A'.repeat(40)
    const height = estimatePostcardCardHeight(line)
    const top = postcardCardTop({ sceneIndex: 0, cardHeight: height, cardTop: 940 })
    assert.ok(top < 940)
    assert.ok(top + height <= 1248 - 20)
  })

  test('cardZone lower wins for every scene, and a visible corner logo pushes the upper band down', () => {
    const height = estimatePostcardCardHeight('Short line')
    const forced = postcardCardTop({ sceneIndex: 1, cardHeight: height, cardZone: 'lower' })
    const clear = postcardCardTop({ sceneIndex: 1, cardHeight: height, cardZone: 'upper', logoVisible: false })
    const dodged = postcardCardTop({ sceneIndex: 1, cardHeight: height, cardZone: 'upper', logoVisible: true })
    assert.ok(forced > clear)
    assert.ok(dodged > clear)
  })
})

describe('overlay windows', () => {
  test('a normal reel gets 2s of hook and 2.5s of end card without overlap', () => {
    const windows = overlayWindows(30 * 15)
    assert.equal(windows.hookFrames, 60)
    assert.equal(windows.endFrames, 75)
    assert.ok(windows.endFrom >= windows.hookFrames)
  })
})

describe('existing props still parse', () => {
  test('postcard accepts the new switches and rejects a bad one', () => {
    const parsed = parsePostcardProps({ ...postcardBase(), frame: { hook: false }, cardZone: 'alternate' })
    assert.equal(parsed.frame?.hook, false)
    assert.equal(parsed.cardZone, 'alternate')
    assert.throws(() => parsePostcardProps({ ...postcardBase(), cardTop: 800, cardZone: 'lower' }), /只能填一个/)
    assert.throws(() => parsePostcardProps({ ...postcardBase(), frame: { hook: { text: 'Book now' } } }), /促销词/)
  })

  test('list and datacard and atmosphere ignore a missing frame and accept an opt-in', () => {
    const list = JSON.parse(fs.readFileSync(new URL('../examples/sydney-apartment.props.json', import.meta.url), 'utf8'))
    assert.equal(parseListReelProps(list).frame, undefined)
    assert.equal(parseListReelProps({ ...list, frame: { hook: { style: 'kinetic' } } }).frame?.hook?.style, 'kinetic')
    const card = JSON.parse(fs.readFileSync(new URL('../examples/fictional-datacard.props.json', import.meta.url), 'utf8'))
    assert.equal(parseDataCardProps({ ...card, frame: { endCard: false } }).frame?.endCard, false)
    const atmosphere = parseAtmosphereProps({
      logoFile: 'logo.png',
      musicFile: null,
      clip: 'clips/main.mp4',
      durationSec: 15,
      line: {
        text: 'A calm main view',
        sourceUrl: 'https://example.com/view',
        sourceQuote: 'a calm main view of the water',
      },
      frame: { hook: false },
    })
    assert.equal(atmosphere.frame?.hook, false)
  })
})

const cueTimes = (srt) =>
  [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => [
    (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4],
    (+m[5] * 3600 + +m[6] * 60 + +m[7]) * 1000 + +m[8],
  ])

describe('frame captions and hook rows (review fixes)', () => {
  test('atmosphere with hook and end card keeps cue times ordered and carries all copy', () => {
    const props = {
      line: { text: 'A calm view' },
      frame: { hook: { text: 'Look closely' }, endCard: { cta: 'Book now', contact: 'example.com' } },
    }
    const srt = buildAtmosphereSrt(props, { totalFrames: 450 }, 30)
    const times = cueTimes(srt)
    assert.equal(times.length, 1)
    for (let i = 0; i < times.length; i++) {
      assert.ok(times[i][1] > times[i][0])
      if (i > 0) assert.ok(times[i][0] >= times[i - 1][1])
    }
    for (const text of ['Look closely', 'Book now', 'example.com']) assert.ok(srt.includes(text), text)
  })

  test('multi-cue postcard: hook joins first cue, end copy joins last, times stay ordered', () => {
    const props = {
      hook: { lines: ['QUIET'] },
      scenes: [{ place: 'Bay', line: 'Calm water' }],
      price: null,
      end: { title: 'Example Co' },
      frame: { hook: { text: 'Look closely' }, endCard: { cta: 'Book now' } },
    }
    const timing = { hookFrames: 60, sceneFrom: [60], sceneDur: [90], priceFrom: 150, totalFrames: 240 }
    const srt = buildPostcardSrt(props, timing, 30)
    const times = cueTimes(srt)
    assert.equal(times.length, 3)
    for (let i = 1; i < times.length; i++) assert.ok(times[i][0] >= times[i - 1][1])
    const blocks = srt.split('\n\n').filter(Boolean)
    assert.ok(blocks[0].includes('Look closely'))
    assert.ok(blocks[2].includes('Book now'))
  })

  test('three 7-character Chinese hook lines keep all text', () => {
    const lines = ['沿着海岸慢慢走', '看看港口的日落', '享受安静的旅程'].map((text) => ({ text, badge: null }))
    const rows = hookRows(lines)
    assert.ok(rows.length <= 3)
    assert.equal(rows.map((r) => r.text).join(''), lines.map((l) => l.text).join(''))
  })

  test('more than three hook lines are refused, not truncated', () => {
    const lines = ['一', '二', '三', '四'].map((text) => ({ text, badge: null }))
    assert.throws(() => hookRows(lines), /at most 3/)
  })

  test('Chinese file names do not switch the fallback language', () => {
    assert.equal(workOrderLooksChinese({ clip: '素材/海边.mp4', logoFile: '标志.png', line: { text: 'A calm view' } }), false)
    assert.equal(workOrderLooksChinese({ line: { text: '海边' } }), true)
  })
})
