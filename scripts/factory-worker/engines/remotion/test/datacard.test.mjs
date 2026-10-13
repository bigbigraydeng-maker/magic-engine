import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DataCardPropsSchema,
  parseDataCardProps,
  collectDataCardAssetFiles,
  computeDataCardTiming,
  contrastRatio,
  MIN_ROWS,
  MAX_ROWS,
} from '../src/datacard.ts'
import { loadTemplate, isTemplateId, TEMPLATE_IDS } from '../src/templates.ts'

/** Load a fresh copy of the fictional example. */
function base() {
  return JSON.parse(
    fs.readFileSync(new URL('../examples/fictional-datacard.props.json', import.meta.url), 'utf8'),
  )
}

/** Assert that mutating a fresh props object makes validation fail. */
function rejects(mutate, includes) {
  const props = base()
  mutate(props)
  const result = DataCardPropsSchema.safeParse(props)
  assert.equal(result.success, false)
  if (includes) assert.ok(JSON.stringify(result.error.issues).includes(includes), JSON.stringify(result.error.issues))
}

describe('datacard schema', () => {
  test('the fictional example is valid', () => {
    assert.doesNotThrow(() => parseDataCardProps(base()))
  })

  test('every top-level field is required (no defaults)', () => {
    for (const key of Object.keys(base()).filter((k) => k !== 'musicStartSec')) {
      rejects((p) => { delete p[key] })
    }
  })

  test('unknown fields are rejected', () => {
    rejects((p) => { p.cta = 'Book now' })
    rejects((p) => { p.rows[0].extra = 1 })
  })

  test('row count must be 3 to 7', () => {
    assert.equal(MIN_ROWS, 3)
    assert.equal(MAX_ROWS, 7)
    rejects((p) => { p.rows = p.rows.slice(0, 2) })
    rejects((p) => { p.rows = Array.from({ length: 8 }, () => ({ ...p.rows[0] })) })
    const seven = base()
    seven.rows = Array.from({ length: 7 }, () => ({ ...seven.rows[0] }))
    assert.doesNotThrow(() => parseDataCardProps(seven))
  })

  test('hook is 1 to 2 lines, each at most 12 characters', () => {
    rejects((p) => { p.hook.lines = [] })
    rejects((p) => { p.hook.lines = ['A', 'B', 'C'] })
    rejects((p) => { p.hook.lines = ['THIRTEEN CHARS'] })
  })

  test('text fields reject empty, control characters and over-length', () => {
    rejects((p) => { p.rows[0].label = '  ' })
    rejects((p) => { p.rows[0].value = 'x\u0007' })
    rejects((p) => { p.disclaimer = 'x'.repeat(45) })
    rejects((p) => { p.rows[0].value = 'x'.repeat(11) })
    rejects((p) => { p.rows[0].label = 'x'.repeat(21) })
    rejects((p) => { p.rows[0].sublabel = 'x'.repeat(29) })
  })

  test('colours must be #RRGGBB', () => {
    rejects((p) => { p.bgColor = 'navy' })
    rejects((p) => { p.brandColor = '#FFF' })
  })

  test('low contrast colours are rejected', () => {
    rejects((p) => { p.textColor = '#222222' }, '对比度')
    rejects((p) => { p.brandColor = '#101D2E' }, '对比度')
    assert.ok(contrastRatio('#FFFFFF', '#000000') > 20.9)
    assert.equal(contrastRatio('#123456', '#123456'), 1)
  })

  test('barMode and row bars must agree', () => {
    rejects((p) => { p.barMode = 'none' }, 'none')
    rejects((p) => { p.rows[1].bar = null }, 'bar')
    rejects((p) => { p.barMode = 'wave' })
    rejects((p) => { p.rows[0].bar = 1.2 })
    const none = base()
    none.barMode = 'none'
    none.rows.forEach((r) => { r.bar = null })
    assert.doesNotThrow(() => parseDataCardProps(none))
    const steps = base()
    steps.barMode = 'steps'
    assert.doesNotThrow(() => parseDataCardProps(steps))
  })

  test('asset names must be safe relative files', () => {
    rejects((p) => { p.logoFile = 'https://x.test/a.png' })
    rejects((p) => { p.logoFile = '../a.png' })
    rejects((p) => { p.musicFile = '/abs/a.mp3' })
    rejects((p) => { p.musicFile = 'a.ogg' })
  })

  test('timing fields are bounded', () => {
    rejects((p) => { p.hookSec = 0.5 })
    rejects((p) => { p.rowSec = 3 })
    rejects((p) => { p.holdSec = 7 })
  })
})

describe('datacard timing and assets', () => {
  test('timing: hook holds, rows on a fixed cadence, last row holds', () => {
    const props = parseDataCardProps(base())
    const t = computeDataCardTiming(props)
    assert.equal(t.hookFrames, 60)
    assert.equal(t.rowFrames, 36)
    assert.deepEqual(t.rowFrom, [60, 96, 132, 168, 204])
    assert.equal(t.totalFrames, 60 + 5 * 36 + 90)
  })

  test('assets list the logo and music only when present, once each', () => {
    const props = parseDataCardProps(base())
    assert.deepEqual(collectDataCardAssetFiles(props), ['logo.png'])
    assert.deepEqual(collectDataCardAssetFiles({ ...props, logoFile: null, musicFile: 'a.mp3' }), ['a.mp3'])
    assert.deepEqual(collectDataCardAssetFiles({ ...props, logoFile: 'a.png', musicFile: null }), ['a.png'])
  })
})

describe('datacard registry wiring', () => {
  test('datacard is a registered template', () => {
    assert.ok(TEMPLATE_IDS.includes('datacard'))
    assert.equal(isTemplateId('datacard'), true)
  })

  test('loadTemplate datacard returns DataCardReel metadata', () => {
    const loaded = loadTemplate('datacard', base())
    assert.equal(loaded.compositionId, 'DataCardReel')
    assert.equal(loaded.totalFrames, 330)
    assert.deepEqual(loaded.assetFiles, ['logo.png'])
  })

  test('other templates reject datacard props and vice versa', () => {
    assert.throws(() => loadTemplate('list', base()))
    assert.throws(() => loadTemplate('montage', base()))
    const listRaw = JSON.parse(fs.readFileSync(new URL('../examples/sydney-apartment.props.json', import.meta.url), 'utf8'))
    assert.throws(() => loadTemplate('datacard', listRaw))
  })
})

test('accent contrast is judged on the translucent card colour', async () => {
  const { cardColor, parseDataCardProps } = await import('../src/datacard.ts')
  const base = JSON.parse((await import('node:fs')).readFileSync(new URL('../examples/fictional-datacard.props.json', import.meta.url), 'utf8'))
  assert.equal(cardColor('#000000', '#FFFFFF'), '#141414')
  assert.throws(() => parseDataCardProps({ ...base, bgColor: '#000000', textColor: '#FFFFFF', brandColor: '#5A5A5A' }), /卡片底色/)
})

test('text contrast is judged after card fill and opacity', () => {
  assert.throws(() => parseDataCardProps({ ...base(), bgColor: '#FFFFFF', textColor: '#767676' }), /合成后对比度/)
})

test('worst-case width text at the schema limits is accepted (the renderer shrinks it to fit)', () => {
  const p = base()
  p.hook.lines = ['W'.repeat(12), 'W'.repeat(12)]
  p.rows[0] = { label: 'W'.repeat(20), value: 'W'.repeat(10), sublabel: 'W'.repeat(28), bar: 0.5 }
  p.disclaimer = 'W'.repeat(44)
  assert.doesNotThrow(() => parseDataCardProps(p))
})

test('brand colour must also contrast with the bare background (hook last line)', () => {
  rejects((p) => { p.bgColor = '#101D2E'; p.brandColor = '#101D2E' }, '对比度')
})

test('datacard reports the reconciled recipe gaps and the CLI no longer blanket-refuses it', () => {
  const gaps = loadTemplate('datacard', base()).recipeGaps
  assert.deepEqual(gaps.map((g) => g.column), ['开场钩子 visual_shock', '真人出镜/自拍感', '真实感', '行业配方'])
  assert.ok(fs.existsSync(new URL('../DATACARD_RECIPE_RECONCILIATION.md', import.meta.url)))
  const render = fs.readFileSync(new URL('../render.mjs', import.meta.url), 'utf8')
  assert.ok(!render.includes('DATACARD_RECIPE_NOT_RECONCILED'))
})
