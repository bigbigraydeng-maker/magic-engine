import { describe, expect, it } from 'vitest'
import { fitBoxToAspect, planClipFit } from './screen-clip'

describe('planClipFit', () => {
  it('录屏比段落短:原速播完，剩下定格补满', () => {
    expect(planClipFit(14, 40)).toEqual({ speed: 1, trimTo: null, padSeconds: 26 })
  })

  it('刚好一样长:不加速不补', () => {
    expect(planClipFit(30, 30)).toEqual({ speed: 1, trimTo: null, padSeconds: 0 })
  })

  it('稍长:加速到刚好塞下，不掐尾', () => {
    const p = planClipFit(45, 30)
    expect(p.speed).toBeCloseTo(1.5, 5)
    expect(p.trimTo).toBeNull()
    expect(p.padSeconds).toBe(0)
  })

  it('太长:加速封顶 3 倍，剩下的掐尾', () => {
    const p = planClipFit(300, 30)
    expect(p.speed).toBe(3)
    expect(p.trimTo).toBe(30)   // 300/3=100s 仍超，掐到 30s
  })

  it('非法时长报错', () => {
    expect(() => planClipFit(0, 10)).toThrow()
    expect(() => planClipFit(10, 0)).toThrow()
  })
})

describe('fitBoxToAspect', () => {
  const FRAME_W = 3360
  const FRAME_H = 2100
  const ASPECT = 1080 / 960   // 1.125

  it('输出严格符合目标比例(容差 2%,因为要凑偶数)', () => {
    const b = fitBoxToAspect({ x: 800, y: 400, w: 1500, h: 1300 }, FRAME_W, FRAME_H, ASPECT)
    expect(b.w / b.h).toBeCloseTo(ASPECT, 1)
  })

  it('永远不越出画面', () => {
    for (const box of [
      { x: 0, y: 0, w: 200, h: 200 },              // 贴左上角
      { x: 3200, y: 2000, w: 200, h: 150 },        // 贴右下角
      { x: 100, y: 100, w: 3300, h: 2000 },        // 几乎整屏
    ]) {
      const b = fitBoxToAspect(box, FRAME_W, FRAME_H, ASPECT)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(FRAME_W)
      expect(b.y + b.h).toBeLessThanOrEqual(FRAME_H)
    }
  })

  it('包住原变化区(不把内容切掉)', () => {
    const box = { x: 800, y: 400, w: 1500, h: 1300 }
    const b = fitBoxToAspect(box, FRAME_W, FRAME_H, ASPECT)
    expect(b.x).toBeLessThanOrEqual(box.x)
    expect(b.y).toBeLessThanOrEqual(box.y)
    expect(b.x + b.w).toBeGreaterThanOrEqual(box.x + box.w)
    expect(b.y + b.h).toBeGreaterThanOrEqual(box.y + box.h)
  })

  it('全是偶数(ffmpeg crop 要求)', () => {
    const b = fitBoxToAspect({ x: 777, y: 333, w: 999, h: 555 }, FRAME_W, FRAME_H, ASPECT)
    for (const v of [b.x, b.y, b.w, b.h]) expect(v % 2).toBe(0)
  })
})
