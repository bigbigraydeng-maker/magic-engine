import { describe, expect, it } from 'vitest'
import { recordTakeover } from '../store'
import { resumeAfterSystemStop, stopIsResumable, STOPLINE_ACTOR_ID } from '../actions'
import { takeoverState } from '../state'
import { fakeStore } from './fake-store'

const C = 'c1'
const P = 'p1'

async function systemStopped(evidence: string) {
  const s = fakeStore()
  await recordTakeover({ clientId: C, contactId: P, kind: 'ai_takeover_on', actor: 'lisa@x.co', reason: null, catalogVersion: 'v10', sourceRef: 'catalogue:r1' }, s.deps)
  await recordTakeover({ clientId: C, contactId: P, kind: 'ai_takeover_off', actor: STOPLINE_ACTOR_ID, reason: '电话里跟客人聊上了，交回员工跟进。', catalogVersion: null, sourceRef: `stopline:${P}:${evidence}` }, s.deps)
  return s
}

describe('resumeAfterSystemStop', () => {
  it('a staff member overrules a "talked" stop: the guest is back in AI follow-up', async () => {
    const s = await systemStopped('touch:t1')
    const res = await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
    expect(res.status).toBe(200)
    expect(takeoverState(await s.deps.loadEvents(C, P)).on).toBe(true)
    expect(s.mirror.get(`${C}/${P}`)).not.toBeNull()
  })

  it('a double click records one event', async () => {
    const s = await systemStopped('came_back:email:2026-11-12T00:00:00Z')
    await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
    const again = await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
    expect(again.status).toBe(200)
    expect(s.events.filter((e) => e.sourceRef === 'resume:k1')).toHaveLength(1)
  })

  it('a stop on a fact (booked, do not contact, stage) cannot be overruled here', async () => {
    for (const evidence of ['booking:b1', 'dnc', 'stage:won']) {
      const s = await systemStopped(evidence)
      const res = await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
      expect(res.status).toBe(409)
    }
  })

  it('a staff take-back is not a system stop and cannot be "resumed" here', async () => {
    const s = fakeStore()
    await recordTakeover({ clientId: C, contactId: P, kind: 'ai_takeover_off', actor: 'lisa@x.co', reason: null, catalogVersion: null, sourceRef: 'off:x' }, s.deps)
    const res = await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
    expect(res.status).toBe(409)
  })

  it('a system actor is refused', async () => {
    const s = await systemStopped('touch:t1')
    const res = await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'system:anything', clientRef: 'k1' }, s.deps)
    expect(res.status).toBe(403)
  })

  it('after a resume, the same evidence written again by the next run does not stop the guest a second time', async () => {
    const s = await systemStopped('touch:t1')
    await resumeAfterSystemStop({ clientId: C, contactId: P, actorEmail: 'lisa@x.co', clientRef: 'k1' }, s.deps)
    const rerun = await recordTakeover({ clientId: C, contactId: P, kind: 'ai_takeover_off', actor: STOPLINE_ACTOR_ID, reason: 'x', catalogVersion: null, sourceRef: `stopline:${P}:touch:t1` }, s.deps)
    expect(rerun).toMatchObject({ ok: true, inserted: false })
    expect(takeoverState(await s.deps.loadEvents(C, P)).on).toBe(true)
  })
})

describe('stopIsResumable', () => {
  it('only system stops on came-back or talked', () => {
    expect(stopIsResumable({ on: false, actor: STOPLINE_ACTOR_ID, sourceRef: 'stopline:p1:touch:t1' })).toBe(true)
    expect(stopIsResumable({ on: false, actor: STOPLINE_ACTOR_ID, sourceRef: 'stopline:p1:came_back:email:x' })).toBe(true)
    expect(stopIsResumable({ on: false, actor: STOPLINE_ACTOR_ID, sourceRef: 'stopline:p1:stage:won' })).toBe(false)
    expect(stopIsResumable({ on: false, actor: 'lisa@x.co', sourceRef: 'stopline:p1:touch:t1' })).toBe(false)
    expect(stopIsResumable({ on: true, actor: STOPLINE_ACTOR_ID, sourceRef: 'stopline:p1:touch:t1' })).toBe(false)
  })
})
