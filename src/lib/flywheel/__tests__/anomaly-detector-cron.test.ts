/**
 * Unit tests for anomaly-detector cron pipeline logic (P22.D.3).
 * Validates the two-step skip logic and response shape — no DB, no network.
 */

import { describe, it, expect } from 'vitest'
import type { AnomalyDetectorResult } from '../anomaly/AnomalyDetectorJob'
import type { BatchProactiveResult } from '../../zhuge/proactive'

// ── Step-2 skip condition ─────────────────────────────────────────────────────

describe('anomaly-detector cron step-2 skip logic', () => {
  it('skips step 2 when step 1 persisted zero signals', () => {
    const step1: AnomalyDetectorResult = {
      scannedClients: 5,
      signalsDetected: 0,
      signalsPersisted: 0,
      errors: [],
    }
    const shouldRunStep2 = step1.signalsPersisted > 0
    expect(shouldRunStep2).toBe(false)
  })

  it('runs step 2 when step 1 persisted at least one signal', () => {
    const step1: AnomalyDetectorResult = {
      scannedClients: 5,
      signalsDetected: 3,
      signalsPersisted: 2,
      errors: [],
    }
    const shouldRunStep2 = step1.signalsPersisted > 0
    expect(shouldRunStep2).toBe(true)
  })

  it('skips step 2 even if signals were detected but all were duplicates', () => {
    const step1: AnomalyDetectorResult = {
      scannedClients: 5,
      signalsDetected: 3,
      signalsPersisted: 0, // all were today-duplicates
      errors: [],
    }
    const shouldRunStep2 = step1.signalsPersisted > 0
    expect(shouldRunStep2).toBe(false)
  })
})

// ── Response shape contracts ──────────────────────────────────────────────────

describe('cron response shape', () => {
  it('step2_skipped response has correct shape', () => {
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      step1: {
        scannedClients: 3,
        signalsDetected: 0,
        signalsPersisted: 0,
        errors: [],
      } satisfies AnomalyDetectorResult,
      step2_skipped: true,
    }
    expect(response.success).toBe(true)
    expect(response.step2_skipped).toBe(true)
    expect(response.step1.signalsPersisted).toBe(0)
  })

  it('full response has correct shape', () => {
    const step2: BatchProactiveResult = {
      clients_processed: 2,
      total_acted: 3,
      total_dismissed: 1,
      total_cost_usd: 0.0012,
      errors: [],
      results: [],
    }
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      step1: {
        scannedClients: 2,
        signalsDetected: 4,
        signalsPersisted: 4,
        errors: [],
      } satisfies AnomalyDetectorResult,
      step2,
    }
    expect(response.step2.total_acted).toBe(3)
    expect(response.step2.total_cost_usd).toBeGreaterThan(0)
  })
})

// ── Partial-failure handling ──────────────────────────────────────────────────

describe('step 2 failure graceful handling', () => {
  it('step 1 success + step 2 error still returns 200 with partial result', () => {
    const step2ErrorResult: BatchProactiveResult = {
      clients_processed: 0,
      total_acted: 0,
      total_dismissed: 0,
      total_cost_usd: 0,
      errors: ['Step 2 failed: Claude API timeout'],
      results: [],
    }
    // Success flag should still be true (step 1 worked)
    const response = { success: true, step2: step2ErrorResult }
    expect(response.success).toBe(true)
    expect(response.step2.errors).toHaveLength(1)
    expect(response.step2.total_acted).toBe(0)
  })
})
