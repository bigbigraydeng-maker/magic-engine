import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PRESET_IDS } from '../src/styles/types.ts'
import {
  FAMILY_NAME,
  FAMILY_TIER,
  beatEvery,
  captionBox,
  captionInside,
  craftById,
  craftSignature,
  effectiveShotSec,
  flashOpacity,
  motionTransition,
  picturePose,
  shownChars,
  studyPlan,
  transitionPose,
  usesFlash,
} from '../src/styles/craft.ts'
import { safeZone } from '../src/styles/safe.ts'
import {
  clampShotSec,
  logoStartFrame,
  measureHook,
  openingMove,
  silentCard,
  defaultRules,
} from '../src/styles/rules.ts'
import { resolveStyle } from '../src/styles/select.ts'
import { computeComparePlan, compareLineAt } from '../src/styles/compare-plan.ts'
import { loadTemplate } from '../src/templates.ts'
import { computePostcardTiming, parsePostcardProps } from '../src/postcard.ts'

const postcard = JSON.parse(fs.readFileSync(new URL('../examples/fictional-postcard.props.json', import.meta.url), 'utf8'))
const safe = safeZone()

test('six looks are named and mapped onto generic or industry, with brand as an overlay', () => {
  assert.deepEqual(Object.values(FAMILY_NAME).sort(), ['促销冲击', '纪录片质感', '硬核数据', '抖音快节奏', '高级极简', '温暖生活感'].sort())
  assert.equal(FAMILY_TIER.flash, 'generic')
  assert.equal(FAMILY_TIER.minimal, 'generic')
  assert.equal(FAMILY_TIER.warm, 'industry')
  assert.equal(FAMILY_TIER.data, 'industry')
  assert.equal(FAMILY_TIER.promo, 'industry')
  assert.equal(FAMILY_TIER.documentary, 'industry')
  const branded = resolveStyle({ preset: 'retail', brand: { primary: '#e10600', secondary: '#1b1b1b' } })
  assert.equal(branded.craft.family, 'promo')
  assert.equal(craftSignature(branded.craft), craftSignature(craftById('retail')))
  assert.equal(branded.colors.brand, '#e10600')
})

test('every pack has a different edit, not only different colours', () => {
  const signatures = PRESET_IDS.map((id) => craftSignature(resolveStyle({ preset: id }).craft))
  assert.equal(new Set(signatures).size, PRESET_IDS.length)
  const retail = resolveStyle({ preset: 'retail' }).craft
  const travel = resolveStyle({ preset: 'travel' }).craft
  assert.notEqual(retail.rhythm, travel.rhythm)
  assert.notEqual(retail.caption, travel.caption)
  assert.notEqual(retail.picture, travel.picture)
  assert.notEqual(retail.textMotion, travel.textMotion)
  assert.notEqual(motionTransition(retail), motionTransition(travel))
  assert.equal(usesFlash(resolveStyle({ preset: 'vivid' }).craft), true)
  assert.equal(usesFlash(resolveStyle({ preset: 'dining' }).craft), false)
})

test('captions stay inside the 9:16 safe area and sit in different places', () => {
  const tops = new Set()
  for (const kind of ['stroke-bottom', 'center-card', 'lower-third', 'sticker']) {
    const box = captionBox(kind, safe)
    assert.equal(captionInside(box, safe), true)
    tops.add(box.top)
  }
  assert.equal(tops.size, 4)
})

test('picture and transitions are already moving on the first frame', () => {
  for (const picture of ['kenburns', 'shake', 'grain', 'split', 'pip']) {
    assert.notDeepEqual(picturePose(0, picture), picturePose(10, picture))
  }
  assert.notEqual(picturePose(0, 'kenburns').scale, 1)
  assert.notEqual(transitionPose(0, 'push').y, transitionPose(12, 'push').y)
  assert.equal(transitionPose(0, 'cut').x, 0)
  assert.ok(flashOpacity(0) > 0.5)
  assert.equal(flashOpacity(12), 0)
  const rules = defaultRules()
  assert.notDeepEqual(openingMove(0, 30, rules), openingMove(30, 30, rules))
  assert.equal(logoStartFrame(0, null, 30), 0)
  assert.equal(logoStartFrame(0, rules, 30), 30)
})

test('rhythm is fast, medium or a long take, and a study clip stays between 6 and 8 seconds', () => {
  const byRhythm = { fast: [], medium: [], slow: [] }
  for (const id of PRESET_IDS) {
    const craft = craftById(id)
    byRhythm[craft.rhythm].push(craft.shotSec)
    const plan = studyPlan(craft)
    const seconds = plan.totalFrames / 30
    assert.ok(seconds >= 6 && seconds <= 8.05, `${id} study is ${seconds}s`)
    assert.equal(beatEvery(craft) >= 1, true)
  }
  assert.ok(byRhythm.fast.every((sec) => sec === 1.5))
  assert.ok(byRhythm.medium.every((sec) => sec === 2))
  assert.ok(byRhythm.slow.every((sec) => sec > 3))
})

test('viral rules stay the shared floor and do not change an unstyled render', () => {
  const rules = defaultRules()
  assert.equal(rules.silentRead, true)
  assert.equal(rules.shotSec, 2)
  assert.equal(rules.singleShot, false)
  assert.equal(silentCard(rules, '今天的热汤').point, '今天的热汤')
  assert.throws(() => resolveStyle({ rules: { silentRead: false } }), /不能单独改/)
  assert.throws(() => clampShotSec(3.5), /不能超过/)
  const long = '把整张厨房台面彻底擦干净啦'
  const shrunk = measureHook(long, rules)
  assert.equal(shrunk.text, long)
  assert.ok(shrunk.fontScale < 1)
  const warned = measureHook(long, resolveStyle({ rules: { hookOverflow: 'warn' } }).rules)
  assert.equal(warned.text, long)
  assert.equal(warned.fontScale, 1)
  assert.equal(shownChars(long, 0, 10).length < Array.from(long).length, true)
  assert.equal(shownChars(long, 10, 10), long)
  const parsed = parsePostcardProps(postcard)
  const plain = loadTemplate('postcard', postcard)
  assert.equal(plain.totalFrames, computePostcardTiming(parsed).totalFrames)
  assert.equal(Object.hasOwn(plain.props, 'look'), false)
})

test('a style pack uses its own cut length unless the brief sets one', () => {
  const parsed = parsePostcardProps(postcard)
  const retail = loadTemplate('postcard', postcard, { preset: 'retail' })
  assert.equal(retail.props.timing.sceneSec, postcard.timing.sceneSec)
  assert.equal(retail.totalFrames, 4 * Math.round(1.5 * 30))
  assert.notEqual(retail.totalFrames, computePostcardTiming(parsed).totalFrames)
  const held = loadTemplate('postcard', postcard, { preset: 'travel', rules: { shotSec: 2.5 } })
  assert.equal(held.props.look.rules.shotFromBrief, true)
  assert.equal(effectiveShotSec(held.props.look), 2.5)
  assert.equal(held.totalFrames, 4 * Math.round(2.5 * 30))
  const single = loadTemplate('postcard', postcard, { preset: 'travel', rules: { singleShot: true, singleShotSec: 7 } })
  assert.equal(single.totalFrames, 7 * 30)
  const plan = computeComparePlan(defaultRules())
  assert.deepEqual(plan.shots.map((shot) => shot.id), ['before', 'process', 'after'])
  assert.equal(plan.holdOnAfter, true)
  assert.equal(plan.shots.at(-1).from + plan.shots.at(-1).frames, plan.totalFrames)
  const one = computeComparePlan({ ...defaultRules(), singleShot: true, singleShotSec: 7 })
  assert.equal(one.cuts, 0)
  assert.equal(compareLineAt(0, one), 'before')
  assert.equal(compareLineAt(one.totalFrames - 1, one), 'after')
})
