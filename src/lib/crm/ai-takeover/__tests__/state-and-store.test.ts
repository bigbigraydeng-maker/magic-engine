import { describe, expect, it } from 'vitest'
import { mirrorValue, takeoverState, type TakeoverEvent } from '../state'
import { recordTakeover, type NewTakeoverEvent } from '../store'
import { fakeStore } from './fake-store'

const on = (at: string): TakeoverEvent => ({ kind: 'ai_takeover_on', createdAt: at, actor: 'lisa@x.co' })
const off = (at: string): TakeoverEvent => ({ kind: 'ai_takeover_off', createdAt: at, actor: 'lisa@x.co' })

describe('takeoverState: latest event wins', () => {
  it('no events = not in takeover', () => {
    expect(takeoverState([])).toEqual({ on: false, offAt: null, actor: null })
  })
  it('on then off = off; off then on = on (order of the array does not matter, time does)', () => {
    expect(takeoverState([off('2026-11-11T00:00:00Z'), on('2026-11-10T00:00:00Z')]).on).toBe(false)
    expect(takeoverState([on('2026-11-12T00:00:00Z'), off('2026-11-11T00:00:00Z')])).toMatchObject({ on: true, since: '2026-11-12T00:00:00Z' })
  })
  it('same instant: off wins (a human looks after the guest)', () => {
    const t = '2026-11-10T00:00:00Z'
    expect(takeoverState([off(t), on(t)]).on).toBe(false)
    expect(takeoverState([on(t), off(t)]).on).toBe(false)
  })
  it('the mirror value is the latest on-time, or null', () => {
    expect(mirrorValue([on('2026-11-10T00:00:00Z')])).toBe('2026-11-10T00:00:00Z')
    expect(mirrorValue([on('2026-11-10T00:00:00Z'), off('2026-11-11T00:00:00Z')])).toBeNull()
  })
})

const EVENT: NewTakeoverEvent = {
  clientId: 'c1',
  contactId: 'p1',
  kind: 'ai_takeover_on',
  actor: 'lisa@x.co',
  reason: null,
  catalogVersion: 'v9',
  sourceRef: 'catalogue:r1',
}

describe('recordTakeover: event first, then mirror', () => {
  it('writes the event, then sets the mirror from the log', async () => {
    const s = fakeStore()
    const r = await recordTakeover(EVENT, s.deps)
    expect(r).toMatchObject({ ok: true, inserted: true })
    expect(s.calls).toEqual(['insert', 'load', 'mirror'])
    expect(s.mirror.get('c1/p1')).toBe(s.events[0].createdAt)
  })

  it('the event write fails: nothing else is touched', async () => {
    const s = fakeStore({ failInsert: true })
    expect(await recordTakeover(EVENT, s.deps)).toMatchObject({ ok: false, reason: 'event_failed' })
    expect(s.calls).toEqual(['insert'])
    expect(s.mirror.size).toBe(0)
  })

  it('the mirror write fails: "half written, click again"; the retry adds no second event and repairs the mirror', async () => {
    const s = fakeStore({ failMirror: true })
    expect(await recordTakeover(EVENT, s.deps)).toEqual({ ok: false, reason: 'half_written', message: '只改了一半，再点一下。' })
    expect(s.events).toHaveLength(1)
    s.setFailMirror(false)
    expect(await recordTakeover(EVENT, s.deps)).toMatchObject({ ok: true, inserted: false })
    expect(s.events).toHaveLength(1)
    expect(s.mirror.get('c1/p1')).toBe(s.events[0].createdAt)
  })

  it('a late retry of an old "on" cannot undo a later "收回人工" (mirror comes from the whole log)', async () => {
    const s = fakeStore()
    await recordTakeover(EVENT, s.deps)
    await recordTakeover({ ...EVENT, kind: 'ai_takeover_off', sourceRef: 'off:x' }, s.deps)
    await recordTakeover(EVENT, s.deps) // replay of the first click
    expect(s.events).toHaveLength(2)
    expect(s.mirror.get('c1/p1')).toBeNull()
  })
})
