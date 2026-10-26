import { describe, expect, it } from 'vitest'
import {
  ASPECTS,
  coverRect,
  logoBox,
  placeBox,
  planWorkOrderAspects,
  resolveAspectDelivery,
  safeInsets,
  subjectObjectPosition,
  withRenderAspect,
} from './video-aspects'

const CTX = { clientId: 'c-1', workOrderId: 'wo-1', primaryPath: 'renders/c-1/wo-1/final.mp4' }

describe('planWorkOrderAspects', () => {
  it('keeps a missing list as the single 9:16 deliverable', () => {
    expect(planWorkOrderAspects(undefined)).toEqual({ ok: true, plan: { aspects: ['9:16'], extras: [] } })
    expect(planWorkOrderAspects(null)).toEqual({ ok: true, plan: { aspects: ['9:16'], extras: [] } })
  })

  it('always keeps 9:16 as the primary file and dedupes extras', () => {
    const planned = planWorkOrderAspects(['16:9', '4:5', '4:5'])
    expect(planned).toEqual({ ok: true, plan: { aspects: ['9:16', '16:9', '4:5'], extras: ['16:9', '4:5'] } })
  })

  it('rejects an unknown ratio', () => {
    const planned = planWorkOrderAspects(['21:9'])
    expect(planned.ok).toBe(false)
  })
})

describe('placeBox', () => {
  const box = { left: 90, top: 640, width: 870, fontSize: 118, lines: 3, lineHeight: 1.12 }

  it('returns the 9:16 design numbers unchanged', () => {
    expect(placeBox(1080, 1920, box)).toEqual({ left: 90, top: 640, width: 870, fontSize: 118 })
    expect(subjectObjectPosition(1080, 1920)).toBeNull()
  })

  it('keeps type inside each ratio safe rect and shrinks it', () => {
    for (const id of ['4:5', '1:1', '16:9'] as const) {
      const spec = ASPECTS[id]
      const safe = safeInsets(id)
      const placed = placeBox(spec.width, spec.height, box)
      expect(placed.left).toBeGreaterThanOrEqual(safe.left)
      expect(placed.top).toBeGreaterThanOrEqual(safe.top)
      expect(placed.left + placed.width).toBeLessThanOrEqual(safe.right)
      expect(placed.fontSize).toBeLessThan(118)
      const block = (placed.fontSize ?? 0) * 1.12 * 3
      expect(placed.top + block).toBeLessThanOrEqual(safe.bottom + 1)
    }
  })

  it('puts 4:5 and 1:1 headlines in the lower band, away from the upper subject', () => {
    for (const id of ['4:5', '1:1'] as const) {
      const spec = ASPECTS[id]
      const safe = safeInsets(id)
      const placed = placeBox(spec.width, spec.height, box)
      expect(placed.top).toBeGreaterThanOrEqual(safe.top + safe.height * 0.5 - 1)
    }
  })
})

describe('portrait cover', () => {
  it('covers a 16:9 frame with a 9:16 source instead of leaving side bars', () => {
    const box = coverRect(9, 16, 1920, 1080, 0.42)
    expect(box.width).toBeGreaterThanOrEqual(1920)
    expect(box.height).toBeGreaterThanOrEqual(1080)
    expect(box.left).toBeLessThanOrEqual(0)
    expect(box.left + box.width).toBeGreaterThanOrEqual(1920)
  })

  it('keeps the wordmark the same shape in every non-vertical ratio', () => {
    const ratio = 470 / 171
    for (const id of ['4:5', '1:1', '16:9'] as const) {
      const spec = ASPECTS[id]
      const box = logoBox(spec.width, spec.height)
      expect(box.width / box.height).toBeCloseTo(ratio, 1)
      expect(box.height).toBeLessThan(100)
    }
    expect(logoBox(1080, 1920)).toEqual({ left: 54, top: 292, width: 470, height: 171 })
  })
})

describe('resolveAspectDelivery', () => {
  it('ignores a delivery that did not ask for extra ratios', () => {
    const brief = { remotion: { template: 'list', props: {} } }
    expect(resolveAspectDelivery(brief, undefined, CTX)).toEqual({ ok: true, outputs: null })
  })

  it('stores one manifest row per requested file and rejects a mismatched path', () => {
    const brief = { remotion: { aspects: ['9:16', '4:5', '16:9'] } }
    const ok = resolveAspectDelivery(brief, [
      { aspect: '9:16', video_url: CTX.primaryPath },
      { aspect: '4:5', video_url: 'renders/c-1/wo-1/final-4x5.mp4' },
      { aspect: '16:9', video_url: 'renders/c-1/wo-1/final-16x9.mp4' },
    ], CTX)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.outputs?.map((row) => [row.aspect, row.width, row.height, row.role])).toEqual([
      ['9:16', 1080, 1920, 'primary'],
      ['4:5', 1080, 1350, 'variant'],
      ['16:9', 1920, 1080, 'variant'],
    ])
    expect(ok.outputs?.[2]?.channels).toContain('youtube')

    const wrong = resolveAspectDelivery(brief, [
      { aspect: '9:16', video_url: CTX.primaryPath },
      { aspect: '4:5', video_url: 'renders/c-1/wo-1/final.mp4' },
      { aspect: '16:9', video_url: 'renders/c-1/wo-1/final-16x9.mp4' },
    ], CTX)
    expect(wrong.ok).toBe(false)
  })

  it('rejects extra files when the brief did not ask, and a missing list when it did', () => {
    const plain = { remotion: { template: 'list' } }
    expect(resolveAspectDelivery(plain, [{ aspect: '9:16', video_url: CTX.primaryPath }], CTX).ok).toBe(false)
    const asked = { remotion: { aspects: ['4:5'] } }
    expect(resolveAspectDelivery(asked, undefined, CTX).ok).toBe(false)
  })
})

describe('withRenderAspect', () => {
  it('leaves 9:16 props untouched so strict template schemas still parse', () => {
    const props = { hook: '示例客户' }
    expect(withRenderAspect(props, '9:16')).toBe(props)
    expect(withRenderAspect(props, '4:5')).toMatchObject({ __renderAspect: '4:5' })
  })
})
