import { describe, expect, it } from 'vitest'
import { normalizeFacts, contentFingerprint } from '@/lib/confirmation-card'
import { videoUploadFacts } from '../video-upload-card'

describe('video upload card wording', () => {
  const url = 'https://files.example.test/c-1/external/a.mp4'

  it('names the video and the account so a person knows what they are confirming', () => {
    const facts = videoUploadFacts('wo-1', 'act_123', url, { title: 'Black Friday · offer angle', accountLabel: 'CTS 主账户' })
    expect(facts.scope).toBe('只上传「Black Friday · offer angle」这一条视频，不建广告、不打开、不改预算')
    expect(facts.account).toBe('CTS 主账户（act_123）')
    expect(facts.scope).not.toMatch(/记号/)
    expect(() => normalizeFacts(facts)).not.toThrow()
  })

  it('falls back to plain wording without a title or label, still passing the card checks', () => {
    const facts = videoUploadFacts('wo-1', 'act_123', url)
    expect(facts.scope).toBe('只上传这一条视频，不建广告、不打开、不改预算')
    expect(facts.account).toBe('已登记的广告账户（act_123）')
    expect(() => normalizeFacts(facts)).not.toThrow()
  })

  it('still changes the fingerprint when the file changes, even though the stamp left the visible text', () => {
    const a = contentFingerprint(normalizeFacts(videoUploadFacts('wo-1', 'act_123', url, { title: 't' })))
    const b = contentFingerprint(normalizeFacts(videoUploadFacts('wo-1', 'act_123', `${url}?v=2`, { title: 't' })))
    expect(a).not.toBe(b)
  })

  it('still issues a card when the title or account name contains brackets or backticks', () => {
    const facts = videoUploadFacts('wo-1', 'act_123', url, { title: '[BF] {50% off} `now`', accountLabel: 'CTS [main]' })
    expect(() => normalizeFacts(facts)).not.toThrow()
    expect(facts.scope).toContain("(BF) (50% off) 'now'")
    expect(facts.account).toBe('CTS (main)（act_123）')
  })

  it('keeps long titles inside the card length limit', () => {
    const facts = videoUploadFacts('wo-1', 'act_123', url, { title: 'x'.repeat(400), accountLabel: 'y'.repeat(300) })
    expect(() => normalizeFacts(facts)).not.toThrow()
  })
})
