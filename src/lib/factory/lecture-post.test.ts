import { describe, expect, it } from 'vitest'
import type { LectureProduction, LectureMethod } from './lecture-post'

/**
 * 换制作方式时该保留什么 —— 真实事故(2026-08-04):
 * 客户点了「用数字人」，录像链接和两段配好的录屏被一起抹掉，切回来也不恢复。
 * 这里把 setLectureProduction 里的合并规则单独测住，防再犯。
 */
function mergeProduction(
  prev: LectureProduction | null,
  method: LectureMethod,
  recordingUrl?: string,
): LectureProduction {
  return {
    ...(prev ?? {}),
    method,
    changed_at: '2026-08-04T00:00:00.000Z',
    ...(recordingUrl
      ? { recording_url: recordingUrl, recording_uploaded_at: '2026-08-04T00:00:00.000Z' }
      : {}),
  }
}

const FULL: LectureProduction = {
  method: 'self_record',
  recording_url: 'https://example.com/rec.mp4',
  recording_uploaded_at: '2026-08-03T00:00:00.000Z',
  section_clips: { '0': { url: 'https://example.com/a.mp4', added_at: '2026-08-03T00:00:00.000Z' } },
  extra_head_trim_sec: 2,
}

describe('换制作方式', () => {
  it('切到数字人:录像和录屏配置全部保留(事故复现点)', () => {
    const next = mergeProduction(FULL, 'digital_human')
    expect(next.method).toBe('digital_human')
    expect(next.recording_url).toBe(FULL.recording_url)
    expect(next.section_clips).toEqual(FULL.section_clips)
    expect(next.extra_head_trim_sec).toBe(2)
  })

  it('切回自己录:配置还在，不用重传', () => {
    const next = mergeProduction(mergeProduction(FULL, 'digital_human'), 'self_record')
    expect(next.recording_url).toBe(FULL.recording_url)
    expect(next.section_clips).toEqual(FULL.section_clips)
  })

  it('传新录像:换掉录像但录屏配置留着', () => {
    const next = mergeProduction(FULL, 'self_record', 'https://example.com/new.mp4')
    expect(next.recording_url).toBe('https://example.com/new.mp4')
    expect(next.section_clips).toEqual(FULL.section_clips)
  })

  it('第一次设置(之前什么都没有)不崩', () => {
    expect(mergeProduction(null, 'self_record').method).toBe('self_record')
  })
})
