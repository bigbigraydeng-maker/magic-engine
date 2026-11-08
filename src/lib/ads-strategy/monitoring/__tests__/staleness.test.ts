import { describe, expect, it } from 'vitest'
import { jobById } from '../agent-jobs'
import { evaluateJobStaleness, formatStaleJobsSummary } from '../staleness'

const NOW = new Date('2026-11-08T12:00:00.000Z')

describe('evaluateJobStaleness', () => {
  it('fresh inside threshold → null', () => {
    const job = jobById('meta_leads_sync')
    const last = new Date(NOW.getTime() - 60 * 60_000).toISOString()
    expect(evaluateJobStaleness(job, last, NOW)).toBeNull()
  })

  it('beyond threshold → finding', () => {
    const job = jobById('insights')
    const last = new Date(NOW.getTime() - 80 * 3_600_000).toISOString()
    const f = evaluateJobStaleness(job, last, NOW)
    expect(f?.jobId).toBe('insights')
    expect(f?.hoursSince).toBeGreaterThan(60)
  })

  it('never succeeded → finding without hoursSince', () => {
    const job = jobById('entity_snapshots')
    const f = evaluateJobStaleness(job, null, NOW)
    expect(f?.lastSuccessAt).toBeNull()
    expect(f?.hoursSince).toBeNull()
  })
})

describe('formatStaleJobsSummary', () => {
  it('joins labels in Chinese', () => {
    const text = formatStaleJobsSummary([
      {
        jobId: 'insights',
        label: '广告每日结果入库',
        lastSuccessAt: '2026-11-01T00:00:00Z',
        thresholdHours: 60,
        hoursSince: 72,
      },
    ])
    expect(text).toContain('广告每日结果入库')
    expect(text).not.toContain('ad_daily')
  })
})
