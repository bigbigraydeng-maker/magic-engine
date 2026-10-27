import { describe, expect, it } from 'vitest'
import {
  ENGINE_CATALOG_ID,
  ENGINE_UPDATE_MESSAGE,
  REQUIRED_ENGINE_CAPABILITIES,
  assessEngineReport,
  engineCardNote,
  engineStaleNotice,
} from './engine-catalog.mjs'

const REV = 'c'.repeat(40)

const current = {
  engine_rev: REV,
  catalog_id: ENGINE_CATALOG_ID,
  capabilities: [...REQUIRED_ENGINE_CAPABILITIES],
}

describe('assessEngineReport', () => {
  it('accepts the current catalog and keeps the revision', () => {
    expect(assessEngineReport(current)).toMatchObject({ ok: true, engine_rev: REV })
  })

  it('refuses a machine that does not report a revision, without claiming the order', () => {
    const result = assessEngineReport(undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('出片机版本过旧')
      expect(result.message).toContain('不会作废')
      expect(result.engine_rev).toBeNull()
    }
  })

  it('refuses a machine missing a required capability', () => {
    const result = assessEngineReport({ ...current, capabilities: ['hook_v2'] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe(ENGINE_UPDATE_MESSAGE)
  })
})

describe('engineStaleNotice', () => {
  const ping = (stale: boolean | undefined, client = 'client-a') => ({
    summary: {
      client_ids: [client],
      ...(stale === undefined ? {} : { engine_stale: stale, engine_notice: ENGINE_UPDATE_MESSAGE }),
    },
  })

  it('says the machine is old when that is the only report', () => {
    expect(engineStaleNotice([ping(true)], 'client-a')).toContain('出片机版本过旧')
  })

  it('stays quiet when another machine already runs the current catalog', () => {
    expect(engineStaleNotice([ping(true), ping(false)], 'client-a')).toBeNull()
  })

  it('does not warn a different client', () => {
    expect(engineStaleNotice([ping(true, 'client-b')], 'client-a')).toBeNull()
  })
})

describe('engineCardNote', () => {
  it('shows the update sentence only on a video from an old machine', () => {
    expect(engineCardNote({ engine_stale: true })).toContain('出片机版本过旧')
    expect(engineCardNote({ engine_rev: REV, engine_stale: false })).toBeNull()
    expect(engineCardNote({})).toBeNull()
  })
})
