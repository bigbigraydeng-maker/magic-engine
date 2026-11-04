import { describe, it, expect } from 'vitest'
import { trimQuotedReply, mayBeTruncatedPreview } from '../email-full-body'
import { phoneRegionLabel } from '../phone-region'

describe('trimQuotedReply', () => {
  it('cuts the quoted history after "On ... wrote:"', () => {
    const t = 'Thanks!\r\nSee you soon.\r\nOn Mon, 5 Sep 2026 at 10:00, CTS Tours <info@x.nz> wrote:\r\n> old stuff'
    expect(trimQuotedReply(t)).toBe('Thanks!\r\nSee you soon.')
  })
  it('cuts at Outlook From:/Sent: header block', () => {
    const t = 'Hello\r\nFrom: CTS <a@b.nz>\r\nSent: Monday\r\nTo: x'
    expect(trimQuotedReply(t)).toBe('Hello')
  })
  it('keeps text with no quote and limits very long text', () => {
    expect(trimQuotedReply('short')).toBe('short')
    expect(trimQuotedReply('x'.repeat(50), 10)).toBe('xxxxxxxxxx…')
  })
})

describe('mayBeTruncatedPreview', () => {
  it('only bodies at preview length are candidates', () => {
    expect(mayBeTruncatedPreview('a'.repeat(253))).toBe(true)
    expect(mayBeTruncatedPreview('a'.repeat(100))).toBe(false)
    expect(mayBeTruncatedPreview(null)).toBe(false)
  })
})

describe('phoneRegionLabel', () => {
  it('labels by calling code, +852 not swallowed by shorter prefixes', () => {
    expect(phoneRegionLabel('+64211511105')).toBe('新西兰')
    expect(phoneRegionLabel('+61 412 345 678')).toBe('澳大利亚')
    expect(phoneRegionLabel('+85212345678')).toBe('香港')
    expect(phoneRegionLabel('0211511105')).toBeNull()
    expect(phoneRegionLabel(null)).toBeNull()
  })
})
