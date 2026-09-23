import { describe, expect, it } from 'vitest'
import { buildSemanticBrollPlan, SEMANTIC_BROLL_REQUESTED_EVENT, validateSemanticBrollRequest } from '../semantic-broll'
import { cloudFunctions } from '../index'

const base = {
  job_id: 'video-2026-09-21-001',
  source_video_uri: 'https://storage.example/source.mp4',
  transcript_segments: [{ start_sec: 0, end_sec: 5, text: '为什么广告数据和 AI 工作流必须放在一起？' }],
  asset_refs: [
    { asset_id: 'screen-1', uri: 'https://storage.example/screen.mp4', title: '广告数据后台', tags: ['数据', 'AI'], role: 'screen' },
    { asset_id: 'street-1', uri: 'https://storage.example/street.mp4', title: '街拍', tags: ['人物'], role: 'street' },
  ],
}

describe('semantic B-roll production contract', () => {
  it('rejects local file paths so Render never depends on a workstation', () => {
    expect(() => validateSemanticBrollRequest({ ...base, source_video_uri: '/Users/raydeng/Desktop/source.mov' })).toThrow('invalid_remote_uri')
  })

  it('ranks the semantically matching screen capture first', () => {
    const plan = buildSemanticBrollPlan(validateSemanticBrollRequest(base))
    expect(plan.items[0].candidates[0].asset_id).toBe('screen-1')
  })

  it('registers a cloud-only event', () => {
    const fn = cloudFunctions.find((candidate) => candidate.id().includes('semantic-broll-matching'))
    expect(fn).toBeDefined()
    const opts = (fn as unknown as { opts: { triggers: Array<{ event?: string }> } }).opts
    expect(opts.triggers[0].event).toBe(SEMANTIC_BROLL_REQUESTED_EVENT)
  })
})
