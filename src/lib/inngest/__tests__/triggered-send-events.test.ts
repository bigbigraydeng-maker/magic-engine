import { describe, expect, it } from 'vitest'
import {
  CRM_TRIGGERED_SEND_SWEEP_REQUESTED,
  buildSweepEvent,
  parseSweepRequest,
  sweepEventId,
  sweepSlot,
} from '../triggered-send-events'

const CLIENT = '11111111-2222-3333-4444-555555555555'

describe('triggered-send-events', () => {
  it('exposes the event name', () => {
    expect(CRM_TRIGGERED_SEND_SWEEP_REQUESTED).toBe('crm.triggered_send.sweep_requested')
  })

  it('builds a deterministic event id', () => {
    expect(sweepEventId(CLIENT, '2026-11-03T08')).toBe(`triggered_send_sweep:${CLIENT}:2026-11-03T08`)
  })

  it('builds the cron event', () => {
    const event = buildSweepEvent({ clientId: CLIENT, slot: '2026-11-03T08' })
    expect(event).toEqual({
      id: `triggered_send_sweep:${CLIENT}:2026-11-03T08`,
      name: CRM_TRIGGERED_SEND_SWEEP_REQUESTED,
      data: {
        client_id: CLIENT,
        trigger_key: 'welcome',
        dry_run: false,
        requested_by: 'cron',
        slot: '2026-11-03T08',
      },
    })
  })

  describe('sweepSlot', () => {
    it('uses Pacific/Auckland daylight time (UTC+13)', () => {
      expect(sweepSlot(new Date('2026-11-02T19:15:00Z'), 'Pacific/Auckland')).toBe('2026-11-03T08')
      expect(sweepSlot(new Date('2026-11-02T21:15:00Z'), 'Pacific/Auckland')).toBe('2026-11-03T10')
      expect(sweepSlot(new Date('2026-11-02T10:59:00Z'), 'Pacific/Auckland')).toBe('2026-11-02T23')
      expect(sweepSlot(new Date('2026-11-02T11:00:00Z'), 'Pacific/Auckland')).toBe('2026-11-03T00')
    })

    it('falls back to the ISO prefix for a bad zone', () => {
      const now = new Date('2026-11-02T19:15:00Z')
      expect(sweepSlot(now, 'Not/AZone')).toBe('2026-11-02T19')
    })
  })

  describe('parseSweepRequest', () => {
    it('accepts a valid payload with dry_run true', () => {
      expect(
        parseSweepRequest({ client_id: CLIENT, trigger_key: 'welcome', dry_run: true }),
      ).toEqual({ ok: true, clientId: CLIENT, dryRun: true })
    })

    it('accepts a valid payload with dry_run false', () => {
      expect(
        parseSweepRequest({ client_id: CLIENT, trigger_key: 'welcome', dry_run: false }),
      ).toEqual({ ok: true, clientId: CLIENT, dryRun: false })
    })

    it('defaults an absent dry_run to true (manual event)', () => {
      expect(parseSweepRequest({ client_id: CLIENT, trigger_key: 'welcome' })).toEqual({
        ok: true,
        clientId: CLIENT,
        dryRun: true,
      })
    })

    it('rejects a wrong trigger_key', () => {
      const parsed = parseSweepRequest({ client_id: CLIENT, trigger_key: 'other', dry_run: true })
      expect(parsed.ok).toBe(false)
    })

    it('rejects a bad uuid', () => {
      const parsed = parseSweepRequest({ client_id: 'not-a-uuid', trigger_key: 'welcome', dry_run: true })
      expect(parsed.ok).toBe(false)
    })

    // The worker's concurrency key is the raw client_id text: an upper-case spelling would be a second key.
    it('rejects an upper-case uuid but accepts the same uuid in lower case', () => {
      const lower = 'abcdef12-3456-7890-abcd-ef1234567890'
      expect(parseSweepRequest({ client_id: lower.toUpperCase(), trigger_key: 'welcome', dry_run: true })).toEqual({
        ok: false,
        reason: 'client_id is not a lower-case uuid',
      })
      expect(parseSweepRequest({ client_id: lower, trigger_key: 'welcome', dry_run: true })).toEqual({
        ok: true,
        clientId: lower,
        dryRun: true,
      })
    })

    it('rejects a non-boolean dry_run', () => {
      const parsed = parseSweepRequest({ client_id: CLIENT, trigger_key: 'welcome', dry_run: 'yes' })
      expect(parsed.ok).toBe(false)
    })

    it('rejects non-object inputs', () => {
      for (const input of [null, undefined, 5, 'x', []]) {
        const parsed = parseSweepRequest(input)
        expect(parsed.ok).toBe(false)
      }
    })

    it('ignores extra keys', () => {
      expect(
        parseSweepRequest({ client_id: CLIENT, trigger_key: 'welcome', dry_run: true, extra: 'x' }),
      ).toEqual({ ok: true, clientId: CLIENT, dryRun: true })
    })
  })
})
