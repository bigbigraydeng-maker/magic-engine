import { describe, expect, it } from 'vitest'
import { projectTrafficDirectionSignals } from '../traffic-direction'

const observation = (observed_at: string, excerpt: string) => ({
  domain: 'wendywutours.co.nz', source_url: 'https://www.similarweb.com/website/wendywutours.co.nz/', observed_at, valid_until: null, excerpt,
})

describe('traffic direction history projection', () => {
  it('keeps the latest observation and calculates change against the previous estimate', () => {
    const rows = projectTrafficDirectionSignals([
      observation('2026-09-01T00:00:00Z', '估算访问量：10K\n访问量变化：+2%\n主要国家：New Zealand'),
      observation('2026-09-12T00:00:00Z', '估算访问量：15.2K\n访问量变化：+31%\n主要国家：New Zealand'),
    ])
    expect(rows[0]).toMatchObject({ observation_count: 2, estimated_visits: 15200, previous_estimated_visits: 10000, snapshot_change_pct: 52, visits_change_pct: 31, top_country: 'New Zealand' })
    expect(rows[0].previous_observed_at).toBe('2026-09-01T00:00:00Z')
  })

  it('does not invent a trend when the estimate is unavailable', () => {
    const rows = projectTrafficDirectionSignals([observation('2026-09-12T00:00:00Z', '估算访问量：未测量\n访问量变化：未测量')])
    expect(rows[0]).toMatchObject({ observation_count: 1, estimated_visits: null, previous_estimated_visits: null, snapshot_change_pct: null, visits_change_pct: null })
  })

  it('projects only the newest row for each domain', () => {
    const rows = projectTrafficDirectionSignals([
      observation('2026-09-01T00:00:00Z', '估算访问量：10K'),
      { ...observation('2026-09-12T00:00:00Z', '估算访问量：12K'), domain: 'other.example' },
    ])
    expect(rows.map(row => row.domain)).toEqual(['other.example', 'wendywutours.co.nz'])
  })
})
