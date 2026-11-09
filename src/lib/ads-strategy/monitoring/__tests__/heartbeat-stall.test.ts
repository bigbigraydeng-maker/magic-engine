import { describe, expect, it } from 'vitest'
import {
  collectDailyPullbackGaps,
  formatDailyPullbackGapWhat,
} from '../daily-pullback-gaps'
import {
  evaluateHeartbeatStall,
  heartbeatStallShouldAlert,
  heartbeatStallSummary,
  HEARTBEAT_STALL_THRESHOLD_HOURS,
  lastSuccessfulHeartbeatFinishedAt,
  readHeartbeatEnvConfig,
} from '../heartbeat-stall'

const NOW = new Date('2026-11-08T12:00:00.000Z')

describe('evaluateHeartbeatStall', () => {
  it('dry + 0 clients → no verdict (not enabled)', () => {
    const cfg = readHeartbeatEnvConfig('dry', '')
    expect(cfg.clientIds).toHaveLength(0)
    expect(evaluateHeartbeatStall(cfg, [], NOW)).toBeNull()
  })

  it('off mode → no verdict', () => {
    const cfg = readHeartbeatEnvConfig('off', 'c1')
    expect(evaluateHeartbeatStall(cfg, [], NOW)).toBeNull()
  })

  it('live without clients → misconfigured', () => {
    const cfg = readHeartbeatEnvConfig('live', '')
    const v = evaluateHeartbeatStall(cfg, [], NOW)
    expect(v?.phase).toBe('misconfigured')
    expect(heartbeatStallShouldAlert(v!)).toBe(true)
  })

  it('never succeeded when configured', () => {
    const cfg = readHeartbeatEnvConfig('dry', 'c1,c2')
    const v = evaluateHeartbeatStall(cfg, [{ status: 'failed', finished_at: NOW.toISOString(), started_at: '' }], NOW)
    expect(v?.phase).toBe('never_succeeded')
    expect(heartbeatStallShouldAlert(v!)).toBe(true)
  })

  it('stalled when last success too old', () => {
    const cfg = readHeartbeatEnvConfig('dry', 'c1')
    const old = new Date(NOW.getTime() - (HEARTBEAT_STALL_THRESHOLD_HOURS + 1) * 3_600_000).toISOString()
    const runs = [
      { status: 'completed', finished_at: old, started_at: old },
      { status: 'completed', finished_at: old, started_at: old },
    ]
    const v = evaluateHeartbeatStall(cfg, runs, NOW)
    expect(v?.phase).toBe('stalled')
    expect(heartbeatStallSummary(v!).length).toBeGreaterThan(5)
  })

  it('recovers → ok', () => {
    const cfg = readHeartbeatEnvConfig('dry', 'c1')
    const recent = new Date(NOW.getTime() - 30 * 60_000).toISOString()
    const v = evaluateHeartbeatStall(
      cfg,
      [{ status: 'completed', finished_at: recent, started_at: recent }],
      NOW,
    )
    expect(v?.phase).toBe('ok')
    expect(heartbeatStallShouldAlert(v!)).toBe(false)
  })

  it('latest failed but recent success → last_failed', () => {
    const cfg = readHeartbeatEnvConfig('dry', 'c1')
    const recent = new Date(NOW.getTime() - 20 * 60_000).toISOString()
    const v = evaluateHeartbeatStall(
      cfg,
      [
        { status: 'failed', finished_at: NOW.toISOString(), started_at: NOW.toISOString() },
        { status: 'completed', finished_at: recent, started_at: recent },
      ],
      NOW,
    )
    expect(v?.phase).toBe('last_failed')
    expect(heartbeatStallShouldAlert(v!)).toBe(true)
  })

  it('picks newest completed run', () => {
    const runs = [
      { status: 'failed', finished_at: '2026-11-08T11:00:00Z', started_at: '' },
      { status: 'completed', finished_at: '2026-11-08T10:00:00Z', started_at: '' },
      { status: 'completed', finished_at: '2026-11-08T09:00:00Z', started_at: '' },
    ]
    expect(lastSuccessfulHeartbeatFinishedAt(runs)).toBe('2026-11-08T10:00:00Z')
  })
})

describe('collectDailyPullbackGaps', () => {
  it('ignores ad_config and meta', () => {
    const gaps = collectDailyPullbackGaps([
      { client_id: 'c1', source: 'ad_config', error: 'x' },
      { client_id: 'c1', source: 'meta', error: 'y' },
    ])
    expect(gaps).toHaveLength(0)
  })

  it('groups per client without swallowing second source', () => {
    const gaps = collectDailyPullbackGaps([
      { client_id: 'c1', source: 'ad_daily', error: 'timeout' },
      { client_id: 'c1', source: 'ad_health', error: 'skip' },
      { client_id: 'c2', source: 'ad_daily', error: 'boom' },
    ])
    expect(gaps).toHaveLength(2)
    expect(gaps.find((g) => g.clientId === 'c1')?.sources.sort()).toEqual(['ad_daily', 'ad_health'])
    expect(formatDailyPullbackGapWhat('A', gaps[0]!)).not.toMatch(/\{/)
  })
})
