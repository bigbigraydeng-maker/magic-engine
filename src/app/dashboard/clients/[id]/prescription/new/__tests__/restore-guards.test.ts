import { describe, it, expect } from 'vitest'
import { shouldAutoRestoreLatestDraft } from '../restore-guards'
import type { Prescription, PrescriptionContent, PrescriptionStatus } from '@/types/diagnostic'

// Minimal stub — only the fields shouldAutoRestoreLatestDraft reads
function makePrescription(status: PrescriptionStatus, withContent = true): Pick<Prescription, 'id' | 'status' | 'content'> {
  return {
    id: 'rx-test-1',
    status,
    content: withContent ? ({ summary: 's', phases: [], budget_allocation: [], kpi_targets: [] } as unknown as PrescriptionContent) : null,
  }
}

describe('shouldAutoRestoreLatestDraft', () => {
  describe('BUG-FMT-W4-1: approved must NOT auto-jump to Step 3', () => {
    it('returns false when prescription is approved (regression guard for BUG-FMT-W4-1)', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: false,
        prescription: makePrescription('approved'),
      })
      expect(result).toBe(false)
    })

    it('still returns false for approved even if content is present', () => {
      // 双保险断言: 不管 content 有多丰富, approved 都不该跳 Step 3
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: false,
        prescription: makePrescription('approved', true),
      })
      expect(result).toBe(false)
    })
  })

  describe('happy path: draft / generating / failed should auto-restore', () => {
    it.each<PrescriptionStatus>(['draft', 'generating', 'failed'])(
      'returns true for status=%s when user is on Step 1 and not generating',
      (status) => {
        const result = shouldAutoRestoreLatestDraft({
          step: 1,
          isGenerating: false,
          prescription: makePrescription(status),
        })
        expect(result).toBe(true)
      },
    )
  })

  describe('guard against overwriting user-in-flight state', () => {
    it('returns false when user already advanced past Step 1', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 3,
        isGenerating: false,
        prescription: makePrescription('draft'),
      })
      expect(result).toBe(false)
    })

    it('returns false when a generation is currently in flight', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: true,
        prescription: makePrescription('draft'),
      })
      expect(result).toBe(false)
    })
  })

  describe('null / missing payload', () => {
    it('returns false when prescription is null', () => {
      expect(
        shouldAutoRestoreLatestDraft({ step: 1, isGenerating: false, prescription: null }),
      ).toBe(false)
    })

    it('returns false when prescription is undefined', () => {
      expect(
        shouldAutoRestoreLatestDraft({ step: 1, isGenerating: false, prescription: undefined }),
      ).toBe(false)
    })

    it('returns false when content is null (generating placeholder)', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: false,
        prescription: makePrescription('generating', /* withContent */ false),
      })
      expect(result).toBe(false)
    })
  })

  describe('defensive: unknown statuses', () => {
    it('returns false for rejected (defensive — API filters these out, but belt + suspenders)', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: false,
        prescription: makePrescription('rejected'),
      })
      expect(result).toBe(false)
    })

    it('returns false for superseded (defensive)', () => {
      const result = shouldAutoRestoreLatestDraft({
        step: 1,
        isGenerating: false,
        prescription: makePrescription('superseded'),
      })
      expect(result).toBe(false)
    })
  })
})
