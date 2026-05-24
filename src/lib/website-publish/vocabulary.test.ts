import { describe, it, expect } from 'vitest'
import {
  WEBSITE_PUBLISH_STATUS,
  canTransition,
  payloadHash,
  buildIdempotencyKey,
} from './vocabulary'

describe('website-publish vocabulary', () => {
  describe('canTransition', () => {
    it('allows draft → published and draft → failed', () => {
      expect(canTransition('draft', 'published')).toBe(true)
      expect(canTransition('draft', 'failed')).toBe(true)
    })

    it('allows published → rolled_back', () => {
      expect(canTransition('published', 'rolled_back')).toBe(true)
    })

    it('rejects illegal transitions', () => {
      expect(canTransition('draft', 'rolled_back')).toBe(false)
      expect(canTransition('published', 'failed')).toBe(false)
      expect(canTransition('failed', 'published')).toBe(false)
      expect(canTransition('rolled_back', 'draft')).toBe(false)
    })

    it('treats failed and rolled_back as terminal', () => {
      for (const target of Object.values(WEBSITE_PUBLISH_STATUS)) {
        expect(canTransition('failed', target)).toBe(false)
        expect(canTransition('rolled_back', target)).toBe(false)
      }
    })
  })

  describe('payloadHash', () => {
    it('is deterministic for the same payload', () => {
      const a = payloadHash({ title: 'x', body: 'y' })
      const b = payloadHash({ title: 'x', body: 'y' })
      expect(a).toBe(b)
      expect(a).toHaveLength(64)
    })

    it('is order-independent (canonical JSON sorts keys)', () => {
      const a = payloadHash({ a: 1, b: 2 })
      const b = payloadHash({ b: 2, a: 1 })
      expect(a).toBe(b)
    })

    it('differs when content differs', () => {
      expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }))
    })

    it('handles nested objects and arrays', () => {
      const a = payloadHash({ nested: { b: [1, 2], a: 'x' } })
      const b = payloadHash({ nested: { a: 'x', b: [1, 2] } })
      expect(a).toBe(b)
    })
  })

  describe('buildIdempotencyKey', () => {
    it('builds {source_type}:{source_id}:{hash}', () => {
      expect(
        buildIdempotencyKey({
          sourceType: 'blog_post',
          sourceId:   'abc-123',
          hash:       'deadbeef',
        }),
      ).toBe('blog_post:abc-123:deadbeef')
    })
  })
})
