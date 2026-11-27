import { describe, expect, it } from 'vitest'
import {
  ON_PLATFORM_ORDER_STATUSES,
  isOnPlatformOrderStatus,
  isUploadedUnpublishedDraft,
} from './platform-draft-status'

describe('platform draft read compatibility', () => {
  it('treats legacy published and platform_draft as on-platform', () => {
    expect(ON_PLATFORM_ORDER_STATUSES).toEqual(['published', 'platform_draft'])
    expect(isOnPlatformOrderStatus('published')).toBe(true)
    expect(isOnPlatformOrderStatus('platform_draft')).toBe(true)
    expect(isOnPlatformOrderStatus('approved')).toBe(false)
  })

  it('counts a legacy DRAFT and a platform_draft as unpublished, and a public row as not', () => {
    expect(isUploadedUnpublishedDraft('published', 'DRAFT')).toBe(true)
    expect(isUploadedUnpublishedDraft('platform_draft', 'DRAFT')).toBe(true)
    expect(isUploadedUnpublishedDraft('platform_draft', null)).toBe(true)
    expect(isUploadedUnpublishedDraft('published', null)).toBe(false)
    expect(isUploadedUnpublishedDraft('published', 'PUBLISHED')).toBe(false)
    expect(isUploadedUnpublishedDraft('platform_draft', 'PUBLISHED')).toBe(false)
  })
})
