import { describe, expect, it } from 'vitest'
import { bandTopForFace, FALLBACK_FACE_Y } from './face-frame'

describe('bandTopForFace', () => {
  const FRAME_H = 1920
  const BAND_H = 960

  it('脸在上三分之一:窗口跟着往上，脸落在窗口偏上位置', () => {
    const top = bandTopForFace(0.34, FRAME_H, BAND_H)
    const faceInBand = (0.34 * FRAME_H - top) / BAND_H
    expect(faceInBand).toBeGreaterThan(0.3)
    expect(faceInBand).toBeLessThan(0.55)
  })

  it('脸很靠上也不会裁到画面外', () => {
    expect(bandTopForFace(0.05, FRAME_H, BAND_H)).toBe(0)
  })

  it('脸很靠下也不会超出画面底部', () => {
    const top = bandTopForFace(0.95, FRAME_H, BAND_H)
    expect(top + BAND_H).toBeLessThanOrEqual(FRAME_H)
  })

  it('异常输入(负数/大于1)被夹住不崩', () => {
    expect(bandTopForFace(-2, FRAME_H, BAND_H)).toBe(0)
    expect(bandTopForFace(9, FRAME_H, BAND_H) + BAND_H).toBeLessThanOrEqual(FRAME_H)
  })

  it('兜底值在合理区间(说话人像通常在上半部)', () => {
    expect(FALLBACK_FACE_Y).toBeGreaterThan(0.2)
    expect(FALLBACK_FACE_Y).toBeLessThan(0.5)
  })
})
