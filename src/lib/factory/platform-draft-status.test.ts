import { describe, expect, it } from 'vitest'
import {
  FACTORY_WRITE_PLATFORM_DRAFT_ENV,
  ON_PLATFORM_ORDER_STATUSES,
  isOnPlatformOrderStatus,
  isUploadedUnpublishedDraft,
  isWorkOrderStatusCheckViolation,
  platformDraftWriteEnabled,
  statusForConfirmedUpload,
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

describe('platform draft write gate', () => {
  it('is off unless the env value is exactly true', () => {
    expect(platformDraftWriteEnabled({})).toBe(false)
    expect(platformDraftWriteEnabled({ [FACTORY_WRITE_PLATFORM_DRAFT_ENV]: '1' })).toBe(false)
    expect(platformDraftWriteEnabled({ [FACTORY_WRITE_PLATFORM_DRAFT_ENV]: 'TRUE' })).toBe(false)
    expect(platformDraftWriteEnabled({ [FACTORY_WRITE_PLATFORM_DRAFT_ENV]: 'true' })).toBe(true)
  })

  it('uses platform_draft only for a draft upload when the gate is on', () => {
    expect(statusForConfirmedUpload('DRAFT', false)).toBe('published')
    expect(statusForConfirmedUpload('DRAFT', true)).toBe('platform_draft')
    expect(statusForConfirmedUpload('PUBLISHED', true)).toBe('published')
    expect(statusForConfirmedUpload('PUBLISHED', false)).toBe('published')
  })

  it('recognises the status-check rejection and ignores other failures', () => {
    expect(isWorkOrderStatusCheckViolation({
      code: '23514',
      message: 'new row for relation "content_work_orders" violates check constraint "content_work_orders_status_check"',
    })).toBe(true)
    expect(isWorkOrderStatusCheckViolation({ code: '23514', details: 'status platform_draft' })).toBe(true)
    expect(isWorkOrderStatusCheckViolation({ code: '23514', message: 'some other check' })).toBe(false)
    expect(isWorkOrderStatusCheckViolation({ message: 'network down' })).toBe(false)
    expect(isWorkOrderStatusCheckViolation(null)).toBe(false)
  })
})
