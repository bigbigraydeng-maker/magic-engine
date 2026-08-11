import { describe, expect, it } from 'vitest'
import { bandTopForFace, DEFAULT_FACE_Y, resolveFaceY } from './face-frame'

describe('bandTopForFace', () => {
  const FRAME_H = 2347   // 第2讲录像按宽缩放后的高
  const BAND_H = 960

  it('脸落在下半屏偏上位置(留头顶空间)', () => {
    const top = bandTopForFace(DEFAULT_FACE_Y, FRAME_H, BAND_H)
    const inBand = (DEFAULT_FACE_Y * FRAME_H - top) / BAND_H
    expect(inBand).toBeGreaterThan(0.3)
    expect(inBand).toBeLessThan(0.55)
  })

  it('不会裁到画面外', () => {
    expect(bandTopForFace(0.02, FRAME_H, BAND_H)).toBe(0)
    expect(bandTopForFace(0.98, FRAME_H, BAND_H) + BAND_H).toBeLessThanOrEqual(FRAME_H)
  })

  it('异常输入被夹住不崩', () => {
    expect(bandTopForFace(-5, FRAME_H, BAND_H)).toBe(0)
    expect(bandTopForFace(9, FRAME_H, BAND_H) + BAND_H).toBeLessThanOrEqual(FRAME_H)
  })
})

describe('resolveFaceY(客户调过就听客户的)', () => {
  it('没调过用经验值', () => {
    expect(resolveFaceY(null)).toBe(DEFAULT_FACE_Y)
    expect(resolveFaceY(undefined)).toBe(DEFAULT_FACE_Y)
  })

  it('调过就用他的', () => {
    expect(resolveFaceY(0.28)).toBe(0.28)
  })

  it('离谱的值不采信(防写坏配置把画面搞崩)', () => {
    expect(resolveFaceY(0.02)).toBe(DEFAULT_FACE_Y)
    expect(resolveFaceY(0.99)).toBe(DEFAULT_FACE_Y)
  })

  it('默认值取中性(各客户实际值差别大，靠各自偏好覆盖)', () => {
    expect(DEFAULT_FACE_Y).toBeGreaterThan(0.4)
    expect(DEFAULT_FACE_Y).toBeLessThan(0.6)
  })
})
