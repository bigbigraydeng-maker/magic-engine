import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { loadTemplate } from '../src/templates.ts'
import { parseListReelProps } from '../src/schema.ts'
import { parsePostcardProps } from '../src/postcard.ts'
import { SAFE_BOTTOM, SAFE_RIGHT, SAFE_TOP } from '../src/theme.ts'
import { AA_NORMAL, contrastRatio, flattenCss } from '../src/styles/contrast.ts'
import { postcardPaint } from '../src/styles/paint-postcard.ts'
import { listPaint } from '../src/styles/paint-list.ts'
import { STYLE_PRESETS } from '../src/styles/presets.ts'
import { resolveRenderLook, resolveStyle } from '../src/styles/select.ts'
import { PRESET_IDS } from '../src/styles/types.ts'

const listProps = () => JSON.parse(fs.readFileSync(new URL('../examples/sydney-apartment.props.json', import.meta.url), 'utf8'))

const postcardProps = () => ({
  brandColor: '#0b6e99',
  logoFile: 'logo.png',
  musicFile: null,
  cardOpacity: 0.4,
  cardSide: 'left',
  hook: { clip: 'clips/hook.mp4', lines: ['热汤', 'FRESH'] },
  scenes: [
    {
      clip: 'clips/a.mp4',
      place: '例汤',
      line: '一碗热汤刚刚出锅',
      sourceUrl: 'https://example.com/bowl',
      sourceQuote: '一碗热汤刚刚出锅',
      placeSourceQuote: '例汤',
    },
    {
      clip: 'clips/b.mp4',
      place: '小馆',
      line: '热汤盛在小碗里',
      sourceUrl: 'https://example.com/shop',
      sourceQuote: '热汤盛在小碗里',
      placeSourceQuote: '小馆',
    },
  ],
  price: null,
  end: { backdropClip: 'clips/end.mp4', title: '再来一碗' },
  timing: { hookSec: 2.5, sceneSec: 3, priceSec: 3 },
})

const postcardInput = { cardOpacity: 0.4, cardSide: 'left', cardTop: 800, accent: '#abcdef' }

test('safe area stays the existing 9:16 inset', () => {
  assert.equal(SAFE_TOP, 270)
  assert.equal(SAFE_BOTTOM, 1248)
  assert.equal(SAFE_RIGHT, 960)
  for (const id of PRESET_IDS) {
    const look = resolveStyle({ preset: id })
    assert.deepEqual(look.safe, { top: 270, bottom: 1248, left: 60, right: 960 })
  }
})

test('eleven packs: eight industries and three generic looks, and none of them set a frame size', () => {
  const industries = STYLE_PRESETS.filter((preset) => preset.kind === 'industry').map((preset) => preset.id)
  const generic = STYLE_PRESETS.filter((preset) => preset.kind === 'generic').map((preset) => preset.id)
  assert.deepEqual(industries, ['dining', 'property', 'travel', 'beauty', 'education', 'home', 'retail', 'b2b'])
  assert.deepEqual(generic, ['clean', 'vivid', 'premium'])
  const blob = JSON.stringify(STYLE_PRESETS)
  assert.equal(blob.includes('"aspect"'), false)
  assert.equal(blob.includes('"width"'), false)
  assert.equal(blob.includes('"height"'), false)
})

test('a missing style leaves the picture alone; an empty style uses the clean pack', () => {
  assert.equal(resolveRenderLook(undefined, undefined), null)
  assert.equal(resolveRenderLook(null, undefined), null)
  assert.equal(resolveStyle({}).presetId, 'clean')
  assert.equal(resolveStyle({}).selection, 'clean')
})

test('industry names pick a pack, and an explicit pack wins', () => {
  assert.equal(resolveStyle({ industry: '餐饮' }).presetId, 'dining')
  assert.equal(resolveStyle({ industry: 'Real Estate' }).presetId, 'property')
  assert.equal(resolveStyle({ industry: '家政' }).presetId, 'home')
  assert.equal(resolveStyle({ preset: 'beauty', industry: '餐饮' }).presetId, 'beauty')
  assert.equal(resolveStyle({ preset: 'beauty', industry: '餐饮' }).selection, 'preset')
  assert.throws(() => resolveStyle({ industry: 'not-a-trade' }), /不认识的行业/)
})

test('brand kit overlays colour, logo and font, and missing fields stay on the pack', () => {
  const plain = resolveStyle({ preset: 'travel' })
  const emptyBrand = resolveStyle({ preset: 'travel', brand: {} })
  assert.equal(emptyBrand.colors.brand, plain.colors.brand)
  assert.equal(emptyBrand.fonts.latinId, plain.fonts.latinId)
  assert.equal(emptyBrand.logoFile, undefined)
  const branded = resolveStyle({
    preset: 'travel',
    brand: { primary: '#112233', secondary: '#F4E4C8', logo: 'marks/a.png', font: 'serif' },
  })
  assert.equal(branded.colors.brand, '#112233')
  assert.equal(branded.fonts.role, 'serif')
  assert.equal(branded.logoFile, 'marks/a.png')
  assert.equal(branded.card.fill.includes('244'), true)
  const unknownFont = resolveStyle({ preset: 'travel', brand: { font: 'comic' } })
  assert.equal(unknownFont.fonts.role, plain.fonts.role)
})

test('text on a brand colour and on the card clears WCAG AA', () => {
  for (const id of PRESET_IDS) {
    const look = resolveStyle({ preset: id })
    const card = flattenCss(look.card.fill)
    assert.ok(contrastRatio(look.card.lineColor, card) >= AA_NORMAL, `${id} line`)
    assert.ok(contrastRatio(look.card.placeColor, card) >= AA_NORMAL, `${id} place`)
    assert.ok(contrastRatio(look.colors.textOnBrand, look.colors.brand) >= AA_NORMAL, `${id} on brand`)
    assert.ok(contrastRatio(look.colors.onSurface, look.colors.surface) >= AA_NORMAL, `${id} on surface`)
  }
  const harsh = resolveStyle({ preset: 'clean', brand: { primary: '#ffff00', secondary: '#ffffff' } })
  assert.ok(contrastRatio(harsh.colors.textOnBrand, harsh.colors.brand) >= AA_NORMAL)
  assert.ok(contrastRatio(harsh.card.lineColor, flattenCss(harsh.card.fill)) >= AA_NORMAL)
  assert.notEqual(harsh.colors.textOnBrand.toLowerCase(), '#ffffff')
})

test('postcard and list paint is unchanged when no look is attached', () => {
  const family = 'Montserrat'
  const card = postcardPaint(null, postcardInput, family)
  assert.deepEqual(card.hook, {
    position: 'absolute',
    left: 90,
    top: 640,
    width: 790,
    fontFamily: family,
    color: '#fff',
    fontSize: 96,
    fontWeight: 900,
    lineHeight: 1.12,
    textShadow: '0 6px 30px rgba(0,0,0,0.7)',
  })
  assert.deepEqual(card.scene, {
    position: 'absolute',
    left: 60,
    top: 800,
    width: 900,
    background: 'rgba(0,0,0,0.4)',
    borderRadius: 24,
    padding: '28px 36px',
    fontFamily: family,
  })
  assert.deepEqual(card.place, {
    fontSize: 44,
    fontWeight: 800,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#abcdef',
    marginBottom: 14,
  })
  assert.deepEqual(card.line, {
    fontSize: 66,
    fontWeight: 800,
    lineHeight: 1.15,
    color: '#fff',
    textShadow: '0 3px 16px rgba(0,0,0,0.6)',
  })
  assert.deepEqual(card.end, {
    position: 'absolute',
    left: 60,
    top: 760,
    width: 840,
    textAlign: 'center',
    fontFamily: family,
    color: '#fff',
    fontSize: 84,
    fontWeight: 900,
    lineHeight: 1.1,
    textShadow: '0 6px 30px rgba(0,0,0,0.7)',
  })
  assert.equal(card.endScrim, 'rgba(5,10,18,0.35)')
  const list = listPaint(null, '#0B6E99', family, 40, 60)
  assert.equal(list.hook.left, 90)
  assert.equal(list.hook.top, 640)
  assert.equal(list.hook.width, 870)
  assert.equal(list.hook.fontFamily, family)
  assert.equal(list.hook.color, '#fff')
  assert.deepEqual(list.line, { fontSize: 118, fontWeight: 900, lineHeight: 1.12 })
  assert.equal(list.badge.color, '#0B6E99')
  assert.equal(list.badge.background, '#fff')
  assert.equal(list.highlight.background, '#0B6E99')
  assert.equal(list.stamp.background, '#0B6E99')
  assert.equal(list.stamp.borderRadius, 28)
  assert.equal(list.track.top, 1170)
  assert.equal(list.track.fill, '#0B6E99')
  assert.equal(list.reveal.fontSize, 60)
  assert.equal(list.reveal.top, 556)
})

test('a style pack changes colour but not the safe-area anchors', () => {
  const family = 'Montserrat'
  const before = postcardPaint(null, postcardInput, family)
  const after = postcardPaint(resolveStyle({ preset: 'vivid' }), postcardInput, family)
  assert.equal(after.hook.left, before.hook.left)
  assert.equal(after.hook.top, before.hook.top)
  assert.equal(after.hook.width, before.hook.width)
  assert.equal(after.scene.left, before.scene.left)
  assert.equal(after.scene.top, before.scene.top)
  assert.equal(after.scene.width, before.scene.width)
  assert.equal(after.end.left, before.end.left)
  assert.equal(after.end.top, before.end.top)
  assert.notEqual(after.scene.background, before.scene.background)
  const listBefore = listPaint(null, '#0B6E99', family, 40, 60)
  const listAfter = listPaint(resolveStyle({ preset: 'premium' }), '#0B6E99', family, 40, 60)
  assert.equal(listAfter.hook.left, listBefore.hook.left)
  assert.equal(listAfter.block.top, listBefore.block.top)
  assert.equal(listAfter.track.top, listBefore.track.top)
  assert.notEqual(listAfter.stamp.background, listBefore.stamp.background)
})

test('omitting style keeps template props identical, including a second pass', () => {
  const props = listProps()
  const parsed = parseListReelProps(props)
  const loaded = loadTemplate('list', props)
  assert.deepEqual(loaded.props, parsed)
  assert.equal(Object.hasOwn(loaded.props, 'look'), false)
  const again = loadTemplate('list', loaded.props, undefined)
  assert.deepEqual(again.props, parsed)
  const card = parsePostcardProps(postcardProps())
  const postcard = loadTemplate('postcard', postcardProps())
  assert.deepEqual(postcard.props, card)
  assert.equal(Object.hasOwn(postcard.props, 'look'), false)
})

test('style on the brief or inside props resolves, round-trips, and still rejects unknown keys', () => {
  const props = listProps()
  const fromBrief = loadTemplate('list', props, { industry: 'b2b' })
  assert.equal(fromBrief.props.look.presetId, 'b2b')
  assert.equal(fromBrief.props.look.safe.top, 270)
  const round = loadTemplate('list', fromBrief.props)
  assert.deepEqual(round.props.look.colors, fromBrief.props.look.colors)
  assert.equal(round.props.look.safe.bottom, 1248)
  const tampered = structuredClone(fromBrief.props)
  tampered.look.safe.top = 1
  tampered.look.colors.text = '#777777'
  const repaired = loadTemplate('list', tampered)
  assert.equal(repaired.props.look.safe.top, 270)
  assert.ok(contrastRatio(repaired.props.look.colors.text, flattenCss(repaired.props.look.card.fill)) >= AA_NORMAL)
  const inline = loadTemplate('list', { ...props, style: { preset: 'home' } })
  assert.equal(inline.props.look.presetId, 'home')
  const override = loadTemplate('list', { ...props, style: { preset: 'home' } }, { preset: 'retail' })
  assert.equal(override.props.look.presetId, 'retail')
  const logo = loadTemplate('list', props, { preset: 'retail', brand: { logo: 'marks/b.png' } })
  assert.equal(logo.assetFiles.includes('marks/b.png'), true)
  assert.throws(() => loadTemplate('list', { ...props, unexpectedKey: true }), /props 校验失败/)
})
